import type { MineHarborApi } from '../../../shared/types'

export const api: MineHarborApi = window.mineHarbor

export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/^Error invoking remote method "[^"]+":\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '0'
  if (value >= 100_000_000) return (value / 100_000_000).toFixed(1) + ' 亿'
  if (value >= 10_000) return (value / 10_000).toFixed(value >= 100_000 ? 0 : 1) + ' 万'
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'k'
  return String(value)
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, index)
  return (index === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)) + ' ' + units[index]
}

export function formatRelativeTime(timestamp: number | undefined | null): string {
  if (!timestamp) return '从未启动'
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前'
  if (diff < 604_800_000) return Math.floor(diff / 86_400_000) + ' 天前'
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function formatDate(value: string | number): string {
  return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatPlayTime(ms: number | undefined | null): string {
  if (!ms) return '0 分钟'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return minutes + ' 分钟'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + ' 小时 ' + (minutes % 60) + ' 分'
  return Math.floor(hours / 24) + ' 天 ' + (hours % 24) + ' 小时'
}

export function greet(): string {
  const hour = new Date().getHours()
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

export function isElectron(): boolean {
  return Boolean(window.mineHarbor)
}
