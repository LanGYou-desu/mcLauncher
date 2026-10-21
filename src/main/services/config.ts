import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { ConfigPatch, Instance, InstanceSummary, LauncherConfig } from '../../shared/types'
import { clamp, newId, sanitizePlayerName } from './util'
import { scanContentSummary } from './content'

export interface ConfigStoreOptions {
  userDataPath: string
  appDataPath: string
  homePath: string
  defaultPlayerName: string
  /** Default game root for a fresh installation. */
  defaultGameRoot?: string
  /** Physical memory reported by the operating system, in MiB. */
  totalMemoryMb?: number
}

export const CONFIG_SCHEMA_VERSION = 3

type NewInstanceInput = Omit<Instance, 'id' | 'createdAt'> & { id?: string; createdAt?: number }

export class ConfigStore {
  readonly configPath: string
  readonly options: ConfigStoreOptions
  private config: LauncherConfig
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(options: ConfigStoreOptions, config: LauncherConfig) {
    this.options = options
    this.configPath = join(options.userDataPath, 'config.json')
    this.config = config
  }

  static async load(options: ConfigStoreOptions): Promise<ConfigStore> {
    await mkdir(options.userDataPath, { recursive: true })
    const path = join(options.userDataPath, 'config.json')
    let loaded: Partial<LauncherConfig> = {}
    if (existsSync(path)) {
      try {
        loaded = JSON.parse(await readFile(path, 'utf8')) as Partial<LauncherConfig>
      } catch {
        const backup = `${path}.broken-${Date.now()}`
        await rename(path, backup).catch(() => {})
      }
    }
    const config = normalizeConfig(loaded, options)
    const store = new ConfigStore(options, config)
    await store.ensureDirectories()
    await store.save()
    return store
  }

  get(): LauncherConfig {
    return JSON.parse(JSON.stringify(this.config)) as LauncherConfig
  }

  getInstances(): Instance[] {
    return this.config.instances.map((instance) => ({ ...instance }))
  }

  getInstance(id: string): Instance | undefined {
    return this.config.instances.find((instance) => instance.id === id)
  }

  async adjust(patch: ConfigPatch): Promise<LauncherConfig> {
    if (patch.gameRoot !== undefined) {
      if (!isAbsolute(patch.gameRoot) || patch.gameRoot.trim().length < 2) {
        throw new Error('游戏目录必须是绝对路径')
      }
      this.config.gameRoot = resolve(patch.gameRoot)
    }
    if (patch.downloadSource !== undefined) {
      if (!['auto', 'official', 'bmclapi'].includes(patch.downloadSource)) {
        throw new Error('未知的下载源')
      }
      this.config.downloadSource = patch.downloadSource
    }
    if (patch.playerName !== undefined) {
      this.config.playerName = sanitizePlayerName(patch.playerName)
    }
    if (patch.accountMode !== undefined) {
      if (patch.accountMode !== 'offline' && patch.accountMode !== 'microsoft') throw new Error('未知的账户模式')
      this.config.accountMode = patch.accountMode
    }
    if (patch.microsoftClientId !== undefined) {
      const clientId = patch.microsoftClientId.trim()
      if (clientId && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(clientId)) {
        throw new Error('Microsoft 客户端 ID 必须是标准 UUID 格式')
      }
      this.config.microsoftClientId = clientId
    }
    if (patch.globalJavaPath !== undefined) {
      this.config.globalJavaPath = patch.globalJavaPath
    }
    if (patch.memoryMb !== undefined) this.config.memoryMb = clamp(patch.memoryMb, 512, 65536)
    if (patch.minMemoryMb !== undefined) this.config.minMemoryMb = clamp(patch.minMemoryMb, 256, 8192)
    if (this.config.minMemoryMb > this.config.memoryMb) this.config.minMemoryMb = this.config.memoryMb
    if (patch.downloadConcurrency !== undefined) this.config.downloadConcurrency = clamp(patch.downloadConcurrency, 1, 16)
    if (patch.jvmArgs !== undefined) this.config.jvmArgs = patch.jvmArgs.slice(0, 4000)
    if (patch.gameArgs !== undefined) this.config.gameArgs = patch.gameArgs.slice(0, 4000)
    if (patch.onboarded !== undefined) this.config.onboarded = Boolean(patch.onboarded)
    if (patch.lastInstanceId !== undefined) this.config.lastInstanceId = patch.lastInstanceId
    if (patch.knownMinecraftRoots !== undefined) {
      this.config.knownMinecraftRoots = uniquePaths(patch.knownMinecraftRoots.filter(isAbsolute))
    }
    if (patch.customJavaPaths !== undefined) {
      this.config.customJavaPaths = uniquePaths(patch.customJavaPaths.filter(isAbsolute))
    }
    await this.ensureDirectories()
    await this.save()
    return this.get()
  }

  async setInstances(instances: Instance[]): Promise<void> {
    this.config.instances = instances
    await this.save()
  }

  async updateInstance(id: string, patch: Partial<Instance>): Promise<Instance> {
    const instance = this.config.instances.find((item) => item.id === id)
    if (!instance) throw new Error('找不到该实例')
    Object.assign(instance, patch, { id: instance.id })
    await this.save()
    return { ...instance }
  }

  async addInstance(input: NewInstanceInput): Promise<Instance> {
    const [instance] = await this.addInstances([input])
    return instance
  }

  async addInstances(inputs: NewInstanceInput[]): Promise<Instance[]> {
    if (!inputs.length) return []
    const now = Date.now()
    const created = inputs.map((input) => ({
      ...input,
      id: input.id ?? newId('inst-'),
      createdAt: input.createdAt ?? now
    })) as Instance[]
    this.config.instances.push(...created)
    this.config.lastInstanceId = created[created.length - 1].id
    for (const instance of created) await this.ensureDirectoriesForInstance(instance)
    await this.save()
    return created.map((instance) => ({ ...instance }))
  }

  async removeInstance(id: string): Promise<Instance | undefined> {
    const index = this.config.instances.findIndex((instance) => instance.id === id)
    if (index < 0) return undefined
    const [removed] = this.config.instances.splice(index, 1)
    if (this.config.lastInstanceId === id) {
      this.config.lastInstanceId = this.config.instances[0]?.id ?? null
    }
    await this.save()
    return removed
  }

  async setLastInstance(id: string | null): Promise<void> {
    this.config.lastInstanceId = id
    await this.save()
  }

  async summaries(): Promise<InstanceSummary[]> {
    return Promise.all(
      this.config.instances.map(async (instance) => {
        const summary = await scanContentSummary(instance)
        return { ...instance, ...summary }
      })
    )
  }

  async ensureDirectories(): Promise<void> {
    await mkdir(this.config.gameRoot, { recursive: true })
    await mkdir(join(this.config.gameRoot, 'versions'), { recursive: true })
    await mkdir(join(this.config.gameRoot, 'libraries'), { recursive: true })
    await mkdir(join(this.config.gameRoot, 'assets'), { recursive: true })
    await mkdir(join(this.config.gameRoot, 'instances'), { recursive: true })
    for (const instance of this.config.instances) await this.ensureDirectoriesForInstance(instance)
  }

  async ensureDirectoriesForInstance(instance: Instance): Promise<void> {
    // Never create folders inside an external/PCL instance. Content installers
    // create their destination directories on demand; importing must not alter
    // the original game directory just by registering it.
    if (instance.external) return
    for (const folder of ['mods', 'shaderpacks', 'resourcepacks', 'saves', 'config', 'logs']) {
      await mkdir(join(instance.gameDir, folder), { recursive: true })
    }
  }

  save(): Promise<void> {
    const snapshot = JSON.stringify(this.config, null, 2)
    this.saveQueue = this.saveQueue.then(async () => {
      await mkdir(dirname(this.configPath), { recursive: true })
      const temp = `${this.configPath}.tmp`
      await writeFile(temp, snapshot, 'utf8')
      await rename(temp, this.configPath)
    })
    return this.saveQueue
  }
}

function normalizeConfig(loaded: Partial<LauncherConfig>, options: ConfigStoreOptions): LauncherConfig {
  const fallbackRoot = options.defaultGameRoot
    ? resolve(options.defaultGameRoot)
    : join(options.userDataPath, 'minecraft')
  const gameRoot =
    typeof loaded.gameRoot === 'string' && isAbsolute(loaded.gameRoot) ? loaded.gameRoot : fallbackRoot
  const instances = Array.isArray(loaded.instances)
    ? loaded.instances
        .filter((instance): instance is Instance => Boolean(instance && typeof instance.id === 'string'))
        .map((instance) => ({
          ...instance,
          minecraftRoot: isAbsolute(instance.minecraftRoot ?? '') ? instance.minecraftRoot : gameRoot,
          gameDir: isAbsolute(instance.gameDir ?? '') ? instance.gameDir : join(gameRoot, 'instances', instance.id),
          loader: instance.loader ?? 'vanilla',
          external: Boolean(instance.external),
          source: instance.source ?? 'launcher'
        }))
    : []
  const playerName = sanitizePlayerName(loaded.playerName || options.defaultPlayerName)
  const halfPhysicalMemory = defaultMemoryMb(options.totalMemoryMb)
  const previousSchema = typeof loaded.schemaVersion === 'number' ? loaded.schemaVersion : 1
  const storedMemory = typeof loaded.memoryMb === 'number' ? loaded.memoryMb : null
  // 4096 MB was the old built-in default. On the first launch after this
  // update, migrate that value (but not an explicitly chosen other value) to
  // the new physical-memory-based default.
  const useAutomaticMemory =
    storedMemory === null || (previousSchema < CONFIG_SCHEMA_VERSION && storedMemory === 4096)
  const memoryMb = clamp(useAutomaticMemory ? halfPhysicalMemory : (storedMemory ?? halfPhysicalMemory), 512, 65536)
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    gameRoot,
    downloadSource: loaded.downloadSource === 'official' || loaded.downloadSource === 'bmclapi' ? loaded.downloadSource : 'auto',
    playerName,
    accountMode: loaded.accountMode === 'microsoft' ? 'microsoft' : 'offline',
    microsoftClientId: typeof loaded.microsoftClientId === 'string' ? loaded.microsoftClientId.trim() : '',
    globalJavaPath: typeof loaded.globalJavaPath === 'string' ? loaded.globalJavaPath : null,
    customJavaPaths: uniquePaths((loaded.customJavaPaths ?? []).filter((path) => isAbsolute(path))),
    knownMinecraftRoots: uniquePaths((loaded.knownMinecraftRoots ?? []).filter((path) => isAbsolute(path))),
    memoryMb,
    minMemoryMb: clamp(loaded.minMemoryMb ?? 1024, 256, memoryMb),
    downloadConcurrency: clamp(loaded.downloadConcurrency ?? 8, 1, 16),
    jvmArgs: typeof loaded.jvmArgs === 'string' ? loaded.jvmArgs : '',
    gameArgs: typeof loaded.gameArgs === 'string' ? loaded.gameArgs : '',
    language: 'zh-CN',
    instances,
    lastInstanceId:
      loaded.lastInstanceId && instances.some((instance) => instance.id === loaded.lastInstanceId)
        ? loaded.lastInstanceId
        : instances[0]?.id ?? null,
    onboarded: Boolean(loaded.onboarded)
  }
}

export function defaultMemoryMb(totalMemoryMb?: number): number {
  const total = Number(totalMemoryMb)
  if (!Number.isFinite(total) || total <= 0) return 4096
  const half = total / 2
  return Math.min(65536, Math.max(1024, Math.round(half / 512) * 512))
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    const normalized = resolve(path)
    const key = normalized.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(normalized)
    }
  }
  return result
}
