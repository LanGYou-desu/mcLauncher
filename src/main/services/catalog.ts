import type {
  DownloadSource,
  LoaderCatalog,
  LoaderVersion,
  VersionCatalog
} from '../../shared/types'
import {
  SOURCE_ENDPOINTS,
  manifestUrls,
  sourceOrder,
  mavenMetadataUrls,
  parseMavenVersions,
  forgeVersionsForMinecraft,
  neoforgeVersionsForMinecraft,
  legacyNeoforgeVersions
} from './sources'
import { fetchFirstJson, fetchFirstText } from './http'

interface ManifestJson {
  latest: { release: string; snapshot: string }
  versions: Array<{ id: string; type: string; releaseTime: string; url: string; sha1?: string }>
}

interface FabricLoaderArtifact {
  loader: { version: string; stable?: boolean }
  intermediary?: { version: string }
  launcherMeta?: unknown
}

const catalogCache = new Map<string, { at: number; data: VersionCatalog }>()
const loaderCache = new Map<string, { at: number; data: LoaderCatalog }>()
const versionJsonCache = new Map<string, { at: number; data: unknown }>()
const CATALOG_TTL = 10 * 60_000
const LOADER_TTL = 15 * 60_000

export async function getVersionCatalog(source: DownloadSource, force = false): Promise<VersionCatalog> {
  const key = source
  const cached = catalogCache.get(key)
  if (!force && cached && Date.now() - cached.at < CATALOG_TTL) return cached.data
  const result = await fetchFirstJson<ManifestJson>(manifestUrls(source), { timeoutMs: 20_000 })
  if (!result.data?.versions?.length) throw new Error('版本清单为空')
  const sourceUsed = result.url.includes('bangbang93') ? 'bmclapi' : 'official'
  const data: VersionCatalog = {
    latest: result.data.latest,
    versions: result.data.versions.map((version) => ({
      id: version.id,
      type: version.type,
      releaseTime: version.releaseTime,
      url: version.url
    })),
    sourceUsed,
    fetchedAt: Date.now()
  }
  catalogCache.set(key, { at: Date.now(), data })
  return data
}

export async function getVersionJson(
  version: { id: string; url: string },
  source: DownloadSource
): Promise<Record<string, unknown>> {
  const key = `${source}:${version.id}`
  const cached = versionJsonCache.get(key)
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.data as Record<string, unknown>
  const urls = [
    ...sourceOrder(source).map((id) => SOURCE_ENDPOINTS[id].versionJson(version.id)),
    version.url
  ]
  const result = await fetchFirstJson<Record<string, unknown>>([...new Set(urls)], { timeoutMs: 30_000 })
  versionJsonCache.set(key, { at: Date.now(), data: result.data })
  return result.data
}

/** Fetch and normalize loader versions for one Minecraft release. */
export async function getLoaderCatalog(mcVersion: string, source: DownloadSource): Promise<LoaderCatalog> {
  const key = `${mcVersion}:${source}`
  const cached = loaderCache.get(key)
  if (cached && Date.now() - cached.at < LOADER_TTL) return cached.data

  const warnings: string[] = []
  const [fabric, forge, neoforge] = await Promise.all([
    fetchFabricVersions(mcVersion, source).catch((error) => {
      warnings.push(`Fabric 版本列表加载失败：${error instanceof Error ? error.message : String(error)}`)
      return [] as LoaderVersion[]
    }),
    fetchForgeVersions(mcVersion, source).catch((error) => {
      warnings.push(`Forge 版本列表加载失败：${error instanceof Error ? error.message : String(error)}`)
      return [] as LoaderVersion[]
    }),
    fetchNeoForgeVersions(mcVersion, source).catch((error) => {
      warnings.push(`NeoForge 版本列表加载失败：${error instanceof Error ? error.message : String(error)}`)
      return [] as LoaderVersion[]
    })
  ])

  const data: LoaderCatalog = {
    fabric: normalizeLoaderList(fabric),
    forge: normalizeLoaderList(forge),
    neoforge: normalizeLoaderList(neoforge),
    warnings,
    fetchedAt: Date.now()
  }
  loaderCache.set(key, { at: Date.now(), data })
  return data
}

async function fetchFabricVersions(mcVersion: string, source: DownloadSource): Promise<LoaderVersion[]> {
  const urls = sourceOrder(source).map(
    (id) => `${SOURCE_ENDPOINTS[id].fabricMeta}/versions/loader/${encodeURIComponent(mcVersion)}`
  )
  const result = await fetchFirstJson<FabricLoaderArtifact[]>([...new Set(urls)], { timeoutMs: 20_000 })
  if (!Array.isArray(result.data)) throw new Error('Fabric 元数据格式异常')
  return result.data
    .filter((artifact) => artifact?.loader?.version)
    .map((artifact) => ({
      version: artifact.loader.version,
      stable: artifact.loader.stable !== false,
      recommended: false
    }))
}

async function fetchForgeVersions(mcVersion: string, source: DownloadSource): Promise<LoaderVersion[]> {
  // Forge's Maven metadata is often slow or stale through mirrors. BMCLAPI
  // exposes a compact per-game-version endpoint that is much more reliable.
  const bmclApi = `https://bmclapi2.bangbang93.com/forge/minecraft/${encodeURIComponent(mcVersion)}`
  const fromApi = async (): Promise<LoaderVersion[]> => {
    const result = await fetchFirstJson<unknown>([bmclApi], { timeoutMs: 25_000 })
    const payload = result.data
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { versions?: unknown[] })?.versions)
        ? (payload as { versions: unknown[] }).versions
        : []
    const versions = list
      .map((entry) => (typeof entry === 'string' ? entry : String((entry as { version?: unknown })?.version ?? '')))
      .filter(Boolean)
    if (!versions.length) throw new Error('Forge 版本接口没有返回有效版本')
    return versions.map((version) => ({
      version,
      stable: !/beta|alpha|pre/i.test(version),
      recommended: false
    }))
  }

  if (source !== 'official') {
    return fromApi()
  }

  // Prefer the official Maven index when explicitly requested, then fall back
  // to the domestic API instead of reporting an empty list.
  try {
    const urls = mavenMetadataUrls('forge', 'official')
    const result = await fetchFirstText(urls, { timeoutMs: 20_000 })
    const versions = forgeVersionsForMinecraft(parseMavenVersions(result.data), mcVersion)
    if (versions.length) {
      return versions.map((version) => ({
        version,
        stable: !/beta|alpha|pre/i.test(version),
        recommended: false
      }))
    }
  } catch {
    // Fall through to the mirror API below.
  }
  return fromApi()
}

async function fetchNeoForgeVersions(mcVersion: string, source: DownloadSource): Promise<LoaderVersion[]> {
  if (mcVersion === '1.20.1') {
    const urls = mavenMetadataUrls('neoforge-legacy', source)
    const result = await fetchFirstText(urls, { timeoutMs: 20_000 })
    const all = parseMavenVersions(result.data)
    const versions = legacyNeoforgeVersions(all, mcVersion).map((version) => version.slice(mcVersion.length + 1))
    return versions.map((version) => ({
      version,
      stable: !/beta|alpha|pre/i.test(version),
      recommended: false
    }))
  }
  const urls = mavenMetadataUrls('neoforge', source)
  const result = await fetchFirstText(urls, { timeoutMs: 20_000 })
  const versions = neoforgeVersionsForMinecraft(parseMavenVersions(result.data), mcVersion)
  return versions.map((version) => ({
    version,
    stable: !/beta|alpha|pre/i.test(version),
    recommended: false
  }))
}

export function normalizeLoaderList(input: LoaderVersion[]): LoaderVersion[] {
  const sorted = [...new Map(input.map((entry) => [entry.version, entry])).values()]
    .filter((entry) => Boolean(entry.version))
    .sort((a, b) => compareVersion(a.version, b.version))
  let recommendedAssigned = false
  return sorted.map((entry) => {
    const recommended = !recommendedAssigned && entry.stable
    if (recommended) recommendedAssigned = true
    return { ...entry, recommended }
  })
}

export function compareVersion(a: string, b: string): number {
  const tokenize = (value: string) =>
    value
      .toLowerCase()
      .split(/[.+-]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  const av = tokenize(a)
  const bv = tokenize(b)
  const length = Math.max(av.length, bv.length)
  for (let index = 0; index < length; index++) {
    const left = av[index]
    const right = bv[index]
    if (left === right) continue
    if (typeof left === 'number' && typeof right === 'number') return right - left
    if (typeof left === 'number') return -1
    if (typeof right === 'number') return 1
    return String(right).localeCompare(String(left))
  }
  return 0
}

export function clearCatalogCaches(): void {
  catalogCache.clear()
  loaderCache.clear()
  versionJsonCache.clear()
}