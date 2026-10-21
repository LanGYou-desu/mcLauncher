import AdmZip from 'adm-zip'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  InstallContentRequest,
  InstallModpackRequest,
  InstallSubmission,
  Instance,
  ModrinthProject,
  ModrinthVersion
} from '../../shared/types'
import type { ConfigStore } from './config'
import type { JobContext, JobManager } from './jobs'
import type { GameService } from './game'
import { ModrinthClient, isVersionCompatible, isValidModrinthId, primaryFile, usableFileName } from './modrinth'
import { downloadFile, mapWithConcurrency } from './http'
import { baseNameOf, resolveInside, safeFileName } from './util'

export interface ContentInstallerOptions {
  config: ConfigStore
  jobs: JobManager
  game: GameService
  cacheDir: string
  modrinth?: ModrinthClient
}

interface DownloadPlanItem {
  version: ModrinthVersion
  projectId: string
  title: string
  destination: string
  url: string
  fileName: string
  sha1?: string
  sha512?: string
  size?: number
}

interface MrpackFile {
  path: string
  hashes?: { sha1?: string; sha512?: string }
  env?: { client?: string; server?: string }
  downloads: string[]
  fileSize?: number
}

export interface MrpackIndex {
  formatVersion: number
  game: string
  versionId: string
  name: string
  summary?: string
  files: MrpackFile[]
  dependencies: Record<string, string>
}

interface LoaderSelection {
  mcVersion: string
  loader: 'vanilla' | 'fabric' | 'forge' | 'neoforge'
  loaderVersion?: string
}

const CONTENT_FOLDERS: Record<'mod' | 'shader' | 'resourcepack', string> = {
  mod: 'mods',
  shader: 'shaderpacks',
  resourcepack: 'resourcepacks'
}

const MODRINTH_PROJECT_TYPES: Record<string, string> = {
  mod: 'mod',
  shader: 'shader',
  resourcepack: 'resourcepack'
}

export class ContentInstaller {
  private readonly config: ConfigStore
  private readonly jobs: JobManager
  private readonly game: GameService
  private readonly cacheDir: string
  private readonly modrinth: ModrinthClient

  constructor(options: ContentInstallerOptions) {
    this.config = options.config
    this.jobs = options.jobs
    this.game = options.game
    this.cacheDir = options.cacheDir
    this.modrinth = options.modrinth ?? new ModrinthClient()
  }

  get client(): ModrinthClient {
    return this.modrinth
  }

  async installContent(request: InstallContentRequest): Promise<InstallSubmission> {
    if (!request || !isValidModrinthId(request.projectId) || !isValidModrinthId(request.versionId)) {
      throw new Error('下载参数无效')
    }
    if (!['mod', 'shader', 'resourcepack'].includes(request.kind)) throw new Error('未知的内容类型')
    const instance = this.config.getInstance(request.instanceId)
    if (!instance) throw new Error('找不到目标实例')
    const [project, version] = await Promise.all([
      this.modrinth.project(request.projectId),
      this.modrinth.version(request.versionId)
    ])
    if (project.project_type !== MODRINTH_PROJECT_TYPES[request.kind]) {
      throw new Error(`该资源不是${request.kind === 'mod' ? '模组' : request.kind === 'shader' ? '光影' : '资源包'}`)
    }
    if (!isVersionCompatible(version, instance, request.kind)) {
      throw new Error('该版本不兼容当前实例的 Minecraft 或加载器版本')
    }
    const file = primaryFile(version, request.kind)
    const title = `安装${request.kind === 'mod' ? '模组' : request.kind === 'shader' ? '光影' : '资源包'} ${project.title}`
    const jobId = this.jobs.enqueue(
      'content',
      title,
      { instanceName: instance.name, mcVersion: instance.mcVersion, loader: instance.loader },
      async (job) => {
        job.update({ stage: 'resolve', detail: '正在解析下载文件与必需依赖…', progress: 4 })
        const plan = await this.buildInstallPlan(project, version, instance, request.kind, file, request.installDependencies !== false, job)
        job.update({ stage: 'download', detail: `准备下载 ${plan.length} 个文件…`, progress: 8 })
        let completed = 0
        for (const item of plan) {
          const from = 8 + (completed / Math.max(1, plan.length)) * 82
          const to = 8 + ((completed + 1) / Math.max(1, plan.length)) * 82
          job.update({
            stage: 'download',
            detail: `正在下载 ${item.title} · ${item.fileName}`,
            progress: from
          })
          await downloadFile(item.url, item.destination, {
            expectedSha1: item.sha1,
            expectedSha512: item.sha512,
            expectedSize: item.size,
            onProgress: (received, total) => {
              const ratio = total > 0 ? Math.min(1, received / total) : 0
              job.update({ progress: from + (to - from) * ratio })
            }
          })
          completed++
        }
        job.update({
          stage: 'done',
          detail: `已安装到「${instance.name}」${plan.length > 1 ? `（含 ${plan.length - 1} 个依赖）` : ''}`,
          progress: 100
        })
      }
    )
    return { jobId }
  }

  private async buildInstallPlan(
    project: ModrinthProject,
    version: ModrinthVersion,
    instance: Instance,
    kind: 'mod' | 'shader' | 'resourcepack',
    file: ReturnType<typeof primaryFile>,
    withDependencies: boolean,
    job: JobContext
  ): Promise<DownloadPlanItem[]> {
    const destinationDir = join(instance.gameDir, CONTENT_FOLDERS[kind])
    const plan: DownloadPlanItem[] = [
      this.planItem(project.id, project.title, file, destinationDir)
    ]
    if (!withDependencies || kind !== 'mod') return plan

    const visited = new Set<string>([project.id])
    const queue: Array<{ dependencyProjectId: string; versionId?: string; depth: number }> = []
    for (const dependency of version.dependencies ?? []) {
      if (dependency.dependency_type !== 'required' || !dependency.project_id) continue
      if (visited.has(dependency.project_id)) continue
      visited.add(dependency.project_id)
      queue.push({ dependencyProjectId: dependency.project_id, versionId: dependency.version_id ?? undefined, depth: 1 })
    }
    const maxDependencies = 24
    while (queue.length && plan.length < maxDependencies) {
      const item = queue.shift()
      if (!item) break
      const resolved = await this.resolveDependencyVersion(item.dependencyProjectId, item.versionId, instance)
      if (!resolved) {
        job.update({ detail: '有必需依赖没有兼容版本，已跳过' })
        continue
      }
      try {
        const depFile = primaryFile(resolved.version, 'mod')
        plan.push(this.planItem(resolved.project.id, resolved.project.title, depFile, destinationDir))
        if (item.depth < 2) {
          for (const dependency of resolved.version.dependencies ?? []) {
            if (dependency.dependency_type !== 'required' || !dependency.project_id) continue
            if (visited.has(dependency.project_id)) continue
            visited.add(dependency.project_id)
            queue.push({
              dependencyProjectId: dependency.project_id,
              versionId: dependency.version_id ?? undefined,
              depth: item.depth + 1
            })
          }
        }
      } catch {
        job.update({ detail: `依赖 ${resolved.project.title} 没有可用文件，已跳过` })
      }
    }
    return plan
  }

  private async resolveDependencyVersion(
    projectId: string,
    versionId: string | undefined,
    instance: Instance
  ): Promise<{ project: ModrinthProject; version: ModrinthVersion } | null> {
    const project = await this.modrinth.project(projectId).catch(() => null)
    if (!project || project.project_type !== 'mod') return null
    if (versionId) {
      try {
        const version = await this.modrinth.version(versionId)
        if (isVersionCompatible(version, instance, 'mod')) return { project, version }
      } catch {
        // Fall through to the compatible version list.
      }
    }
    const versions = await this.modrinth.versions(project.id).catch(() => [])
    const compatible = versions.find((version) => isVersionCompatible(version, instance, 'mod'))
    return compatible ? { project, version: compatible } : null
  }

  private planItem(
    projectId: string,
    title: string,
    file: { filename: string; url: string; hashes?: { sha1?: string; sha512?: string }; size?: number },
    destinationDir: string
  ): DownloadPlanItem {
    const fileName = safeFileName(baseNameOf(file.filename), `${safeFileName(title)}.jar`)
    return {
      version: {} as ModrinthVersion,
      projectId,
      title,
      destination: join(destinationDir, fileName),
      url: file.url,
      fileName,
      sha1: file.hashes?.sha1,
      sha512: file.hashes?.sha512,
      size: file.size
    }
  }

  async installModpack(request: InstallModpackRequest): Promise<InstallSubmission> {
    if (!isValidModrinthId(request.projectId) || !isValidModrinthId(request.versionId)) {
      throw new Error('整合包参数无效')
    }
    const [project, version] = await Promise.all([
      this.modrinth.project(request.projectId),
      this.modrinth.version(request.versionId)
    ])
    if (project.project_type !== 'modpack') throw new Error('该项目不是整合包')
    const file = primaryFile(version, 'modpack')
    await mkdir(join(this.cacheDir, 'packs'), { recursive: true })
    const packPath = join(
      this.cacheDir,
      'packs',
      `${safeFileName(project.slug || project.title)}-${safeFileName(version.id)}.mrpack`
    )
    const jobId = this.jobs.enqueue(
      'modpack',
      `安装整合包 ${project.title}`,
      { mcVersion: '', instanceName: project.title },
      async (job) => {
        job.update({ stage: 'pack', detail: '正在下载整合包文件…', progress: 2 })
        await downloadFile(file.url, packPath, {
          expectedSha1: file.hashes?.sha1,
          expectedSha512: file.hashes?.sha512,
          expectedSize: file.size,
          onProgress: (received, total) => {
            const ratio = total > 0 ? Math.min(1, received / total) : 0
            job.update({ progress: 2 + ratio * 7 })
          }
        })
        const index = readMrpackIndex(packPath)
        job.update({ stage: 'resolve', detail: `整合包包含 ${index.files.length} 个文件，正在解析加载器…`, progress: 10 })
        const instance = await this.installPackInstance(index, {
          name: request.name || project.title,
          projectId: project.id,
          versionId: version.id,
          iconUrl: project.icon_url ?? undefined
        }, job, packPath, 10, 55)
        await this.installPackFiles(packPath, index, instance, job, 56, 95)
        job.update({ stage: 'done', detail: `整合包已安装到「${instance.name}」`, progress: 100 })
      }
    )
    return { jobId }
  }

  async importModpack(filePath: string): Promise<InstallSubmission> {
    if (!filePath || !existsSync(filePath)) throw new Error('整合包文件不存在')
    const lower = filePath.toLowerCase()
    if (!lower.endsWith('.mrpack') && !lower.endsWith('.zip')) throw new Error('仅支持 Modrinth .mrpack 格式整合包')
    const index = readMrpackIndex(filePath)
    const jobId = this.jobs.enqueue(
      'modpack',
      `导入整合包 ${index.name || basename(filePath)}`,
      { mcVersion: index.dependencies.minecraft ?? '', instanceName: index.name },
      async (job) => {
        job.update({ stage: 'resolve', detail: '正在校验本地整合包…', progress: 4 })
        const instance = await this.installPackInstance(index, {
          name: index.name || basename(filePath).replace(/\.(mrpack|zip)$/i, ''),
          projectId: undefined,
          versionId: index.versionId,
          iconUrl: undefined
        }, job, filePath, 7, 54)
        await this.installPackFiles(filePath, index, instance, job, 55, 96)
        job.update({ stage: 'done', detail: `整合包已导入到「${instance.name}」`, progress: 100 })
      }
    )
    return { jobId }
  }

  private async installPackInstance(
    index: MrpackIndex,
    meta: { name: string; projectId?: string; versionId: string; iconUrl?: string },
    job: JobContext,
    packPath: string,
    from: number,
    to: number
  ): Promise<Instance> {
    const selection = loaderFromIndex(index)
    job.update({
      stage: 'game',
      detail: `正在安装 Minecraft ${selection.mcVersion}${selection.loader !== 'vanilla' ? ` · ${selection.loader}` : ''}…`,
      progress: from
    })
    const instance = await this.game.installModpackInstance(
      {
        mcVersion: selection.mcVersion,
        loader: selection.loader,
        loaderVersion: selection.loaderVersion,
        name: meta.name,
        modpack: {
          projectId: meta.projectId,
          versionId: meta.versionId,
          name: meta.name,
          iconUrl: meta.iconUrl
        }
      },
      job,
      { from, to }
    )
    // Remember where the pack came from in a small metadata file.
    await mkdir(join(instance.gameDir, '.mineharbor'), { recursive: true })
    await writeFile(
      join(instance.gameDir, '.mineharbor', 'modpack.json'),
      JSON.stringify(
        {
          name: meta.name,
          projectId: meta.projectId,
          versionId: meta.versionId,
          sourceFile: packPath,
          installedAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    )
    return instance
  }

  private async installPackFiles(
    packPath: string,
    index: MrpackIndex,
    instance: Instance,
    job: JobContext,
    from: number,
    to: number
  ): Promise<void> {
    const files = index.files.filter((file) => file.env?.client !== 'unsupported')
    job.update({ stage: 'files', detail: `正在下载整合包内容（0/${files.length}）…`, progress: from })
    let completed = 0
    await mapWithConcurrency(files, 4, async (file) => {
      if (!file.downloads?.length) throw new Error(`文件 ${file.path} 缺少下载地址`)
      const target = resolveInside(instance.gameDir, normalizeZipPath(file.path))
      if (!target) throw new Error(`整合包包含非法路径：${file.path}`)
      await downloadFile(file.downloads, target, {
        expectedSha1: file.hashes?.sha1,
        expectedSha512: file.hashes?.sha512,
        expectedSize: file.fileSize
      })
      completed++
      const ratio = completed / Math.max(1, files.length)
      job.update({
        stage: 'files',
        detail: `正在下载整合包内容（${completed}/${files.length}）…`,
        progress: from + (to - from) * ratio * 0.88
      })
    })

    job.update({ stage: 'overrides', detail: '正在应用整合包配置与汉化覆盖…', progress: from + (to - from) * 0.9 })
    const overrides = await applyOverrides(packPath, instance.gameDir)
    job.update({
      stage: 'finishing',
      detail: `已应用 ${overrides} 个覆盖文件，正在完成安装…`,
      progress: from + (to - from) * 0.98
    })
  }

  async getProject(projectId: string): Promise<ModrinthProject> {
    return this.modrinth.project(projectId)
  }

  async getVersions(projectId: string): Promise<ModrinthVersion[]> {
    return this.modrinth.versions(projectId)
  }
}

export function loaderFromIndex(index: MrpackIndex): LoaderSelection {
  const mcVersion = index.dependencies?.minecraft
  if (!mcVersion) throw new Error('整合包缺少 Minecraft 版本信息')
  let loader: LoaderSelection['loader'] = 'vanilla'
  let loaderVersion: string | undefined
  if (index.dependencies['neoforge']) {
    loader = 'neoforge'
    loaderVersion = index.dependencies['neoforge']
  } else if (index.dependencies['forge']) {
    loader = 'forge'
    loaderVersion = index.dependencies['forge']
  } else if (index.dependencies['fabric-loader']) {
    loader = 'fabric'
    loaderVersion = index.dependencies['fabric-loader']
  } else if (index.dependencies['quilt-loader']) {
    throw new Error('暂不支持 Quilt 加载器的整合包')
  }
  if (loader !== 'vanilla' && !loaderVersion) throw new Error('整合包加载器版本缺失')
  return { mcVersion, loader, loaderVersion }
}

export function readMrpackIndex(packPath: string): MrpackIndex {
  const zip = new AdmZip(packPath)
  const entry = zip.getEntry('modrinth.index.json')
  if (!entry) throw new Error('不是有效的 Modrinth 整合包：缺少 modrinth.index.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(entry.getData().toString('utf8'))
  } catch {
    throw new Error('整合包索引 JSON 损坏')
  }
  const index = parsed as MrpackIndex
  if (!index || typeof index !== 'object' || !Array.isArray(index.files) || !index.dependencies) {
    throw new Error('整合包索引格式无效')
  }
  if (index.formatVersion !== 1) throw new Error(`不支持的整合包格式版本：${index.formatVersion}`)
  if (!index.dependencies.minecraft) throw new Error('整合包没有声明 Minecraft 版本')
  return index
}

function normalizeZipPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

async function applyOverrides(packPath: string, gameDir: string): Promise<number> {
  const zip = new AdmZip(packPath)
  let count = 0
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const entryName = normalizeZipPath(entry.entryName)
    let relative: string
    if (entryName.startsWith('overrides/')) relative = entryName.slice('overrides/'.length)
    else if (entryName.startsWith('client-overrides/')) relative = entryName.slice('client-overrides/'.length)
    else continue
    if (!relative) continue
    const target = resolveInside(gameDir, relative)
    if (!target) continue
    try {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, entry.getData())
      count++
    } catch {
      // A single unwritable override should not abort the whole install.
    }
  }
  return count
}

export type { MrpackIndex as ModpackIndex }
