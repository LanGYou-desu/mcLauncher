import type { DownloadSource } from '../../shared/types'

export type ConcreteSource = 'official' | 'bmclapi'

export interface SourceEndpoints {
  id: ConcreteSource
  label: string
  versionManifest: string
  versionJson: (id: string) => string
  assetsBase: string
  maven: string
  fabricMeta: string
  forgeMaven: string
  neoforgeMaven: string
  modrinthApi: string
}

export const BMCLAPI_BASE = 'https://bmclapi2.bangbang93.com'
export const OFFICIAL_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
export const BMCLAPI_MANIFEST = `${BMCLAPI_BASE}/mc/game/version_manifest_v2.json`
export const OFFICIAL_ASSETS = 'https://resources.download.minecraft.net'
export const OFFICIAL_MAVEN = 'https://libraries.minecraft.net'
export const FABRIC_MAVEN = 'https://maven.fabricmc.net'
export const FORGE_MAVEN = 'https://maven.minecraftforge.net'
export const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases'
export const MODRINTH_API = 'https://api.modrinth.com/v2'

export const SOURCE_ENDPOINTS: Record<ConcreteSource, SourceEndpoints> = {
  official: {
    id: 'official',
    label: 'Mojang 官方源',
    versionManifest: OFFICIAL_MANIFEST,
    versionJson: (id) => `https://piston-meta.mojang.com/v1/packages/placeholder/${id}.json`,
    assetsBase: OFFICIAL_ASSETS,
    maven: OFFICIAL_MAVEN,
    fabricMeta: 'https://meta.fabricmc.net/v2',
    forgeMaven: FORGE_MAVEN,
    neoforgeMaven: NEOFORGE_MAVEN,
    modrinthApi: MODRINTH_API
  },
  bmclapi: {
    id: 'bmclapi',
    label: 'BMCLAPI 国内镜像',
    versionManifest: BMCLAPI_MANIFEST,
    versionJson: (id) => `${BMCLAPI_BASE}/version/${encodeURIComponent(id)}/json`,
    assetsBase: `${BMCLAPI_BASE}/assets`,
    maven: `${BMCLAPI_BASE}/maven`,
    fabricMeta: `${BMCLAPI_BASE}/fabric-meta/v2`,
    forgeMaven: `${BMCLAPI_BASE}/maven`,
    neoforgeMaven: `${BMCLAPI_BASE}/maven`,
    modrinthApi: MODRINTH_API
  }
}

/**
 * The order in which sources are attempted. Manual selections are respected as
 * the first choice, but a second public source keeps installations resilient.
 */
export function sourceOrder(source: DownloadSource = 'auto'): ConcreteSource[] {
  if (source === 'official') return ['official', 'bmclapi']
  return ['bmclapi', 'official']
}

export function isBmclUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'bmclapi2.bangbang93.com' || host.endsWith('.bangbang93.com')
  } catch {
    return false
  }
}

/**
 * Rewrite well-known Minecraft infrastructure URLs to BMCLAPI.
 * Unknown URLs are returned untouched.
 */
export function toBmclUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return input
  }
  const host = url.hostname.toLowerCase()
  if (host === 'bmclapi2.bangbang93.com' || host.endsWith('.bangbang93.com')) return input

  const path = url.pathname
  if (host === 'resources.download.minecraft.net') {
    return `${BMCLAPI_BASE}/assets${path}`
  }
  if (
    host === 'piston-meta.mojang.com' ||
    host === 'launchermeta.mojang.com' ||
    host === 'launcher.mojang.com' ||
    host === 'piston-data.mojang.com'
  ) {
    return `${BMCLAPI_BASE}${path}`
  }
  if (host === 'libraries.minecraft.net') {
    return `${BMCLAPI_BASE}/maven${path}`
  }
  if (host === 'files.minecraftforge.net' || host === 'maven.minecraftforge.net') {
    return `${BMCLAPI_BASE}/maven${path.replace(/^\/maven/, '')}`
  }
  if (host === 'maven.fabricmc.net') {
    return `${BMCLAPI_BASE}/maven${path}`
  }
  if (host === 'maven.neoforged.net') {
    return `${BMCLAPI_BASE}/maven${path.replace(/^\/releases/, '')}`
  }
  if (host === 'meta.fabricmc.net') {
    return `${BMCLAPI_BASE}/fabric-meta${path}`
  }
  return input
}

/** Build the most likely URLs for a Maven library, in preference order. */
export function libraryDownloadUrls(
  name: string,
  mavenPath: string,
  originalUrl: string | undefined,
  source: DownloadSource
): string[] {
  const isForge = mavenPath.startsWith('net/minecraftforge/')
  const isNeoForge = mavenPath.startsWith('net/neoforged/')
  const isFabric = mavenPath.startsWith('net/fabricmc/')
  const officialMavens = [
    isForge ? FORGE_MAVEN : '',
    isNeoForge ? NEOFORGE_MAVEN : '',
    isFabric ? FABRIC_MAVEN : '',
    OFFICIAL_MAVEN
  ].filter(Boolean)
  const result: string[] = []

  if (source !== 'official') {
    result.push(`${BMCLAPI_BASE}/maven/${mavenPath}`, `${BMCLAPI_BASE}/libraries/${mavenPath}`)
    if (originalUrl) result.push(toBmclUrl(originalUrl))
  }
  if (originalUrl && !isBmclUrl(originalUrl)) result.push(originalUrl)
  for (const maven of officialMavens) result.push(`${maven}/${mavenPath}`)
  if (source === 'bmclapi') {
    // Keep a domestic attempt after the canonical Maven locations as well.
    result.push(`${BMCLAPI_BASE}/maven/${mavenPath}`)
  }
  // The library name is only used for diagnostics; consumers can use it to
  // detect duplicates. Avoid returning invalid non-HTTP entries.
  void name
  return [...new Set(result.filter((url) => /^https?:\/\//.test(url)))]
}

export function assetObjectUrls(hash: string, source: DownloadSource): string[] {
  const relative = `${hash.slice(0, 2)}/${hash}`
  if (source === 'official') {
    return [`${OFFICIAL_ASSETS}/${relative}`, `${BMCLAPI_BASE}/assets/${relative}`]
  }
  return [`${BMCLAPI_BASE}/assets/${relative}`, `${OFFICIAL_ASSETS}/${relative}`]
}

export function assetsIndexUrls(original: string | undefined, hash: string, id: string, source: DownloadSource): string[] {
  const urls: string[] = []
  if (source !== 'official') {
    urls.push(`${BMCLAPI_BASE}/v1/packages/${hash}/${encodeURIComponent(id)}.json`)
    if (original) urls.push(toBmclUrl(original))
  }
  if (original) urls.push(original)
  urls.push(`https://piston-meta.mojang.com/v1/packages/${hash}/${encodeURIComponent(id)}.json`)
  return [...new Set(urls)]
}

/** Fetch the manifest URL candidates for a given preferred source. */
export function manifestUrls(source: DownloadSource): string[] {
  return sourceOrder(source).map((id) => SOURCE_ENDPOINTS[id].versionManifest)
}

export function mavenMetadataUrls(
  kind: 'forge' | 'neoforge' | 'neoforge-legacy',
  source: DownloadSource
): string[] {
  const paths =
    kind === 'forge'
      ? ['net/minecraftforge/forge/maven-metadata.xml']
      : kind === 'neoforge'
        ? ['net/neoforged/neoforge/maven-metadata.xml']
        : ['net/neoforged/forge/maven-metadata.xml']
  const urls: string[] = []
  for (const preferred of sourceOrder(source)) {
    const base =
      kind === 'forge'
        ? SOURCE_ENDPOINTS[preferred].forgeMaven
        : SOURCE_ENDPOINTS[preferred].neoforgeMaven
    for (const path of paths) urls.push(`${base}/${path}`)
  }
  return [...new Set(urls)]
}

/** Parse the <version> nodes out of a Maven metadata XML document. */
export function parseMavenVersions(xml: string): string[] {
  const versions: string[] = []
  const re = /<version>([^<]+)<\/version>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(xml))) {
    const value = match[1].trim()
    if (value) versions.push(value)
  }
  return [...new Set(versions)]
}

/** Forge Maven versions are shaped like `1.20.1-47.3.0`. */
export function forgeVersionsForMinecraft(versions: string[], mcVersion: string): string[] {
  const prefix = `${mcVersion}-`
  return versions
    .filter((version) => version.startsWith(prefix))
    .map((version) => version.slice(prefix.length))
    .filter(Boolean)
}

/**
 * NeoForge versions encode their Minecraft version in the first two numeric
 * components: 21.1.x -> 1.21.1, 20.4.x -> 1.20.4, 21.0.x -> 1.21.
 */
export function neoforgeVersionToMinecraft(version: string): string | null {
  const clean = version.replace(/-(beta|alpha).*$/i, '')
  const match = /^(\d+)\.(\d+)\./.exec(clean)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  if (major < 20) return null
  if (major === 20) return `1.20.${minor}`
  if (minor === 0) return `1.${major}`
  return `1.${major}.${minor}`
}

export function neoforgeVersionsForMinecraft(versions: string[], mcVersion: string): string[] {
  return versions.filter((version) => neoforgeVersionToMinecraft(version) === mcVersion)
}

/** Parse the legacy `1.20.1-47.1.106` NeoForge (Forge-compatible) versions. */
export function legacyNeoforgeVersions(versions: string[], mcVersion: string): string[] {
  return versions.filter((version) => version.startsWith(`${mcVersion}-`))
}

/** Extract loader information from a Minecraft version id / candidate JSON. */
export function parseLoaderFromVersion(id: string, inheritsFrom?: string, mainClass?: string, extra?: {
  _forgeVersion?: string
  _fabricLoaderVersion?: string
}): { mcVersion: string; loader: 'vanilla' | 'fabric' | 'forge' | 'neoforge'; loaderVersion?: string } {
  const lower = id.toLowerCase()
  const main = (mainClass ?? '').toLowerCase()
  let loader: 'vanilla' | 'fabric' | 'forge' | 'neoforge' = 'vanilla'

  const fabricMatch = /fabric-loader-([^/-]+)-(.+)$/i.exec(id)
  const forgeMatch = /^(.+)-forge-(.+)$/i.exec(id)
  const neoModernMatch = /^neoforge-(.+)$/i.exec(id)
  const neoForgeMatch = /^(.+)-neoforge-(.+)$/i.exec(id)

  if (lower.includes('neoforge') || main.includes('neoforged')) {
    loader = 'neoforge'
  } else if (fabricMatch || lower.includes('fabric-loader') || main.includes('fabricmc')) {
    loader = 'fabric'
  } else if (forgeMatch || lower.includes('-forge-') || main.includes('minecraftforge')) {
    loader = 'forge'
  }

  let mcVersion = inheritsFrom || ''
  let loaderVersion: string | undefined

  if (fabricMatch) {
    loaderVersion = fabricMatch[1]
    mcVersion = mcVersion || fabricMatch[2]
  } else if (forgeMatch) {
    loaderVersion = forgeMatch[2]
    mcVersion = mcVersion || forgeMatch[1]
  } else if (neoForgeMatch) {
    loaderVersion = neoForgeMatch[2]
    mcVersion = mcVersion || neoForgeMatch[1]
  } else if (neoModernMatch) {
    loaderVersion = neoModernMatch[1]
    mcVersion = mcVersion || neoforgeVersionToMinecraft(loaderVersion) || mcVersion
  } else if (loader === 'vanilla') {
    mcVersion = mcVersion || id
  }

  if (extra?._forgeVersion) loaderVersion = extra._forgeVersion
  if (extra?._fabricLoaderVersion) loaderVersion = extra._fabricLoaderVersion
  if (!mcVersion) {
    const guess = /^(\d+\.\d+(?:\.\d+)?)/.exec(id)
    mcVersion = guess?.[1] ?? id
  }
  return { mcVersion, loader, loaderVersion }
}

export function recommendedLoader<T extends string>(versions: T[]): T | undefined {
  return versions.find((version) => !/beta|alpha|pre/i.test(version)) ?? versions[0]
}