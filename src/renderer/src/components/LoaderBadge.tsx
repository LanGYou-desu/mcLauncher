import { Anvil, Box, Flame, Scissors } from 'lucide-react'
import type { LoaderType } from '../../../shared/types'
import { LOADER_LABELS } from '../../../shared/types'

const ICONS = {
  vanilla: Box,
  fabric: Scissors,
  forge: Anvil,
  neoforge: Flame
}

export function LoaderBadge({
  loader,
  version,
  compact = false,
  className = ''
}: {
  loader: LoaderType
  version?: string
  compact?: boolean
  className?: string
}) {
  const Icon = ICONS[loader]
  return (
    <span className={`loader-badge loader-${loader} ${compact ? 'is-compact' : ''} ${className}`}>
      <Icon size={compact ? 11 : 13} strokeWidth={2.2} />
      <span>{LOADER_LABELS[loader]}</span>
      {version && !compact ? <span className="loader-version">{version}</span> : null}
    </span>
  )
}
