import type {
  Instance,
  ModrinthProject,
  ModrinthSearchRequest,
  ModrinthSearchResponse,
  ModrinthVersion
} from '../../shared/types'
import { fetchJson } from './http'
import { MODRINTH_API } from './sources'

const projectCache = new Map<string, { at: number; data: ModrinthProject }>()
const versionsCache = new Map<string, { at: number; data: ModrinthVersion[] }>()
const searchCache = new Map<string, { at: number; data: ModrinthSearchResponse }>()
const CACHE_TTL = 5 * 60_000
const SEARCH_TTL = 2 * 60_000
const MAX_CACHE = 120

function cleanId(value: string, label = '项目'): string {
  if (!value || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error(`无效的${label} ID`)
  return value
}

export function isValidModrinthId(value: string): boolean {
  return Boolean(value) && /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

export class ModrinthClient {
  get apiBase(): string {
    return MODRINTH_API
  }

  async search(request: ModrinthSearchRequest): Promise<ModrinthSearchResponse> {
    const type = request.type
    if (!['modpack', 'mod', 'shader', 'resourcepack'].includes(type)) throw new Error('不支持的搜索类型')
    const limit = Math.max(1, Math.min(40, request.limit ?? 20))
    const offset = Math.max(0, request.offset ?? 0)
    const params = new URLSearchParams({
      query: request.query?.trim() ?? '',
      limit: String(limit),
      offset: String(offset),
      index: request.sort ?? 'relevance'
    })
    const facets: string[][] = [[`project_type:${type}`]]
    if (request.mcVersion) facets.push([`versions:${request.mcVersion}`])
    if (type === 'mod' && request.loader && request.loader !== 'vanilla') {
      facets.push([`categories:${request.loader}`])
    }
    params.set('facets', JSON.stringify(facets))
    const cacheKey = params.toString()
    const cached = searchCache.get(cacheKey)
    if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.data
    const data = await fetchJson<ModrinthSearchResponse>(`${this.apiBase}/search?${params.toString()}`, {
      timeoutMs: 25_000
    })
    if (!Array.isArray(data.hits)) throw new Error('Modrinth 搜索响应格式异常')
    searchCache.set(cacheKey, { at: Date.now(), data })
    trimCache(searchCache)
    return data
  }

  async project(projectId: string): Promise<ModrinthProject> {
    const id = cleanId(projectId)
    const cached = projectCache.get(id)
    if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data
    const project = await fetchJson<ModrinthProject>(`${this.apiBase}/project/${id}`, { timeoutMs: 25_000 })
    if (!project?.id) throw new Error('找不到该 Modrinth 项目')
    projectCache.set(project.id, { at: Date.now(), data: project })
    projectCache.set(id, { at: Date.now(), data: project })
    projectCache.set(project.slug, { at: Date.now(), data: project })
    trimCache(projectCache)
    return project
  }

  async versions(projectId: string): Promise<ModrinthVersion[]> {
    const id = cleanId(projectId)
    const cached = versionsCache.get(id)
    if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data
    const versions = await fetchJson<ModrinthVersion[]>(`${this.apiBase}/project/${id}/version`, {
      timeoutMs: 25_000
    })
    if (!Array.isArray(versions)) throw new Error('Modrinth 版本响应格式异常')
    versions.sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime())
    versionsCache.set(id, { at: Date.now(), data: versions })
    trimCache(versionsCache)
    return versions
  }

  async version(versionId: string): Promise<ModrinthVersion> {
    const id = cleanId(versionId, '版本')
    const version = await fetchJson<ModrinthVersion>(`${this.apiBase}/version/${id}`, { timeoutMs: 25_000 })
    if (!version?.id) throw new Error('找不到该 Modrinth 版本')
    return version
  }

  async projectVersionsForInstance(projectId: string, instance: Instance, kind: 'mod' | 'shader' | 'resourcepack'): Promise<ModrinthVersion[]> {
    const versions = await this.versions(projectId)
    return versions.filter((version) => isVersionCompatible(version, instance, kind))
  }
}

export function isVersionCompatible(
  version: ModrinthVersion,
  instance: Pick<Instance, 'mcVersion' | 'loader'>,
  kind: 'mod' | 'shader' | 'resourcepack'
): boolean {
  if (!version.files?.length) return false
  if (!version.game_versions?.includes(instance.mcVersion)) return false
  if (kind === 'mod' && instance.loader !== 'vanilla' && !version.loaders?.includes(instance.loader)) return false
  return version.files.some((file) => usableFileName(file.filename, kind))
}

export function usableFileName(fileName: string, kind: 'mod' | 'shader' | 'resourcepack' | 'modpack'): boolean {
  const lower = fileName.toLowerCase()
  if (kind === 'modpack') return lower.endsWith('.mrpack') || lower.endsWith('.zip')
  if (kind === 'mod') return lower.endsWith('.jar') || lower.endsWith('.zip')
  return lower.endsWith('.zip')
}

export function primaryFile(version: ModrinthVersion, kind: 'mod' | 'shader' | 'resourcepack' | 'modpack') {
  const candidates = version.files.filter((file) => usableFileName(file.filename, kind))
  if (!candidates.length) throw new Error('该版本没有可用的下载文件')
  if (kind === 'modpack') {
    // Some modpack releases attach a separate signature bundle. Prefer the
    // actual Modrinth pack regardless of its `primary` flag.
    return (
      candidates.find((file) => file.filename.toLowerCase().endsWith('.mrpack')) ??
      candidates.find((file) => file.primary) ??
      candidates[0]
    )
  }
  return candidates.find((file) => file.primary) ?? candidates[0]
}

function trimCache(cache: Map<string, unknown>): void {
  if (cache.size <= MAX_CACHE) return
  const excess = cache.size - MAX_CACHE
  let removed = 0
  for (const key of cache.keys()) {
    cache.delete(key)
    if (++removed >= excess) break
  }
}
