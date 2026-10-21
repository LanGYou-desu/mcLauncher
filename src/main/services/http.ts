import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const DEFAULT_USER_AGENT =
  'MineHarbor/1.0.4 (Minecraft launcher; +https://github.com/LanGYou-desu/mcLauncher)'

export interface FetchOptions {
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
  signal?: AbortSignal
}

function timeoutSignal(ms: number, parent?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('请求超时')), ms)
  const onAbort = () => controller.abort(parent?.reason)
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason)
    else parent.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onAbort)
    }
  }
}

export async function fetchResponse(url: string, options: FetchOptions = {}): Promise<Response> {
  const retries = options.retries ?? 2
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { signal, dispose } = timeoutSignal(options.timeoutMs ?? 25_000, options.signal)
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: '*/*',
          ...options.headers
        },
        signal,
        redirect: 'follow'
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status} ${response.statusText} · ${body.slice(0, 160)}`)
      }
      return response
    } catch (error) {
      lastError = error
      if (options.signal?.aborted) throw error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    } finally {
      dispose()
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await fetchResponse(url, options)
  return response.text()
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await fetchResponse(url, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers }
  })
  return (await response.json()) as T
}

export async function fetchFirstJson<T>(urls: string[], options: FetchOptions = {}): Promise<{ data: T; url: string }> {
  const errors: string[] = []
  for (const url of urls) {
    try {
      return { data: await fetchJson<T>(url, options), url }
    } catch (error) {
      errors.push(`${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`所有下载源均不可用：${errors.join('；')}`)
}

export async function fetchFirstText(urls: string[], options: FetchOptions = {}): Promise<{ data: string; url: string }> {
  const errors: string[] = []
  for (const url of urls) {
    try {
      return { data: await fetchText(url, options), url }
    } catch (error) {
      errors.push(`${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`所有下载源均不可用：${errors.join('；')}`)
}

export interface DownloadOptions {
  expectedSha1?: string
  expectedSha512?: string
  expectedSize?: number
  timeoutMs?: number
  signal?: AbortSignal
  onProgress?: (received: number, total: number) => void
}

export async function sha1File(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs')
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export async function sha512File(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs')
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Download a file to a temp path and atomically move it after all integrity
 * checks pass. URLs are attempted in order until one succeeds.
 */
export async function downloadFile(
  urls: string | string[],
  destination: string,
  options: DownloadOptions = {}
): Promise<{ path: string; url: string; bytes: number }> {
  const candidates = Array.isArray(urls) ? urls : [urls]
  await mkdir(dirname(destination), { recursive: true })
  const temp = `${destination}.download`
  const errors: string[] = []

  for (const url of candidates) {
    let received = 0
    try {
      const response = await fetchResponse(url, {
        timeoutMs: options.timeoutMs ?? 300_000,
        retries: 1,
        signal: options.signal
      })
      const total = Number(response.headers.get('content-length')) || options.expectedSize || 0
      if (!response.body) throw new Error('响应为空')
      const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
      let lastReport = 0
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length
          const now = Date.now()
          if (options.onProgress && now - lastReport > 120) {
            lastReport = now
            options.onProgress(received, total)
          }
          callback(null, chunk)
        }
      })
      await pipeline(body, counter, createWriteStream(temp))
      options.onProgress?.(received, total || received)

      if (options.expectedSize && received !== options.expectedSize) {
        throw new Error(`文件大小不符（期望 ${options.expectedSize}，实际 ${received}）`)
      }
      if (options.expectedSha1) {
        const actual = await sha1File(temp)
        if (actual.toLowerCase() !== options.expectedSha1.toLowerCase()) {
          throw new Error(`SHA1 校验失败（期望 ${options.expectedSha1}，实际 ${actual}）`)
        }
      }
      if (options.expectedSha512) {
        const actual = await sha512File(temp)
        if (actual.toLowerCase() !== options.expectedSha512.toLowerCase()) {
          throw new Error('SHA512 校验失败')
        }
      }
      await rename(temp, destination)
      return { path: destination, url, bytes: received }
    } catch (error) {
      errors.push(`${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`)
      await rm(temp, { force: true }).catch(() => {})
      if (options.signal?.aborted) break
    }
  }
  throw new Error(`下载失败：${errors.join('；')}`)
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause
    if (cause instanceof Error && cause.message && !error.message.includes(cause.message)) {
      return `${error.message} (${cause.message})`
    }
    return error.message
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
