interface PlayerAvatarProps {
  name: string
  size?: number
  className?: string
  skinUrl?: string
}

function hueFor(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

export function PlayerAvatar({ name, size = 34, className = '', skinUrl }: PlayerAvatarProps) {
  const hue = hueFor(name || 'Steve')
  const skin = `hsl(${28 + (hue % 18)} 62% 71%)`
  const hair = `hsl(${hue} 36% 24%)`
  const shirt = `hsl(${(hue + 160) % 360} 56% 45%)`
  const safeSkin =
    skinUrl && /^https:\/\//i.test(skinUrl) ? skinUrl.replace(/"/g, '%22') : undefined
  return (
    <span className={`player-avatar ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64" width={size} height={size}>
        <rect width="64" height="64" rx="13" fill={shirt} />
        <rect x="8" y="7" width="48" height="11" rx="2" fill={hair} />
        <rect x="11" y="14" width="42" height="42" rx="4" fill={skin} />
        <rect x="11" y="14" width="9" height="30" fill={hair} opacity=".8" />
        <rect x="44" y="14" width="9" height="21" fill={hair} opacity=".8" />
        <rect x="19" y="29" width="8" height="8" rx="1" fill="#f5f7fb" />
        <rect x="37" y="29" width="8" height="8" rx="1" fill="#f5f7fb" />
        <rect x="22" y="31" width="5" height="5" rx="1" fill="#232a3b" />
        <rect x="38" y="31" width="5" height="5" rx="1" fill="#232a3b" />
        <rect x="26" y="43" width="12" height="3" rx="1.5" fill="#7a3d38" opacity=".75" />
        <rect x="29" y="41" width="6" height="5" fill="#d39a81" opacity=".7" />
      </svg>
      {safeSkin ? (
        <span
          className="player-skin-head"
          style={{
            backgroundImage: `url("${safeSkin}")`,
            backgroundSize: `${size * 8}px ${size * 8}px`,
            backgroundPosition: `-${size}px -${size}px`
          }}
        />
      ) : null}
    </span>
  )
}
