interface LogoProps {
  size?: number
  className?: string
  glow?: boolean
}

export function Logo({ size = 34, className = '', glow = true }: LogoProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={glow ? { filter: 'drop-shadow(0 0 10px rgba(167,139,250,.35))' } : undefined}
    >
      <defs>
        <linearGradient id="mh-logo-top" x1="8" y1="3" x2="24" y2="13" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D5FFA8" />
          <stop offset="1" stopColor="#8CEB5D" />
        </linearGradient>
        <linearGradient id="mh-logo-left" x1="4" y1="10" x2="16" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4CBF87" />
          <stop offset="1" stopColor="#1E5A50" />
        </linearGradient>
        <linearGradient id="mh-logo-right" x1="16" y1="15" x2="29" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9176F8" />
          <stop offset="1" stopColor="#43369B" />
        </linearGradient>
      </defs>
      <path d="M16 1.8 29 9.1v13.8L16 30.2 3 22.9V9.1L16 1.8Z" fill="#111522" stroke="rgba(255,255,255,.2)" strokeWidth="0.8" />
      <path d="M16 3.2 27.7 9.8 16 16.4 4.3 9.8 16 3.2Z" fill="url(#mh-logo-top)" />
      <path d="M4.3 9.8 16 16.4v12L4.3 21.8v-12Z" fill="url(#mh-logo-left)" />
      <path d="M27.7 9.8 16 16.4v12l11.7-6.6v-12Z" fill="url(#mh-logo-right)" />
      <path d="m16 16.4 4.3-2.4v4.8L16 21.3v-4.9Z" fill="#D9FFB7" opacity=".9" />
    </svg>
  )
}
