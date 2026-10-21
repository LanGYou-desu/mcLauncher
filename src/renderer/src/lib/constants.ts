import type { DownloadSource, LoaderType } from '../../../shared/types'

export const LOADER_META: Record<LoaderType, { name: string; short: string; color: string; soft: string }> = {
  vanilla: { name: '原版', short: 'VANILLA', color: '#b4f47b', soft: 'rgba(180,244,123,.12)' },
  fabric: { name: 'Fabric', short: 'FABRIC', color: '#f0cf74', soft: 'rgba(240,207,116,.12)' },
  forge: { name: 'Forge', short: 'FORGE', color: '#f39a69', soft: 'rgba(243,154,105,.12)' },
  neoforge: { name: 'NeoForge', short: 'NEOFORGE', color: '#f47f91', soft: 'rgba(244,127,145,.12)' }
}

export const SOURCE_LABELS: Record<DownloadSource, string> = {
  auto: '自动选择',
  official: 'Mojang 官方',
  bmclapi: 'BMCLAPI 国内镜像'
}

export const SOURCE_SHORT: Record<DownloadSource, string> = {
  auto: '自动',
  official: '官方源',
  bmclapi: '国内镜像'
}

export const VERSION_TYPE_LABELS: Record<string, string> = {
  release: '正式版',
  snapshot: '快照',
  old_beta: '远古 β',
  old_alpha: '远古 α'
}

export const STAGE_LABELS: Record<string, string> = {
  mods: '模组',
  shaderpacks: '光影',
  resourcepacks: '资源包',
  saves: '存档'
}
