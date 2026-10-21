import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path'

export function newId(prefix = ''): string {
  return `${prefix}${randomUUID()}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

/** Generate a deterministic offline UUID the same way vanilla does. */
export function offlineUuid(name: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function sanitizePlayerName(input: string): string {
  const name = input.trim().replace(/[^A-Za-z0-9_]/g, '')
  return name.slice(0, 16) || 'Steve'
}

export function safeFileName(input: string, fallback = 'minecraft-instance'): string {
  const cleaned = input
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return (cleaned || fallback).slice(0, 80)
}

/** Ensure a zip-relative path cannot escape the target directory. */
export function resolveInside(base: string, relativePath: string): string | null {
  if (!relativePath || isAbsolute(relativePath)) return null
  const normalized = normalize(relativePath).replace(/^\.(?:[\\/]|$)/, '')
  const target = resolve(base, normalized)
  const rel = relative(resolve(base), target)
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) return null
  return target
}

export function isPathInside(base: string, target: string): boolean {
  const rel = relative(resolve(base), resolve(target))
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
}

export function safeJoin(base: string, ...parts: string[]): string {
  return resolve(base, ...parts)
}

export function parentOf(fileOrDir: string): string {
  return dirname(fileOrDir)
}

export function trimDescription(text: string, length = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= length) return clean
  return `${clean.slice(0, length - 1).trimEnd()}…`
}

export function formatPlayTime(ms: number): string {
  if (!ms || ms < 60_000) return '不足 1 分钟'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分钟`
  const days = Math.floor(hours / 24)
  return `${days} 天 ${hours % 24} 小时`
}

export function baseNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Split a user supplied argument string, respecting single/double quotes. */
export function splitCommandLine(input: string): string[] {
  const result: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        result.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) result.push(current)
  return result
}
