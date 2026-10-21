import AdmZip from 'adm-zip'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DownloadSource } from '../../shared/types'
import type { JobContext } from './jobs'
import { downloadFile, mapWithConcurrency, sha1File } from './http'
import { SOURCE_ENDPOINTS, sourceOrder, toBmclUrl } from './sources'

interface InstallerArtifact {
  path: string
  url: string
  sha1?: string
  size?: number
}

interface InstallerLibrary {
  name: string
  downloads?: {
    artifact?: InstallerArtifact
    classifiers?: Record<string, InstallerArtifact>
  }
}

interface InstallerProfile {
  version?: string
  libraries?: InstallerLibrary[]
}

interface InstallerVersion {
  id?: string
  libraries?: InstallerLibrary[]
}

interface InstallerContents {
  profile: InstallerProfile
  version: InstallerVersion
  versionId: string
}

export interface NeoForgeInstallOptions {
  root: string
  mcVersion: string
  loaderVersion: string
  source: DownloadSource
  javaPath: string
  job: JobContext
}

function installerCoordinates(mcVersion: string, loaderVersion: string): { project: 'forge' | 'neoforge'; artifactVersion: string; path: string } {
  // NeoForge for 1.20.1 is published under net.neoforged:forge.
  const project = mcVersion === '1.20.1' ? 'forge' : 'neoforge'
  const artifactVersion = project === 'forge' ? mcVersion + '-' + loaderVersion : loaderVersion
  const fileName = project + '-' + artifactVersion + '-installer.jar'
  return {
    project,
    artifactVersion,
    path: 'net/neoforged/' + project + '/' + artifactVersion + '/' + fileName
  }
}

function installerUrls(source: DownloadSource, relativePath: string): string[] {
  const bases: string[] = []
  for (const id of sourceOrder(source)) {
    const base = id === 'official' ? SOURCE_ENDPOINTS.official.neoforgeMaven : SOURCE_ENDPOINTS.bmclapi.maven
    if (!bases.includes(base)) bases.push(base)
  }
  return bases.map((base) => base.replace(/\/$/, '') + '/' + relativePath)
}

function readInstaller(file: string): InstallerContents {
  const zip = new AdmZip(file)
  const profileEntry = zip.getEntry('install_profile.json')
  const versionEntry = zip.getEntry('version.json')
  if (!profileEntry || !versionEntry) throw new Error('安装器缺少 install_profile.json 或 version.json')
  const profile = JSON.parse(profileEntry.getData().toString('utf8')) as InstallerProfile
  const version = JSON.parse(versionEntry.getData().toString('utf8')) as InstallerVersion
  if (!version.id) throw new Error('NeoForge 安装器版本信息缺少 id')
  return { profile, version, versionId: version.id }
}

async function readInstallerIfValid(file: string): Promise<InstallerContents | null> {
  if (!existsSync(file)) return null
  try {
    return readInstaller(file)
  } catch {
    return null
  }
}

function libraryArtifacts(contents: InstallerContents): InstallerArtifact[] {
  const map = new Map<string, InstallerArtifact>()
  for (const library of [...(contents.profile.libraries ?? []), ...(contents.version.libraries ?? [])]) {
    const artifact = library.downloads?.artifact
    if (artifact?.path && artifact.url) map.set(artifact.path, artifact)
    for (const classifier of Object.values(library.downloads?.classifiers ?? {})) {
      if (classifier?.path && classifier.url) map.set(classifier.path, classifier)
    }
  }
  return [...map.values()]
}

async function fileSha1Matches(file: string, expected: string): Promise<boolean> {
  try {
    return (await sha1File(file)).toLowerCase() === expected.toLowerCase()
  } catch {
    return false
  }
}

async function prefetchLibraries(
  root: string,
  artifacts: InstallerArtifact[],
  source: DownloadSource,
  job: JobContext
): Promise<void> {
  let completed = 0
  let lastUpdate = 0
  const errors: string[] = []
  const total = artifacts.length
  job.update({ stage: 'loader', detail: '正在补全 NeoForge 安装依赖（0/' + total + '）…', progress: 56 })

  await mapWithConcurrency(artifacts, 4, async (artifact) => {
    const destination = join(root, 'libraries', ...artifact.path.split('/'))
    if (existsSync(destination)) {
      if (!artifact.sha1 || (await fileSha1Matches(destination, artifact.sha1))) {
        completed++
        return
      }
    }
    const candidates = source === 'official'
      ? [artifact.url, toBmclUrl(artifact.url)]
      : [toBmclUrl(artifact.url), artifact.url]
    try {
      await downloadFile([...new Set(candidates)], destination, {
        expectedSha1: artifact.sha1,
        expectedSize: artifact.size && artifact.size > 0 ? artifact.size : undefined,
        timeoutMs: 120_000
      })
    } catch (error) {
      errors.push(artifact.path + ': ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      completed++
      const now = Date.now()
      if (now - lastUpdate > 500 || completed === total) {
        lastUpdate = now
        job.update({
          stage: 'loader',
          detail: '正在补全 NeoForge 安装依赖（' + completed + '/' + total + '）…',
          progress: 56 + (completed / Math.max(1, total)) * 16
        })
      }
    }
  })

  if (errors.length) {
    throw new Error('NeoForge 依赖下载失败：' + errors.slice(0, 3).join('；'))
  }
}

async function ensureLauncherProfile(root: string): Promise<void> {
  const path = join(root, 'launcher_profiles.json')
  if (existsSync(path)) {
    try {
      JSON.parse(await readFile(path, 'utf8'))
      return
    } catch {
      // rewrite invalid profile below
    }
  }
  await writeFile(path, JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2), 'utf8')
}

function runInstallerProcess(
  javaPath: string,
  installerPath: string,
  root: string,
  job: JobContext
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      javaPath,
      ['-Xms512M', '-Xmx2G', '-jar', installerPath, '--offline', '--install-client', root],
      {
        cwd: root,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let output = ''
    let patches = 0
    let lastUpdate = 0
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const consume = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      output = (output + text).slice(-50_000)
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (line.startsWith('Patching ')) patches++
      }
      const now = Date.now()
      if (now - lastUpdate > 500) {
        lastUpdate = now
        job.update({
          stage: 'loader',
          detail: patches > 0 ? '正在应用 NeoForge 补丁（已处理 ' + patches + ' 个类）…' : '正在安装 NeoForge 客户端…',
          progress: 76 + Math.min(12, patches / 150)
        })
      }
    }
    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)
    child.on('error', (error) => finish(new Error('无法启动 NeoForge 安装器：' + error.message)))
    child.on('close', (code) => {
      if (code === 0) {
        finish()
      } else {
        const tail = output.split(/\r?\n/).filter(Boolean).slice(-12).join('\n')
        finish(new Error('NeoForge 安装器退出（代码 ' + code + '）\n' + tail))
      }
    })
    timer = setTimeout(() => {
      child.kill()
      finish(new Error('NeoForge 安装器超时（12 分钟）'))
    }, 12 * 60_000)
  })
}

/**
 * NeoForge's modern installer expects a launcher profile and performs a
 * substantial set of binary patches. We prefetch every declared artifact
 * through the selected mirror and run the official installer in offline mode.
 * This keeps patching semantics correct while avoiding its slow/incomplete
 * network fallback.
 */
export async function installNeoForge(options: NeoForgeInstallOptions): Promise<string> {
  const { root, mcVersion, loaderVersion, source, javaPath, job } = options
  const coordinates = installerCoordinates(mcVersion, loaderVersion)
  const installerPath = join(root, 'libraries', ...coordinates.path.split('/'))
  await mkdir(dirname(installerPath), { recursive: true })

  job.update({ stage: 'loader', detail: '正在获取 NeoForge 安装器…', progress: 52 })
  let contents = await readInstallerIfValid(installerPath)
  if (!contents) {
    const urls = installerUrls(source, coordinates.path)
    await downloadFile(urls, installerPath, { timeoutMs: 120_000 })
    contents = readInstaller(installerPath)
  }

  await ensureLauncherProfile(root)
  const artifacts = libraryArtifacts(contents)
  await prefetchLibraries(root, artifacts, source, job)
  job.update({ stage: 'loader', detail: '正在执行 NeoForge 离线安装器…', progress: 76 })
  await runInstallerProcess(javaPath, installerPath, root, job)

  const versionJson = join(root, 'versions', contents.versionId, contents.versionId + '.json')
  if (!existsSync(versionJson)) {
    throw new Error('NeoForge 安装器已完成，但没有找到版本 JSON：' + versionJson)
  }
  job.update({ stage: 'loader', detail: 'NeoForge 客户端安装完成', progress: 92 })
  return contents.versionId
}