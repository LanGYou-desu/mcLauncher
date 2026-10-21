import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, normalize, resolve } from 'node:path'
import type {
  DiscoveredMinecraftVersion,
  Instance,
  LoaderType,
  MinecraftRootInfo,
  MinecraftScanResult
} from '../../shared/types'
import { LOADER_LABELS } from '../../shared/types'
import { parseLoaderFromVersion, neoforgeVersionToMinecraft } from './sources'
import { newId } from './util'

interface RawVersionJson {
  id?: string
  inheritsFrom?: string
  mainClass?: string
  clientVersion?: string
  _minecraftVersion?: string
  _forgeVersion?: string
  _fabricLoaderVersion?: string
  libraries?: Array<{ name?: string }>
  jar?: string
}

export interface ScanMinecraftOptions {
  gameRoot: string
  knownRoots: string[]
  instances: Instance[]
}

export interface RootCandidate {
  path: string
  label: string
}

/** Build the roots that should be inspected for existing Minecraft versions. */
export async function discoverMinecraftRoots(options: ScanMinecraftOptions): Promise<RootCandidate[]> {
  const roots: RootCandidate[] = []
  const addRoot = (path: string, label: string) => {
    const normalized = normalize(resolve(path))
    if (!roots.some((root) => root.path.toLowerCase() === normalized.toLowerCase())) {
      roots.push({ path: normalized, label })
    }
  }

  addRoot(options.gameRoot, '矿港游戏目录')
  const appData = process.env.APPDATA ?? ''
  const userProfile = process.env.USERPROFILE ?? ''
  if (appData) addRoot(join(appData, '.minecraft'), '官方启动器')
  if (userProfile) addRoot(join(userProfile, '.minecraft'), '用户目录')
  for (const root of options.knownRoots) addRoot(root, minecraftRootLabel(root))

  for (const profilePath of await officialProfilePaths()) {
    if (!existsSync(profilePath)) continue
    try {
      const json = JSON.parse(await readFile(profilePath, 'utf8')) as {
        profiles?: Record<string, { gameDir?: string }>
      }
      for (const profile of Object.values(json.profiles ?? {})) {
        if (profile.gameDir && existsSync(profile.gameDir)) addRoot(profile.gameDir, '官方启动器配置')
      }
    } catch {
      // Ignore malformed launcher profiles.
    }
  }

  return roots.filter((root) => existsSync(join(root.path, 'versions'))).map((root) => ({
    ...root,
    label: root.path === options.gameRoot ? '矿港游戏目录' : root.label
  }))
}

async function officialProfilePaths(): Promise<string[]> {
  const appData = process.env.APPDATA
  if (!appData) return []
  return [
    join(appData, '.minecraft', 'launcher_profiles.json'),
    join(appData, '.minecraft', 'launcher_profiles_microsoft_store.json')
  ]
}

/** Normalize a user-picked folder into a Minecraft root. */
export function normalizeMinecraftRoot(selected: string): string {
  let root = resolve(selected)
  if (basename(root).toLowerCase() === 'versions') root = dirname(root)
  // Portable third-party launchers such as PCL2 keep the game root in a
  // .minecraft folder beside the launcher executable.
  const nested = join(root, '.minecraft')
  if (!existsSync(join(root, 'versions')) && existsSync(join(nested, 'versions'))) return nested
  return root
}

function minecraftRootLabel(root: string): string {
  const parent = dirname(root)
  if (
    basename(root).toLowerCase() === '.minecraft' &&
    (existsSync(join(parent, 'PCL')) || existsSync(join(parent, 'Plain Craft Launcher 2.exe')))
  ) {
    return 'PCL2 目录'
  }
  return '自定义目录'
}

export async function scanMinecraft(options: ScanMinecraftOptions): Promise<MinecraftScanResult> {
  const roots = await discoverMinecraftRoots(options)
  const versions: DiscoveredMinecraftVersion[] = []
  const rootInfos: MinecraftRootInfo[] = []
  const warnings: string[] = []

  for (const root of roots) {
    const versionsDir = join(root.path, 'versions')
    let entries
    try {
      entries = await readdir(versionsDir, { withFileTypes: true })
    } catch {
      continue
    }
    let count = 0
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const versionId = entry.name
      const jsonPath = join(versionsDir, versionId, `${versionId}.json`)
      if (!existsSync(jsonPath)) continue
      try {
        const raw = JSON.parse(await readFile(jsonPath, 'utf8')) as RawVersionJson
        const info = await inspectVersion(root.path, versionId, jsonPath, raw, versionsDir, options.instances)
        versions.push(info)
        count++
      } catch {
        warnings.push(`无法读取版本 ${versionId}：JSON 格式无效`)
      }
    }
    if (count > 0) rootInfos.push({ path: root.path, label: root.label, versionCount: count })
  }

  const seen = new Set<string>()
  const deduped = versions.filter((version) => {
    const key = `${version.root.toLowerCase()}|${version.versionId.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  deduped.sort((a, b) => compareMinecraftVersions(b.mcVersion, a.mcVersion) || b.lastModified - a.lastModified)
  rootInfos.sort((a, b) => b.versionCount - a.versionCount)
  return { roots: rootInfos, versions: deduped, scannedAt: Date.now(), warnings }
}

async function inspectVersion(
  root: string,
  versionId: string,
  jsonPath: string,
  raw: RawVersionJson,
  versionsDir: string,
  instances: Instance[]
): Promise<DiscoveredMinecraftVersion> {
  const info = await stat(jsonPath)
  const inheritance = await resolveInheritance(root, versionId, raw, new Set())
  const libraryHint = (raw.libraries ?? [])
    .map((library) => library.name ?? '')
    .join(' ')
    .toLowerCase()

  let parsed = parseLoaderFromVersion(versionId, inheritance.baseId, raw.mainClass, {
    _forgeVersion: raw._forgeVersion,
    _fabricLoaderVersion: raw._fabricLoaderVersion
  })
  if (parsed.loader === 'vanilla') {
    if (libraryHint.includes('net.neoforged') || versionId.toLowerCase().includes('neoforge')) parsed = { ...parsed, loader: 'neoforge' }
    else if (libraryHint.includes('net.minecraftforge') || raw.mainClass?.includes('cpw.mods')) parsed = { ...parsed, loader: 'forge' }
    else if (libraryHint.includes('net.fabricmc')) parsed = { ...parsed, loader: 'fabric' }
  }

  let loaderVersion = parsed.loaderVersion
  if (!loaderVersion && parsed.loader === 'neoforge') {
    const match = /^neoforge-(.+)$/i.exec(versionId)
    loaderVersion = match?.[1]
  }
  let mcVersion = raw.clientVersion || raw._minecraftVersion || parsed.mcVersion || inheritance.baseId
  if (parsed.loader === 'neoforge' && loaderVersion && (!mcVersion || mcVersion === versionId)) {
    mcVersion = neoforgeVersionToMinecraft(loaderVersion) ?? mcVersion
  }
  if (!mcVersion) mcVersion = versionId

  const jarCandidates = [
    join(versionsDir, versionId, `${versionId}.jar`),
    join(versionsDir, versionId, `${raw.jar ?? ''}.jar`),
    inheritance.baseId ? join(versionsDir, inheritance.baseId, `${inheritance.baseId}.jar`) : ''
  ].filter(Boolean)
  const jarExists = jarCandidates.some((path) => existsSync(path))
  const existingInstance = instances.find(
    (instance) => instance.minecraftRoot.toLowerCase() === root.toLowerCase() && instance.versionId === versionId
  )
  const imported = Boolean(existingInstance)
  const loader = parsed.loader as LoaderType
  const displayName =
    loader === 'vanilla'
      ? mcVersion
      : `${mcVersion} ${LOADER_LABELS[loader]}${loaderVersion ? ` ${loaderVersion}` : ''}`
  return {
    root,
    versionId,
    mcVersion,
    loader,
    loaderVersion,
    name: displayName,
    path: jsonPath,
    jarExists,
    lastModified: info.mtimeMs,
    imported,
    instanceName: existingInstance?.name
  }
}

async function resolveInheritance(
  root: string,
  versionId: string,
  raw: RawVersionJson,
  visited: Set<string>
): Promise<{ baseId: string; chain: string[] }> {
  if (visited.has(versionId)) return { baseId: versionId, chain: [versionId] }
  visited.add(versionId)
  if (!raw.inheritsFrom) return { baseId: versionId, chain: [versionId] }
  const parentPath = join(root, 'versions', raw.inheritsFrom, `${raw.inheritsFrom}.json`)
  try {
    const parent = JSON.parse(await readFile(parentPath, 'utf8')) as RawVersionJson
    const nested = await resolveInheritance(root, raw.inheritsFrom, parent, visited)
    return { baseId: nested.baseId, chain: [versionId, ...nested.chain] }
  } catch {
    return { baseId: raw.inheritsFrom, chain: [versionId, raw.inheritsFrom] }
  }
}

export async function validateVersionJson(root: string, versionId: string): Promise<string> {
  if (!versionId || /[\\/]/.test(versionId) || versionId === '.' || versionId === '..') {
    throw new Error('无效的版本 ID')
  }
  const jsonPath = join(root, 'versions', versionId, `${versionId}.json`)
  if (!existsSync(jsonPath)) throw new Error('该版本缺少 version.json，无法导入')
  const raw = JSON.parse(await readFile(jsonPath, 'utf8')) as RawVersionJson
  if (!raw.id) throw new Error('version.json 缺少 id 字段')
  return jsonPath
}

export function buildImportedInstance(
  version: DiscoveredMinecraftVersion,
  existingInstances: Instance[],
  gameRoot: string
): Instance {
  if (version.imported) throw new Error('该版本已在实例库中')
  // Imported versions keep the source folder/version name instead of being
  // renamed to a synthesized loader label. A suffix is only added when the
  // name already exists in the launcher.
  const originalName = version.versionId.trim() || version.name
  const duplicateName = existingInstances.some((instance) => instance.name === originalName)
  const uniqueSuffix = duplicateName ? ` (${existingInstances.length + 1})` : ''
  const id = newId('inst-')
  const versionDirectory = dirname(version.path)
  const pclIsolated = isPclIsolatedVersion(versionDirectory)
  return {
    id,
    name: `${originalName}${uniqueSuffix}`,
    mcVersion: version.mcVersion,
    loader: version.loader,
    loaderVersion: version.loaderVersion,
    versionId: version.versionId,
    minecraftRoot: version.root,
    // PCL2 version isolation stores mods/saves directly in the version folder.
    // Keep that folder as the game directory so its content remains usable.
    gameDir: pclIsolated ? versionDirectory : version.root === gameRoot ? join(gameRoot, 'instances', id) : version.root,
    external: pclIsolated || version.root !== gameRoot,
    source: 'import',
    createdAt: Date.now()
  }
}

function isPclIsolatedVersion(versionPath: string): boolean {
  return existsSync(join(versionPath, 'PCL', 'Setup.ini'))
}

export function compareMinecraftVersions(a: string, b: string): number {
  const split = (value: string) => {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(value)
    return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : [0, 0, 0]
  }
  const av = split(a)
  const bv = split(b)
  return av[0] - bv[0] || av[1] - bv[1] || av[2] - bv[2]
}
