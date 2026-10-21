import {
  installTask,
  installLibrariesTask,
  installFabric,
  installForgeTask
} from '@xmcl/installer'
import { Version } from '@xmcl/core'
import { Agent } from 'undici'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import type { DownloadSource, JavaInfo, LauncherConfig, LoaderType, VersionCatalog } from '../../shared/types'
import type { JobContext } from './jobs'
import {
  SOURCE_ENDPOINTS,
  assetsIndexUrls,
  libraryDownloadUrls,
  sourceOrder,
  toBmclUrl
} from './sources'
import { fetchFirstJson } from './http'
import { getVersionCatalog } from './catalog'
import { chooseJava } from './java'
import { installNeoForge } from './neoforge'

const downloadAgent = new Agent({
  connections: 24,
  pipelining: 1,
  connect: { timeout: 15_000 },
  headersTimeout: 25_000,
  bodyTimeout: 45_000
})

export interface InstallCoreOptions {
  config: LauncherConfig
  /** Override the target Minecraft root for this install. */
  root?: string
  source: DownloadSource
  javaList: JavaInfo[]
  mcVersion: string
  loader: LoaderType
  loaderVersion?: string
  job: JobContext
  catalog?: VersionCatalog
  /** Force a full vanilla integrity pass even if a completion marker exists. */
  forceBaseInstall?: boolean
}

export interface InstallCoreResult {
  versionId: string
  mcVersion: string
  loader: LoaderType
  loaderVersion?: string
  javaPath?: string
  javaMajor: number
}

export interface InstallProgressRange {
  from: number
  to: number
}

/**
 * Install the vanilla base game plus an optional mod loader into a Minecraft
 * root. Downloads are served through the selected source with public-source
 * fallbacks.
 */
export async function installCore(options: InstallCoreOptions): Promise<InstallCoreResult> {
  const { config, source, job } = options
  const root = options.root ?? config.gameRoot
  const catalog = options.catalog ?? (await getVersionCatalog(source))
  const meta = catalog.versions.find((version) => version.id === options.mcVersion)
  if (!meta) throw new Error('版本清单中找不到 Minecraft ' + options.mcVersion)

  const downloadOptions = createDownloadOptions(source, config)
  job.update({ stage: 'meta', detail: '正在准备版本信息…', progress: 3 })

  const jsonUrls =
    source === 'official'
      ? [meta.url, SOURCE_ENDPOINTS.bmclapi.versionJson(meta.id)]
      : [SOURCE_ENDPOINTS.bmclapi.versionJson(meta.id), meta.url]
  // The URL must keep the official hashed path: xmcl extracts the expected
  // SHA1 from it. Metadata bytes can still come from a mirror via the json list.
  const versionMeta = { id: meta.id, url: meta.url }

  const baseMarker = join(root, '.mineharbor', 'base-' + meta.id + '.json')
  const baseVersionJson = join(root, 'versions', meta.id, meta.id + '.json')
  const baseJar = join(root, 'versions', meta.id, meta.id + '.jar')
  let skipBase =
    !options.forceBaseInstall &&
    options.loader !== 'vanilla' &&
    existsSync(baseMarker) &&
    existsSync(baseVersionJson) &&
    existsSync(baseJar)
  let javaMajor = 17

  if (skipBase) {
    try {
      const parsedBase = await Version.parse(root, meta.id)
      javaMajor = Number((parsedBase as unknown as { javaVersion?: { majorVersion?: number } }).javaVersion?.majorVersion ?? 17)
      job.update({ stage: 'minecraft', detail: '基础游戏文件已就绪', progress: 48 })
    } catch {
      skipBase = false
    }
  }

  if (!skipBase) {
    job.update({ stage: 'minecraft', detail: '正在安装 Minecraft ' + meta.id + ' 基础文件…', progress: 5 })
    const vanillaTask = installTask(versionMeta, root, {
      ...downloadOptions,
      side: 'client',
      json: jsonUrls,
      client: (version: { downloads?: { client?: { url?: string } } }) => {
        const originalUrl = version.downloads?.client?.url
        if (!originalUrl) return undefined
        return source === 'official'
          ? [originalUrl, toBmclUrl(originalUrl)]
          : [toBmclUrl(originalUrl), originalUrl]
      }
    } as never)
    const resolved = (await runTask(vanillaTask, job, { from: 5, to: 48 }, '基础游戏')) as {
      javaVersion?: { majorVersion?: number }
    }
    javaMajor = Number(resolved?.javaVersion?.majorVersion ?? 17)
    try {
      await mkdir(dirname(baseMarker), { recursive: true })
      await writeFile(baseMarker, JSON.stringify({ id: meta.id, completedAt: new Date().toISOString() }), 'utf8')
    } catch {
      // A marker failure must not fail an otherwise successful install.
    }
  }

  let versionId = meta.id
  const loaderVersion = options.loaderVersion

  if (options.loader === 'fabric') {
    if (!loaderVersion) throw new Error('请选择 Fabric Loader 版本')
    job.update({ stage: 'loader', detail: '正在安装 Fabric Loader ' + loaderVersion + '…', progress: 52 })
    const artifact = await fetchFabricArtifact(options.mcVersion, loaderVersion, source)
    versionId = await installFabric(artifact as never, root, {
      ...downloadOptions,
      side: 'client',
      versionId: 'fabric-loader-' + loaderVersion + '-' + options.mcVersion,
      inheritsFrom: options.mcVersion
    } as never)
    job.update({ stage: 'loader', detail: '正在补全 Fabric 运行库…', progress: 68 })
    const fabricVersion = await Version.parse(root, versionId)
    const depTask = installLibrariesTask(fabricVersion, downloadOptions as never)
    await runTask(depTask, job, { from: 68, to: 92 }, 'Fabric 运行库')
  } else if (options.loader === 'forge') {
    if (!loaderVersion) throw new Error('请选择 Forge 版本')
    const java = selectInstallerJava(options.javaList, javaMajor, config)
    if (!java) throw new Error('安装 Forge 需要 Java，请先在「Java 环境」中添加或扫描 Java。')
    job.update({ stage: 'loader', detail: '正在安装 Forge ' + loaderVersion + '（安装器需要 Java）…', progress: 52 })
    const forgeTask = installForgeTask(
      { mcversion: options.mcVersion, version: loaderVersion },
      root,
      {
        ...downloadOptions,
        side: 'client',
        java: java.path,
        inheritsFrom: options.mcVersion
      } as never
    )
    versionId = String(await runTask(forgeTask, job, { from: 52, to: 82 }, 'Forge 安装器'))
    job.update({ stage: 'loader', detail: '正在补全 Forge 运行库…', progress: 84 })
    const forgeVersion = await Version.parse(root, versionId)
    const depTask = installLibrariesTask(forgeVersion, downloadOptions as never)
    await runTask(depTask, job, { from: 84, to: 94 }, 'Forge 运行库')
  } else if (options.loader === 'neoforge') {
    if (!loaderVersion) throw new Error('请选择 NeoForge 版本')
    const java = selectInstallerJava(options.javaList, javaMajor, config)
    if (!java) throw new Error('安装 NeoForge 需要 Java，请先在「Java 环境」中添加或扫描 Java。')
    versionId = await installNeoForge({
      root,
      mcVersion: options.mcVersion,
      loaderVersion,
      source,
      javaPath: java.path,
      job
    })
  }

  const finalVersion = await Version.parse(root, versionId)
  const finalVersionTyped = finalVersion as unknown as { javaVersion?: { majorVersion?: number } }
  const requiredJava = Number(finalVersionTyped.javaVersion?.majorVersion ?? javaMajor ?? 17)
  const preferredJava = selectInstallerJava(options.javaList, requiredJava, config)
  job.update({ stage: 'finishing', detail: '正在整理实例目录…', progress: 96 })
  return {
    versionId,
    mcVersion: options.mcVersion,
    loader: options.loader,
    loaderVersion: options.loaderVersion,
    javaPath: preferredJava?.path,
    javaMajor: requiredJava
  }
}

export async function ensureInstanceReady(options: InstallCoreOptions): Promise<void> {
  await installCore(options)
}

async function fetchFabricArtifact(mcVersion: string, loaderVersion: string, source: DownloadSource): Promise<unknown> {
  const urls = sourceOrder(source).map(
    (id) =>
      SOURCE_ENDPOINTS[id].fabricMeta +
      '/versions/loader/' +
      encodeURIComponent(mcVersion) +
      '/' +
      encodeURIComponent(loaderVersion)
  )
  const result = await fetchFirstJson<Record<string, unknown>>([...new Set(urls)], { timeoutMs: 25_000 })
  if (!result.data || !(result.data as { launcherMeta?: unknown }).launcherMeta) {
    throw new Error('Fabric 元数据响应不完整')
  }
  return result.data
}

function selectInstallerJava(javaList: JavaInfo[], requiredMajor: number, config: LauncherConfig): JavaInfo | undefined {
  if (!javaList.length) return undefined
  if (config.globalJavaPath) {
    const global = chooseJava(javaList, requiredMajor, config.globalJavaPath)
    if (global) return global
  }
  return chooseJava(javaList, requiredMajor)
}

export function createDownloadOptions(source: DownloadSource, config: LauncherConfig): Record<string, unknown> {
  const order = sourceOrder(source)
  const mavenHosts: string[] = []
  for (const id of order) {
    const endpoints = SOURCE_ENDPOINTS[id]
    mavenHosts.push(endpoints.maven)
    if (id === 'official') {
      mavenHosts.push('https://maven.minecraftforge.net', 'https://maven.neoforged.net/releases', 'https://maven.fabricmc.net')
    }
  }
  mavenHosts.push('https://maven.fabricmc.net', 'https://maven.minecraftforge.net', 'https://maven.neoforged.net/releases')
  return {
    libraryHost: (library: { name: string; path: string; download?: { url?: string } }) =>
      libraryDownloadUrls(library.name, library.path, library.download?.url, source),
    mavenHost: [...new Set(mavenHosts)],
    assetsHost: [...new Set(order.map((id) => SOURCE_ENDPOINTS[id].assetsBase))],
    assetsIndexUrl: (version: {
      assetIndex?: { url?: string; sha1?: string; id?: string }
      assets?: string
    }) => {
      const assetIndex = version.assetIndex
      if (!assetIndex?.sha1) return []
      return assetsIndexUrls(assetIndex.url, assetIndex.sha1, assetIndex.id ?? version.assets ?? '', source)
    },
    librariesDownloadConcurrency: config.downloadConcurrency,
    assetsDownloadConcurrency: config.downloadConcurrency,
    maxConcurrency: config.downloadConcurrency,
    // A tuned dispatcher prevents one stalled CDN connection from blocking the
    // whole install for many minutes.
    agent: { dispatcher: downloadAgent },
    headers: { 'User-Agent': 'MineHarbor/1.0.3 (Minecraft launcher)' },
    side: 'client'
  }
}

export async function runTask(
  rootTask: {
    total?: number
    progress?: number
    get: () => unknown
    startAndWait: (callbacks: Record<string, unknown>) => Promise<unknown>
  },
  job: JobContext,
  range: InstallProgressRange,
  label: string
): Promise<unknown> {
  let lastPercent = range.from
  let lastUpdate = 0
  let lastStage = ''
  job.update({
    stage: 'download',
    detail: label + ' · 开始下载…',
    progress: Math.max(job.get().progress, range.from)
  })

  try {
    await rootTask.startAndWait({
      onStart(task: { path?: string; name?: string }) {
        const stage = describeTask(task)
        if (stage !== lastStage) {
          lastStage = stage
          job.update({ stage: 'download', detail: label + ' · ' + stage })
        }
      },
      onUpdate(childTask: { total?: number; progress?: number; path?: string; name?: string }) {
        const now = Date.now()
        if (now - lastUpdate < 180) return
        lastUpdate = now
        const rawTotal = Number(rootTask.total) || Number(childTask.total) || 0
        const rawProgress = Number(rootTask.total) ? Number(rootTask.progress) : Number(childTask.progress)
        const total = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 0
        const progress = Number.isFinite(rawProgress) && rawProgress > 0 ? rawProgress : 0
        const ratio = total > 0 ? Math.max(0, Math.min(1, progress / total)) : 0
        const candidate = range.from + (range.to - range.from) * ratio
        const percent = Number.isFinite(candidate) ? Math.max(lastPercent, candidate) : lastPercent
        lastPercent = percent
        job.update({ stage: 'download', detail: label + ' · ' + describeTask(childTask), progress: percent })
      }
    })
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }

  job.update({ progress: Math.max(lastPercent, range.to), detail: label + ' · 完成' })
  return rootTask.get()
}

export function describeTask(task: { path?: string; name?: string }): string {
  const path = String(task?.path ?? '').toLowerCase()
  if (path.includes('version.json') || path.includes('json')) return '获取版本元数据'
  if (path.includes('version.jar') || path.endsWith('.jar')) return '下载游戏核心'
  if (path.includes('assets') || path.includes('asset')) return '下载资源与音效'
  if (path.includes('libraries') || path.includes('library')) return '下载运行库'
  if (path.includes('installer')) return '下载加载器安装器'
  if (path.includes('processor') || path.includes('postprocess')) return '执行安装处理器'
  if (path.includes('dependencies')) return '校验运行环境'
  return task?.name ? String(task.name) : '下载文件'
}