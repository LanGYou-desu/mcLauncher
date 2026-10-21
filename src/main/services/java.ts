import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readdir, realpath } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import type { JavaInfo, JavaScanResult } from '../../shared/types'

const execFileAsync = promisify(execFile)
const JAVA_EXE = process.platform === 'win32' ? 'java.exe' : 'java'

export interface JavaParseResult {
  version: string
  major: number
  vendor: string
  arch: string
  /** The runtime home reported by the JVM. Used to collapse PATH shims. */
  home?: string
}

/** Parse Java's -XshowSettings:properties output (and fall back to -version). */
export function parseJavaVersionOutput(output: string): JavaParseResult | null {
  const props: Record<string, string> = {}
  const propertyRegex = /^\s{2,}([\w.]+)\s*=\s*(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = propertyRegex.exec(output))) {
    props[match[1]] = match[2].trim()
  }
  let version = props['java.version'] ?? ''
  if (!version) {
    const versionMatch = /(?:java|openjdk) version\s+"([^"]+)"/i.exec(output)
    version = versionMatch?.[1] ?? ''
  }
  if (!version) return null
  let major = 0
  if (/^1\./.test(version)) {
    major = Number(version.split('.')[1]) || 0
  } else {
    major = Number(version.split(/[.+-]/)[0]) || 0
  }
  const vendor =
    props['java.vendor'] ??
    props['java.vendor.url'] ??
    (/openjdk/i.test(output) ? 'OpenJDK' : /java\(tm\)/i.test(output) ? 'Oracle' : 'Java')
  return {
    version,
    major,
    vendor: cleanVendor(vendor),
    arch: props['os.arch'] ?? process.arch,
    home: props['java.home']
  }
}

function cleanVendor(vendor: string): string {
  return vendor
    .replace(/\s+/g, ' ')
    .replace(/Corporation/gi, '')
    .replace(/Inc\.?/gi, '')
    .replace(/\bThe\b/gi, '')
    .trim()
    .slice(0, 80) || 'Java'
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function javaExeFor(homeOrExe: string): string[] {
  if (/\.(exe|bin)$/i.test(homeOrExe) || homeOrExe.endsWith(JAVA_EXE)) {
    return [homeOrExe]
  }
  return [join(homeOrExe, 'bin', JAVA_EXE), join(homeOrExe, 'bin', 'javaw.exe'), homeOrExe]
}

async function readJavaInfo(path: string, source: JavaInfo['source']): Promise<JavaInfo | null> {
  try {
    const { stdout, stderr } = await execFileAsync(path, ['-XshowSettings:properties', '-version'], {
      timeout: 8_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    })
    const parsed = parseJavaVersionOutput(`${stdout}\n${stderr}`)
    if (!parsed || !parsed.version) return null
    let finalPath = path
    // Oracle and some vendors put a small launcher in PATH (for example
    // Common Files/Oracle/Java/java8path). The JVM's reported java.home points
    // at the real runtime, so canonicalize to that executable and collapse the
    // shim with the actual installation.
    if (parsed.home) {
      try {
        const canonicalHome = await realpath(parsed.home)
        const canonicalExe = join(canonicalHome, 'bin', JAVA_EXE)
        if (existsSync(canonicalExe)) finalPath = canonicalExe
      } catch {
        // Fall back to the selected executable below.
      }
    }
    try {
      finalPath = await realpath(finalPath)
    } catch {
      // keep original path
    }
    return {
      path: finalPath,
      version: parsed.version,
      major: parsed.major,
      vendor: parsed.vendor,
      arch: parsed.arch,
      source,
      addedAt: Date.now()
    }
  } catch {
    return null
  }
}

export interface ScanJavaOptions {
  customJavaPaths?: string[]
  extraRoots?: string[]
}

/**
 * Discover Java runtimes from PATH, JAVA_HOME, common vendor folders and
 * Minecraft's own runtime directory. Never scans whole drives.
 */
export async function scanJavaInstallations(options: ScanJavaOptions = {}): Promise<JavaScanResult> {
  const candidates = new Map<string, JavaInfo['source']>()
  const warnings: string[] = []

  const addCandidate = (candidate: string, source: JavaInfo['source']) => {
    const key = candidate.toLowerCase()
    if (!candidates.has(key)) candidates.set(key, source)
  }

  if (process.env.JAVA_HOME) {
    for (const path of javaExeFor(process.env.JAVA_HOME)) addCandidate(path, 'JAVA_HOME')
  }

  const pathDirs = (process.env.PATH ?? process.env.Path ?? '').split(delimiter)
  for (const dir of pathDirs) {
    if (!dir.trim()) continue
    const candidate = join(dir.replace(/^"|"$/g, ''), JAVA_EXE)
    if (existsSync(candidate)) addCandidate(candidate, 'PATH')
  }

  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = process.env.LOCALAPPDATA ?? ''
  const userProfile = process.env.USERPROFILE ?? ''
  const commonRoots = [
    join(programFiles, 'Java'),
    join(programFilesX86, 'Java'),
    join(programFiles, 'Eclipse Adoptium'),
    join(programFiles, 'Microsoft'),
    join(programFiles, 'Zulu'),
    join(programFiles, 'BellSoft'),
    join(programFiles, 'Amazon Corretto'),
    join(programFiles, 'Semeru'),
    join(programFiles, 'Oracle'),
    join(programFiles, 'JetBrains'),
    join(programFiles, 'RedHat'),
    join(programFiles, 'IBM'),
    join(localAppData, 'Programs', 'Eclipse Adoptium'),
    join(localAppData, 'Programs', 'Microsoft'),
    join(localAppData, 'Programs', 'IntelliJ IDEA'),
    join(localAppData, 'JetBrains', 'Toolbox', 'apps'),
    join(userProfile, '.jdks'),
    join(userProfile, '.gradle', 'jdks'),
    join(userProfile, 'scoop', 'apps'),
    join(process.env.ProgramData ?? 'C:\\ProgramData', 'Oracle', 'Java'),
    join(process.env.APPDATA ?? '', '.minecraft', 'runtime'),
    ...(options.extraRoots ?? [])
  ].filter(Boolean)

  for (const root of commonRoots) {
    if (!existsSync(root)) continue
    try {
      const found = await findJavaExecutables(root, 4)
      for (const path of found) addCandidate(path, root.includes('runtime') ? 'minecraft' : 'common')
    } catch {
      // A permission error in one vendor folder should not stop the scan.
    }
  }

  for (const custom of options.customJavaPaths ?? []) {
    if (existsSync(custom)) addCandidate(custom, 'manual')
  }

  // De-duplicate by executable path and inspect at most 40 runtimes.
  const limited = [...candidates.entries()].slice(0, 40)
  const infos = await mapLimit(limited, 6, async ([path, source]) => {
    if (!(await isExecutable(path))) return null
    return readJavaInfo(path, source)
  })
  const grouped = new Map<string, JavaInfo>()
  for (const info of infos) {
    if (!info) continue
    // A runtime usually offers both java.exe and javaw.exe. Use the Java home
    // (or its parent for unusual layouts) as the identity, and prefer java.exe
    // so console output can be captured.
    const homeDir = info.path.replace(/[\\/]bin[\\/][^\\/]+$/i, '').toLowerCase()
    const key = homeDir || info.path.toLowerCase()
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, info)
    } else if (/[\\/]javaw\.exe$/i.test(existing.path) && /[\\/]java\.exe$/i.test(info.path)) {
      grouped.set(key, info)
    }
  }
  const java = [...grouped.values()]
  java.sort((a, b) => b.major - a.major || a.vendor.localeCompare(b.vendor))
  if (!java.length) warnings.push('未自动发现 Java，请在「Java 环境」中手动添加 java.exe。')

  return { java, scannedAt: Date.now(), warnings }
}

async function findJavaExecutables(root: string, depth: number): Promise<string[]> {
  const results: string[] = []
  const queue: Array<{ dir: string; remaining: number }> = [{ dir: resolve(root), remaining: depth }]
  let visited = 0
  while (queue.length && results.length < 12 && visited < 1500) {
    const current = queue.shift()
    if (!current) break
    visited++
    let entries
    try {
      entries = await readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(current.dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === JAVA_EXE) {
        // Only count actual runtimes, not random copies inside IDE folders.
        results.push(full)
        if (results.length >= 12) break
      } else if (entry.isDirectory() && current.remaining > 0) {
        if (['node_modules', '.git', 'cache', 'caches', 'tmp', 'temp', 'lib'].includes(entry.name.toLowerCase())) {
          continue
        }
        queue.push({ dir: full, remaining: current.remaining - 1 })
      }
    }
  }
  return results
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

/** Normalize a user-selected file or Java home into an executable path. */
export function resolveJavaExecutable(selected: string): string | null {
  for (const candidate of javaExeFor(selected)) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export async function inspectJava(path: string): Promise<JavaInfo | null> {
  const executable = resolveJavaExecutable(path)
  if (!executable) return null
  return readJavaInfo(executable, 'manual')
}

/** Pick a suitable runtime for a required Java major version. */
export function chooseJava(java: JavaInfo[], requiredMajor: number, preferredPath?: string | null): JavaInfo | undefined {
  if (preferredPath) {
    const preferred = java.find((entry) => entry.path.toLowerCase() === preferredPath.toLowerCase())
    if (preferred && preferred.major >= Math.max(requiredMajor, 8)) return preferred
  }
  const compatible = java.filter((entry) => entry.major >= Math.max(requiredMajor, 8))
  if (compatible.length) {
    return compatible.sort((a, b) => a.major - b.major)[0]
  }
  return [...java].sort((a, b) => b.major - a.major)[0]
}

export function javaHomeOf(javaPath: string): string {
  return dirname(dirname(javaPath))
}