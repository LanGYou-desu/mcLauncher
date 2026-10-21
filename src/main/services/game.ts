import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, open, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { LaunchPrecheck, Version, launch as launchMinecraft } from '@xmcl/core'
import type {
  DownloadSource,
  InstallGameRequest,
  InstallSubmission,
  Instance,
  JavaInfo,
  JobState,
  LaunchResult,
  LaunchSession,
  LoaderType,
  UpdateInstancePatch,
  InstanceSummary
} from '../../shared/types'
import { LOADER_LABELS } from '../../shared/types'
import type { ConfigStore } from './config'
import type { MicrosoftLaunchProfile } from './auth'
import type { JobManager, JobContext } from './jobs'
import { installCore } from './installer'
import { normalizeMinecraftRoot } from './minecraft'
import { chooseJava } from './java'
import { offlineUuid, newId, safeFileName, sanitizePlayerName, splitCommandLine, trimDescription } from './util'

export function resolveClientJarVersion(
  instance: Pick<Instance, 'minecraftRoot' | 'versionId' | 'external'>,
  minecraftVersion: string
): string {
  const localClientJar = join(instance.minecraftRoot, 'versions', instance.versionId, `${instance.versionId}.jar`)
  if (instance.external && existsSync(localClientJar)) return instance.versionId
  return minecraftVersion
}

export interface GameServiceOptions {
  config: ConfigStore
  jobs: JobManager
  getJava: () => Promise<JavaInfo[]>
  getMicrosoftProfile: () => Promise<MicrosoftLaunchProfile>
}

interface RuntimeSession {
  publicState: LaunchSession
  child?: ChildProcess
  logs: string[]
  stopLogTail?: () => Promise<void>
}

const MAX_LOG_LINES = 1800
const MAX_SESSIONS = 20

export class GameService extends EventEmitter {
  private readonly config: ConfigStore
  private readonly jobs: JobManager
  private readonly getJava: () => Promise<JavaInfo[]>
  private readonly getMicrosoftProfile: () => Promise<MicrosoftLaunchProfile>
  private sessions = new Map<string, RuntimeSession>()

  constructor(options: GameServiceOptions) {
    super()
    this.config = options.config
    this.jobs = options.jobs
    this.getJava = options.getJava
    this.getMicrosoftProfile = options.getMicrosoftProfile
  }

  /**
   * Run a full version installation for a modpack and create its instance.
   * The job progress is remapped into the supplied range so callers can
   * combine game installation and modpack files in one visible task.
   */
  async installModpackInstance(
    request: InstallGameRequest,
    parentJob: JobContext,
    range: { from: number; to: number }
  ): Promise<Instance> {
    this.validateInstallRequest(request)
    const config = this.config.get()
    const source = request.source ?? config.downloadSource
    const javaList = await this.getJava()
    const job = scaledJobContext(parentJob, range)
    const targetRoot = await this.resolveTargetRoot(request)
    const result = await installCore({
      config,
      root: targetRoot,
      source,
      javaList,
      mcVersion: request.mcVersion,
      loader: request.loader,
      loaderVersion: request.loaderVersion,
      job
    })
    parentJob.update({ detail: '正在创建整合包实例…' })
    return this.createInstance(request, result, source, targetRoot)
  }

  install(request: InstallGameRequest): InstallSubmission {
    this.validateInstallRequest(request)
    const config = this.config.get()
    const source = request.source ?? config.downloadSource
    const label = this.installLabel(request)
    const jobId = this.jobs.enqueue(
      'game',
      `安装 ${label}`,
      {
        mcVersion: request.mcVersion,
        loader: request.loader,
        loaderVersion: request.loaderVersion,
        instanceName: request.name
      },
      async (job) => {
        const javaList = await this.getJava()
        const targetRoot = await this.resolveTargetRoot(request)
        const result = await installCore({
          config: this.config.get(),
          root: targetRoot,
          source,
          javaList,
          mcVersion: request.mcVersion,
          loader: request.loader,
          loaderVersion: request.loaderVersion,
          job
        })
        job.update({ stage: 'instance', detail: '正在创建启动实例…', progress: 97 })
        const instance = await this.createInstance(request, result, source, targetRoot)
        job.update({
          stage: 'done',
          detail: `实例「${instance.name}」已就绪`,
          progress: 100
        })
      }
    )
    return { jobId }
  }

  private async createInstance(
    request: InstallGameRequest,
    result: Awaited<ReturnType<typeof installCore>>,
    source: DownloadSource,
    targetRoot: string
  ): Promise<Instance> {
    const config = this.config.get()
    const name = this.uniqueInstanceName(
      request.name?.trim() || this.defaultInstanceName(request.mcVersion, request.loader, request.loaderVersion)
    )
    const id = newId('inst-')
    const gameDir = join(targetRoot, 'instances', id)
    await mkdir(gameDir, { recursive: true })
    for (const folder of ['mods', 'shaderpacks', 'resourcepacks', 'saves', 'config', 'logs']) {
      await mkdir(join(gameDir, folder), { recursive: true })
    }
    const instance = await this.config.addInstance({
      id,
      name,
      mcVersion: result.mcVersion,
      loader: result.loader,
      loaderVersion: result.loaderVersion,
      versionId: result.versionId,
      minecraftRoot: targetRoot,
      gameDir,
      external: false,
      source: request.modpack ? 'modpack' : 'launcher',
      javaPath: request.javaPath || result.javaPath,
      memoryMb: request.memoryMb ? Math.max(512, Math.min(65536, Math.round(request.memoryMb))) : undefined,
      createdAt: Date.now(),
      modpack: request.modpack
    })
    if (targetRoot.toLowerCase() !== config.gameRoot.toLowerCase()) {
      const roots = [...config.knownMinecraftRoots, targetRoot]
      await this.config.adjust({ knownMinecraftRoots: roots }).catch(() => {})
    }
    void source
    return instance
  }

  private validateInstallRequest(request: InstallGameRequest): void {
    if (!request || typeof request.mcVersion !== 'string' || !/^[A-Za-z0-9._+-]{1,64}$/.test(request.mcVersion)) {
      throw new Error('无效的 Minecraft 版本')
    }
    if (!['vanilla', 'fabric', 'forge', 'neoforge'].includes(request.loader)) {
      throw new Error('未知的加载器类型')
    }
    if (request.loader !== 'vanilla' && !request.loaderVersion) {
      throw new Error('请选择加载器版本')
    }
    if (request.name && request.name.length > 50) throw new Error('实例名称不能超过 50 个字符')
    if (request.targetRoot !== undefined) {
      if (typeof request.targetRoot !== 'string' || !isAbsolute(request.targetRoot) || request.targetRoot.length > 300) {
        throw new Error('版本安装目录必须是有效的绝对路径')
      }
    }
    if (request.memoryMb !== undefined) {
      if (!Number.isFinite(request.memoryMb) || request.memoryMb < 512 || request.memoryMb > 65536) {
        throw new Error('游戏内存必须在 512–65536 MB 之间')
      }
    }
  }

  private async resolveTargetRoot(request: InstallGameRequest): Promise<string> {
    const config = this.config.get()
    const selected = request.targetRoot ? resolve(request.targetRoot) : config.gameRoot
    const targetRoot = normalizeMinecraftRoot(selected)
    await mkdir(targetRoot, { recursive: true })
    await mkdir(join(targetRoot, 'versions'), { recursive: true })
    return targetRoot
  }

  private installLabel(request: InstallGameRequest): string {
    if (request.loader === 'vanilla') return `Minecraft ${request.mcVersion}`
    return `${request.mcVersion} · ${LOADER_LABELS[request.loader]}${request.loaderVersion ? ` ${request.loaderVersion}` : ''}`
  }

  private defaultInstanceName(mcVersion: string, loader: LoaderType, loaderVersion?: string): string {
    if (loader === 'vanilla') return `${mcVersion} 原版`
    return `${mcVersion} ${LOADER_LABELS[loader]}${loaderVersion ? ` ${loaderVersion}` : ''}`
  }

  private uniqueInstanceName(desired: string): string {
    const instances = this.config.getInstances()
    if (!instances.some((instance) => instance.name === desired)) return desired
    let index = 2
    while (instances.some((instance) => instance.name === `${desired} (${index})`)) index++
    return `${desired} (${index})`
  }

  async launch(instanceId: string): Promise<LaunchResult> {
    const instance = this.config.getInstance(instanceId)
    if (!instance) throw new Error('找不到该实例')
    if ([...this.sessions.values()].some((session) => session.publicState.instanceId === instanceId && ['starting', 'running'].includes(session.publicState.status))) {
      throw new Error('该实例已经在运行中')
    }
    const versionPath = join(instance.minecraftRoot, 'versions', instance.versionId, `${instance.versionId}.json`)
    if (!existsSync(versionPath)) {
      throw new Error('版本文件缺失，请先点击「修复」重新校验游戏文件')
    }
    const config = this.config.get()
    const javaList = await this.getJava()
    let resolvedVersion: Awaited<ReturnType<typeof Version.parse>>
    try {
      resolvedVersion = await Version.parse(instance.minecraftRoot, instance.versionId)
    } catch (error) {
      throw new Error(`无法解析版本：${error instanceof Error ? error.message : String(error)}`)
    }
    // Some PCL2/third-party versions are standalone JSONs whose client jar is
    // stored under the version id (for example versions/RLCraft/RLCraft.jar)
    // while clientVersion points at a different Minecraft version. @xmcl/core
    // chooses the classpath jar from minecraftVersion, so point it at the
    // local jar that actually belongs to this version.
    const clientJarVersion = resolveClientJarVersion(instance, resolvedVersion.minecraftVersion)
    if (clientJarVersion !== resolvedVersion.minecraftVersion) {
      resolvedVersion = { ...resolvedVersion, minecraftVersion: clientJarVersion }
    }
    const requiredMajor = Number((resolvedVersion as any).javaVersion?.majorVersion ?? 17)
    const preferred = instance.javaPath || config.globalJavaPath
    const java = chooseJava(javaList, requiredMajor, preferred)
    if (!java) throw new Error('没有可用的 Java 运行时，请先在「Java 环境」中扫描或手动添加。')
    if (!existsSync(java.path)) throw new Error(`Java 不存在：${java.path}`)

    await mkdir(instance.gameDir, { recursive: true })
    let gameProfile: { name: string; id: string }
    let accessToken: string
    let userType: string
    const extraMCArgs = splitCommandLine(config.gameArgs)
    if (config.accountMode === 'microsoft') {
      const account = await this.getMicrosoftProfile()
      gameProfile = { name: account.name, id: account.uuid }
      accessToken = account.accessToken
      userType = 'msa'
    } else {
      const playerName = sanitizePlayerName(config.playerName)
      gameProfile = { name: playerName, id: offlineUuid(playerName) }
      accessToken = '0'
      userType = 'legacy'
    }
    const accountLabel = config.accountMode === 'microsoft' ? `Microsoft 正版 · ${gameProfile.name}` : `离线账户 · ${gameProfile.name}`
    const maxMemory = Math.max(512, Math.min(65536, instance.memoryMb ?? config.memoryMb))
    const minMemory = Math.max(256, Math.min(config.minMemoryMb, maxMemory))
    const sessionId = newId('game-')
    const session: RuntimeSession = {
      publicState: {
        id: sessionId,
        instanceId,
        instanceName: instance.name,
        status: 'starting',
        startedAt: Date.now(),
        logTail: []
      },
      logs: []
    }
    this.sessions.set(sessionId, session)
    this.pushSessionState(session)
    this.appendLog(session, `[MineHarbor] 正在启动 ${instance.name}`)
    this.appendLog(session, `[MineHarbor] Java: ${java.path} (Java ${java.major}) · 内存 ${minMemory}–${maxMemory} MB`)
    this.appendLog(session, `[MineHarbor] 账户: ${accountLabel}`)

    try {
      const child = await launchMinecraft({
        gamePath: instance.gameDir,
        resourcePath: instance.minecraftRoot,
        javaPath: java.path,
        version: resolvedVersion,
        gameProfile,
        accessToken,
        userType,
        launcherName: 'MineHarbor',
        launcherBrand: 'MineHarbor 1.0.3',
        maxMemory,
        minMemory,
        extraJVMArgs: splitCommandLine(config.jvmArgs),
        extraMCArgs,
        extraExecOption: {
          windowsHide: true,
          cwd: instance.gameDir
        },
        ignoreInvalidMinecraftCertificates: true,
        ignorePatchDiscrepancies: true,
        // External/PCL versions may carry a patched vanilla jar or libraries
        // that no longer match Mojang's SHA-1 metadata. Trust the existing
        // installation and still repair/extract natives and legacy assets.
        ...(instance.external
          ? { prechecks: [LaunchPrecheck.checkLibraries, LaunchPrecheck.checkNatives, LaunchPrecheck.linkAssets] }
          : {})
      } as any)
      session.child = child
      session.publicState.pid = child.pid
      session.publicState.status = 'running'
      this.pushSessionState(session)
      this.attachProcess(session, child, instance.gameDir)
      await this.config.updateInstance(instanceId, { lastPlayedAt: Date.now() })
      return { sessionId, pid: child.pid ?? 0 }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      session.publicState.status = 'error'
      session.publicState.error = message
      session.publicState.endedAt = Date.now()
      this.appendLog(session, `[MineHarbor] 启动失败：${trimDescription(message, 500)}`)
      this.pushSessionState(session)
      throw new Error(`启动失败：${message}`)
    }
  }

  private attachProcess(session: RuntimeSession, child: ChildProcess, gameDir: string): void {
    // Minecraft writes its stdout through a log4j XML appender in some
    // versions. latest.log is already human readable, so prefer tailing it.
    // Keep stdout drained to avoid blocking the JVM.
    child.stdout?.resume()
    child.stdout?.on('error', () => {})
    this.attachStream(session, child.stderr)
    this.startLogTail(session, join(gameDir, 'logs', 'latest.log'))
    child.on('error', (error) => {
      session.publicState.status = 'error'
      session.publicState.error = error.message
      this.appendLog(session, `[MineHarbor] 进程错误：${error.message}`)
      this.pushSessionState(session)
    })
    let settled = false
    const finish = async (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      session.publicState.status = code === 0 ? 'exited' : 'error'
      session.publicState.exitCode = code
      session.publicState.endedAt = Date.now()
      if (code !== 0) session.publicState.error = signal ? `游戏被信号 ${signal} 终止` : `游戏异常退出（代码 ${code ?? '未知'}）`
      // Give the log appender a moment to flush after the process exits.
      await new Promise((resolve) => setTimeout(resolve, 250))
      await session.stopLogTail?.().catch(() => {})
      this.appendLog(
        session,
        signal
          ? `[MineHarbor] 游戏进程已终止（${signal}）`
          : `[MineHarbor] 游戏已退出（代码 ${code ?? '未知'}）`
      )
      this.pushSessionState(session)
      const elapsed = Math.max(0, Date.now() - session.publicState.startedAt)
      const instance = this.config.getInstance(session.publicState.instanceId)
      if (instance) {
        await this.config.updateInstance(instance.id, { playTimeMs: (instance.playTimeMs ?? 0) + elapsed }).catch(() => {})
      }
      this.pruneSessions()
    }
    child.on('exit', (code, signal) => {
      void finish(code, signal)
    })
    child.on('close', (code, signal) => {
      if (!settled) void finish(code, signal)
    })
  }


  /**
   * Follow the Minecraft latest.log file. This avoids exposing the raw log4j
   * XML that some game versions write to stdout and gives the console the same
   * readable lines players see in their log file.
   */
  private startLogTail(session: RuntimeSession, logPath: string): void {
    let offset = -1
    let leftover = ''
    let stopped = false
    let timer: NodeJS.Timeout | undefined
    const startedAt = Date.now()

    const readOnce = async (): Promise<void> => {
      try {
        const info = await stat(logPath)
        if (offset < 0) {
          // Ignore a stale latest.log from the previous launch. If Minecraft
          // truncates it afterwards, the size check below resets the offset.
          offset = info.mtimeMs < startedAt - 1500 ? info.size : 0
        }
        if (info.size < offset) offset = 0
        if (info.size > offset) {
          const handle = await open(logPath, 'r')
          try {
            const length = Math.min(info.size - offset, 256 * 1024)
            const buffer = Buffer.alloc(length)
            const { bytesRead } = await handle.read(buffer, 0, length, offset)
            offset += bytesRead
            leftover += buffer.subarray(0, bytesRead).toString('utf8')
            const lines = leftover.split(/\r?\n/)
            leftover = lines.pop() ?? ''
            for (const raw of lines) {
              const line = stripAnsi(raw).replace(/\r/g, '')
              if (line.trim()) this.appendLog(session, line)
            }
          } finally {
            await handle.close()
          }
        }
      } catch {
        // The log file may not exist yet.
      }
    }

    const tick = async () => {
      if (stopped) return
      await readOnce()
      if (!stopped) timer = setTimeout(() => void tick(), 400)
    }

    timer = setTimeout(() => void tick(), 450)
    session.stopLogTail = async () => {
      if (stopped) return
      stopped = true
      if (timer) clearTimeout(timer)
      await readOnce()
      if (leftover.trim()) {
        this.appendLog(session, stripAnsi(leftover).replace(/\r/g, ''))
        leftover = ''
      }
    }
  }

  private attachStream(session: RuntimeSession, stream: NodeJS.ReadableStream | null): void {
    if (!stream) return
    let buffer = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = stripAnsi(raw).replace(/\r/g, '')
        if (line) this.appendLog(session, line)
      }
      if (buffer.length > 8000) {
        this.appendLog(session, stripAnsi(buffer))
        buffer = ''
      }
    })
    stream.on('error', () => {})
  }

  private appendLog(session: RuntimeSession, line: string): void {
    const clean = line.slice(0, 4000)
    session.logs.push(clean)
    if (session.logs.length > MAX_LOG_LINES) session.logs.splice(0, session.logs.length - MAX_LOG_LINES)
    session.publicState.logTail = session.logs.slice(-160)
    this.emit('game-log', { sessionId: session.publicState.id, line: clean })
  }

  private pushSessionState(session: RuntimeSession): void {
    this.emit('game-state', this.publicSession(session.publicState))
  }

  private publicSession(session: LaunchSession): LaunchSession {
    return {
      ...session,
      logTail: [...session.logTail]
    }
  }

  listSessions(): LaunchSession[] {
    return [...this.sessions.values()]
      .map((session) => this.publicSession(session.publicState))
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  getLogs(sessionId: string): string[] {
    return [...(this.sessions.get(sessionId)?.logs ?? [])]
  }

  async kill(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session?.child) return
    this.appendLog(session, '[MineHarbor] 正在结束游戏进程…')
    session.child.kill('SIGTERM')
  }

  dismiss(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session && ['starting', 'running'].includes(session.publicState.status)) return
    this.sessions.delete(sessionId)
  }

  repair(instanceId: string): InstallSubmission {
    const instance = this.config.getInstance(instanceId)
    if (!instance) throw new Error('找不到该实例')
    if (!instance.loaderVersion && instance.loader !== 'vanilla') {
      throw new Error('无法确定加载器版本，修复失败。请重新安装该版本。')
    }
    const jobId = this.jobs.enqueue(
      'repair',
      `修复 ${instance.name}`,
      {
        mcVersion: instance.mcVersion,
        loader: instance.loader,
        loaderVersion: instance.loaderVersion,
        instanceName: instance.name
      },
      async (job) => {
        const config = this.config.get()
        const javaList = await this.getJava()
        await installCore({
          config,
          root: instance.minecraftRoot,
          source: config.downloadSource,
          javaList,
          mcVersion: instance.mcVersion,
          loader: instance.loader,
          loaderVersion: instance.loaderVersion,
          forceBaseInstall: true,
          job
        })
        job.update({ detail: '游戏文件校验完成', progress: 100 })
      }
    )
    return { jobId }
  }

  updateInstance(instanceId: string, patch: UpdateInstancePatch): Promise<InstanceSummary[]> {
    const instance = this.config.getInstance(instanceId)
    if (!instance) throw new Error('找不到该实例')
    const update: Partial<Instance> = {}
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (!name) throw new Error('实例名称不能为空')
      if (name.length > 50) throw new Error('实例名称不能超过 50 个字符')
      if (this.config.getInstances().some((item) => item.name === name && item.id !== instanceId)) {
        throw new Error('已存在同名实例')
      }
      update.name = name
    }
    if (patch.javaPath !== undefined) update.javaPath = patch.javaPath || undefined
    if (patch.memoryMb !== undefined) {
      update.memoryMb = patch.memoryMb ? Math.max(512, Math.min(65536, Math.round(patch.memoryMb))) : undefined
    }
    return this.config.updateInstance(instanceId, update).then(() => this.config.summaries())
  }

  async removeInstance(instanceId: string, deleteFiles = false): Promise<InstanceSummary[]> {
    const config = this.config.get()
    const instance = this.config.getInstance(instanceId)
    if (!instance) throw new Error('找不到该实例')
    const running = this.listSessions().some(
      (session) => session.instanceId === instanceId && ['starting', 'running'].includes(session.status)
    )
    if (running) throw new Error('请先退出该实例中的游戏')
    await this.config.removeInstance(instanceId)
    if (deleteFiles && !instance.external) {
      const instancesRoot = join(instance.minecraftRoot, 'instances')
      if (instance.gameDir.toLowerCase().startsWith(instancesRoot.toLowerCase())) {
        const { rm } = await import('node:fs/promises')
        await rm(instance.gameDir, { recursive: true, force: true }).catch(() => {})
      }
    }
    return this.config.summaries()
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      try {
        session.child?.kill()
      } catch {
        // ignore
      }
    }
  }

  private pruneSessions(): void {
    const completed = [...this.sessions.values()]
      .filter((session) => !['starting', 'running'].includes(session.publicState.status))
      .sort((a, b) => (a.publicState.endedAt ?? 0) - (b.publicState.endedAt ?? 0))
    while (this.sessions.size > MAX_SESSIONS && completed.length) {
      const session = completed.shift()
      if (session) this.sessions.delete(session.publicState.id)
    }
  }
}

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '')
}

export type { JobContext, JobState }

function scaledJobContext(job: JobContext, range: { from: number; to: number }): JobContext {
  const scale = (progress: number) => range.from + (Math.max(0, Math.min(100, progress)) / 100) * (range.to - range.from)
  return {
    update(patch) {
      const numeric = Number(patch.progress)
      job.update({
        ...patch,
        progress: patch.progress === undefined || !Number.isFinite(numeric) ? undefined : scale(numeric)
      })
    },
    get() {
      const current = job.get()
      return { ...current, progress: scale(current.progress) }
    }
  }
}