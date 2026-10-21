import AdmZip from 'adm-zip'
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ContentItem, ContentKind, Instance, InstanceContent } from '../../shared/types'
import { isPathInside } from './util'

const MOD_EXTENSIONS = new Set(['.jar', '.zip'])
const PACK_EXTENSIONS = new Set(['.zip'])

export interface ContentSummary {
  modsCount: number
  shaderpacksCount: number
  resourcepacksCount: number
  savesCount: number
  installedSize: number
  versionReady: boolean
}

export function contentDirectory(instance: Instance, kind: ContentKind): string {
  const folder = kind === 'mods' ? 'mods' : kind
  return join(instance.gameDir, folder)
}

export async function scanContentSummary(instance: Instance): Promise<ContentSummary> {
  const [mods, shaderpacks, resourcepacks, saves, modsSize, shaderSize, resourceSize, savesSize, versionReady] =
    await Promise.all([
      countEntries(contentDirectory(instance, 'mods'), (name) => isModFile(name)),
      countEntries(contentDirectory(instance, 'shaderpacks'), (name) => isPackFile(name)),
      countEntries(contentDirectory(instance, 'resourcepacks'), (name) => isPackFile(name)),
      countEntries(contentDirectory(instance, 'saves'), () => true),
      folderSize(contentDirectory(instance, 'mods'), 2),
      folderSize(contentDirectory(instance, 'shaderpacks'), 2),
      folderSize(contentDirectory(instance, 'resourcepacks'), 2),
      folderSize(contentDirectory(instance, 'saves'), 1),
      existsSync(join(instance.minecraftRoot, 'versions', instance.versionId, `${instance.versionId}.json`))
    ])
  return {
    modsCount: mods,
    shaderpacksCount: shaderpacks,
    resourcepacksCount: resourcepacks,
    savesCount: saves,
    installedSize: modsSize + shaderSize + resourceSize + savesSize,
    versionReady
  }
}

export async function listInstanceContent(instance: Instance): Promise<InstanceContent> {
  const [mods, shaderpacks, resourcepacks, saves] = await Promise.all([
    listMods(instance),
    listPacks(instance, 'shaderpacks'),
    listPacks(instance, 'resourcepacks'),
    listSaves(instance)
  ])
  return { mods, shaderpacks, resourcepacks, saves }
}

async function listMods(instance: Instance): Promise<ContentItem[]> {
  const dir = contentDirectory(instance, 'mods')
  const entries = await readDirSafe(dir)
  const items = (await Promise.all(
    entries
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && isModFile(entry.name))
      .map(async (entry) => {
        const fullPath = join(dir, entry.name)
        const info = await stat(fullPath).catch(() => null)
        if (!info) return null
        const enabled = !entry.name.endsWith('.disabled')
        const metadata = await readModMetadata(fullPath)
        return {
          fileName: entry.name,
          displayName: metadata.name || stripDisabled(entry.name).replace(/\.(jar|zip)$/i, ''),
          version: metadata.version,
          author: metadata.author,
          description: metadata.description,
          enabled,
          size: info.size,
          modified: info.mtimeMs,
          kind: 'mods' as const,
          isDirectory: false,
          iconDataUrl: metadata.iconDataUrl
        } satisfies ContentItem
      })
  )) as Array<ContentItem | null>
  return items.filter((item): item is ContentItem => item !== null).sort(sortContent)
}

async function listPacks(instance: Instance, kind: 'shaderpacks' | 'resourcepacks'): Promise<ContentItem[]> {
  const dir = contentDirectory(instance, kind)
  const entries = await readDirSafe(dir)
  const items = (await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.') && (entry.isDirectory() || isPackFile(entry.name)))
      .map(async (entry) => {
        const fullPath = join(dir, entry.name)
        const info = await stat(fullPath).catch(() => null)
        if (!info) return null
        const enabled = !entry.name.endsWith('.disabled')
        const metadata = entry.isDirectory()
          ? await readPackMetadata(fullPath, kind)
          : await readPackMetadataFromZip(fullPath, kind)
        return {
          fileName: entry.name,
          displayName: metadata.name || stripDisabled(entry.name).replace(/^(shaderpacks|resourcepacks)[/\\]/, '').replace(/\.zip$/i, ''),
          version: metadata.version,
          author: metadata.author,
          description: metadata.description,
          enabled,
          size: entry.isDirectory() ? await folderSize(fullPath, 3) : info.size,
          modified: info.mtimeMs,
          kind,
          isDirectory: entry.isDirectory(),
          iconDataUrl: metadata.iconDataUrl
        } satisfies ContentItem
      })
  )) as Array<ContentItem | null>
  return items.filter((item): item is ContentItem => item !== null).sort(sortContent)
}

async function listSaves(instance: Instance): Promise<ContentItem[]> {
  const dir = contentDirectory(instance, 'saves')
  const entries = await readDirSafe(dir)
  const items = (await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const fullPath = join(dir, entry.name)
        const info = await stat(fullPath).catch(() => null)
        if (!info) return null
        const iconPath = join(fullPath, 'icon.png')
        const iconDataUrl = await pngDataUrl(iconPath)
        return {
          fileName: entry.name,
          displayName: entry.name,
          enabled: true,
          size: await folderSize(fullPath, 2),
          modified: info.mtimeMs,
          kind: 'saves' as const,
          isDirectory: true,
          iconDataUrl
        } satisfies ContentItem
      })
  )) as Array<ContentItem | null>
  return items.filter((item): item is ContentItem => item !== null).sort(sortContent)
}

function sortContent(a: ContentItem, b: ContentItem): number {
  return a.displayName.localeCompare(b.displayName, 'zh-CN')
}

function isModFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.endsWith('.disabled')) {
    return MOD_EXTENSIONS.has(extname(lower.slice(0, -'.disabled'.length)))
  }
  return MOD_EXTENSIONS.has(extname(lower))
}

function isPackFile(name: string): boolean {
  const lower = name.toLowerCase()
  const actual = lower.endsWith('.disabled') ? lower.slice(0, -'.disabled'.length) : lower
  return PACK_EXTENSIONS.has(extname(actual))
}

function stripDisabled(name: string): string {
  return name.endsWith('.disabled') ? name.slice(0, -'.disabled'.length) : name
}

async function countEntries(dir: string, predicate: (name: string) => boolean): Promise<number> {
  const entries = await readDirSafe(dir)
  return entries.filter((entry) => !entry.name.startsWith('.') && predicate(entry.name)).length
}

async function readDirSafe(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export async function folderSize(dir: string, depth: number): Promise<number> {
  if (depth < 0) return 0
  let total = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
    const fullPath = join(dir, entry.name)
    if (entry.isFile()) {
      const info = await stat(fullPath).catch(() => null)
      total += info?.size ?? 0
    } else if (entry.isDirectory()) {
      total += await folderSize(fullPath, depth - 1)
    }
    if (total > 1024 * 1024 * 1024 * 8) return total
  }
  return total
}

interface ModMetadata {
  name?: string
  version?: string
  author?: string
  description?: string
  iconDataUrl?: string
}

async function readModMetadata(file: string): Promise<ModMetadata> {
  const lower = file.toLowerCase()
  if (!lower.includes('.jar') && !lower.includes('.zip')) return {}
  let zip: AdmZip
  try {
    zip = new AdmZip(file)
  } catch {
    return {}
  }
  const candidates = ['fabric.mod.json', 'quilt.mod.json', 'META-INF/neoforge.mods.toml', 'META-INF/mods.toml', 'META-INF/MANIFEST.MF']
  for (const entryName of candidates) {
    const entry = zip.getEntry(entryName)
    if (!entry) continue
    let text: string
    try {
      text = entry.getData().toString('utf8')
    } catch {
      continue
    }
    try {
      if (entryName.endsWith('.json')) {
        const json = JSON.parse(text) as Record<string, unknown>
        const quilt = entryName === 'quilt.mod.json'
        const quiltMeta = quilt ? (json.quilt_loader as Record<string, unknown> | undefined)?.metadata as Record<string, unknown> | undefined : undefined
        const metadata = quiltMeta ?? json
        const authorsRaw = metadata.authors
        const authors = Array.isArray(authorsRaw)
          ? authorsRaw.map((author) => (typeof author === 'string' ? author : String((author as { name?: string })?.name ?? ''))).filter(Boolean)
          : []
        const iconPath = typeof metadata.icon === 'string' ? metadata.icon : undefined
        const iconDataUrl = iconPath ? tryZipPng(zip, iconPath) ?? tryZipPng(zip, 'icon.png') : tryZipPng(zip, 'icon.png')
        return {
          name: stringValue(metadata.name) || stringValue(metadata.id),
          version: stringValue(metadata.version),
          author: authors.join('、'),
          description: stringValue(metadata.description),
          iconDataUrl
        }
      }
      if (entryName.endsWith('.toml')) {
        return parseTomlMetadata(text, zip)
      }
      if (entryName.endsWith('MANIFEST.MF')) {
        return {
          name: manifestValue(text, 'Implementation-Title'),
          version: manifestValue(text, 'Implementation-Version'),
          author: manifestValue(text, 'Implementation-Vendor')
        }
      }
    } catch {
      // Continue with the next metadata format.
    }
  }
  return { iconDataUrl: tryZipPng(zip, 'icon.png') }
}

function parseTomlMetadata(text: string, zip: AdmZip): ModMetadata {
  const modSection = text.split(/\[\[mods\]\]/i)[1] ?? text
  const get = (key: string) => {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'mi').exec(modSection)
    if (!match) return undefined
    return match[1].trim().replace(/^['"]|['"]$/g, '').replace(/'''|"""/g, '').trim()
  }
  const logo = get('logoFile')
  return {
    name: get('displayName') || get('modId'),
    version: get('version'),
    author: get('authors') || get('author'),
    description: get('description'),
    iconDataUrl: logo ? tryZipPng(zip, logo) : tryZipPng(zip, 'icon.png')
  }
}

async function readPackMetadata(dir: string, kind: 'shaderpacks' | 'resourcepacks'): Promise<ModMetadata> {
  const iconDataUrl = await pngDataUrl(join(dir, kind === 'shaderpacks' ? 'pack.png' : 'pack.png'))
  if (kind === 'shaderpacks') {
    const readme = await readFile(join(dir, 'README.md'), 'utf8').catch(() => '')
    return { description: readme.split('\n').slice(0, 3).join(' ').slice(0, 240), iconDataUrl }
  }
  try {
    const json = JSON.parse(await readFile(join(dir, 'pack.mcmeta'), 'utf8')) as {
      pack?: { description?: unknown; pack_format?: number }
    }
    return {
      description: typeof json.pack?.description === 'string' ? json.pack.description : JSON.stringify(json.pack?.description ?? ''),
      version: json.pack?.pack_format ? `pack_format ${json.pack.pack_format}` : undefined,
      iconDataUrl
    }
  } catch {
    return { iconDataUrl }
  }
}

async function readPackMetadataFromZip(file: string, kind: 'shaderpacks' | 'resourcepacks'): Promise<ModMetadata> {
  let zip: AdmZip
  try {
    zip = new AdmZip(file)
  } catch {
    return {}
  }
  const iconDataUrl = tryZipPng(zip, 'pack.png')
  if (kind === 'shaderpacks') {
    const entry = zip.getEntry('shaders/shaders.properties')
    return {
      description: entry ? entry.getData().toString('utf8').slice(0, 240) : undefined,
      iconDataUrl
    }
  }
  const entry = zip.getEntry('pack.mcmeta')
  if (!entry) return { iconDataUrl }
  try {
    const json = JSON.parse(entry.getData().toString('utf8')) as {
      pack?: { description?: unknown; pack_format?: number }
    }
    return {
      description: typeof json.pack?.description === 'string' ? json.pack.description : undefined,
      version: json.pack?.pack_format ? `pack_format ${json.pack.pack_format}` : undefined,
      iconDataUrl
    }
  } catch {
    return { iconDataUrl }
  }
}

function tryZipPng(zip: AdmZip, entryName: string): string | undefined {
  const entry = zip.getEntry(entryName.replace(/^\//, ''))
  if (!entry) return undefined
  try {
    const data = entry.getData()
    if (data.length > 512 * 1024) return undefined
    return `data:image/png;base64,${data.toString('base64')}`
  } catch {
    return undefined
  }
}

async function pngDataUrl(file: string): Promise<string | undefined> {
  try {
    const data = await readFile(file)
    if (data.length > 512 * 1024) return undefined
    return `data:image/png;base64,${data.toString('base64')}`
  } catch {
    return undefined
  }
}

function manifestValue(text: string, key: string): string | undefined {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, 'mi')
  return regex.exec(text)?.[1]?.trim()
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text?: unknown }).text ?? '')
  return undefined
}

export async function importContentFiles(
  instance: Instance,
  kind: ContentKind,
  sourcePaths: string[]
): Promise<{ imported: number; skipped: number }> {
  let imported = 0
  let skipped = 0
  const dir = contentDirectory(instance, kind)
  await mkdir(dir, { recursive: true })
  for (const source of sourcePaths) {
    try {
      const info = await stat(source)
      if (kind === 'mods' && !info.isFile()) {
        skipped++
        continue
      }
      if (kind !== 'mods' && !info.isFile() && !info.isDirectory()) {
        skipped++
        continue
      }
      const originalName = basename(source)
      if (originalName.startsWith('.')) {
        skipped++
        continue
      }
      const destination = await uniqueDestination(dir, originalName, info.isDirectory())
      await cp(source, destination, { recursive: info.isDirectory(), errorOnExist: false, force: false })
      imported++
    } catch {
      skipped++
    }
  }
  return { imported, skipped }
}

async function uniqueDestination(dir: string, fileName: string, isDirectory: boolean): Promise<string> {
  const extension = isDirectory ? '' : extname(fileName)
  const base = isDirectory ? fileName : fileName.slice(0, fileName.length - extension.length)
  let candidate = join(dir, fileName)
  let index = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${base} (${index})${extension}`)
    index++
    if (index > 999) throw new Error('同名文件过多')
  }
  return candidate
}

export function resolveContentItem(instance: Instance, kind: ContentKind, fileName: string): string {
  if (!fileName || basename(fileName) !== fileName || fileName === '.' || fileName === '..') {
    throw new Error('无效的文件名')
  }
  const dir = contentDirectory(instance, kind)
  const full = join(dir, fileName)
  if (!isPathInside(dir, full) && full !== join(dir, fileName)) throw new Error('文件路径越界')
  return full
}

export async function toggleContent(instance: Instance, kind: ContentKind, fileName: string): Promise<void> {
  if (kind === 'saves') throw new Error('存档不支持启用或禁用')
  const full = resolveContentItem(instance, kind, fileName)
  if (!existsSync(full)) throw new Error('文件不存在')
  const next = fileName.endsWith('.disabled') ? full.slice(0, -'.disabled'.length) : `${full}.disabled`
  const { rename } = await import('node:fs/promises')
  await rename(full, next)
}

export async function deleteContent(instance: Instance, kind: ContentKind, fileName: string): Promise<void> {
  const full = resolveContentItem(instance, kind, fileName)
  await rm(full, { recursive: true, force: true })
}

export async function ensureInstanceContentDirs(instance: Instance): Promise<void> {
  for (const folder of ['mods', 'shaderpacks', 'resourcepacks', 'saves', 'config', 'logs']) {
    await mkdir(join(instance.gameDir, folder), { recursive: true })
  }
}