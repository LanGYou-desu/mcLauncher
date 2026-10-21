import { useMemo } from 'react'

interface CubeProps {
  x: number
  y: number
  size: number
  top: string
  left: string
  right: string
  opacity?: number
  stroke?: string
}

function IsoCube({ x, y, size, top, left, right, opacity = 1, stroke = 'rgba(9,14,20,.22)' }: CubeProps) {
  const w = size * 1.15
  const h = size * 0.56
  return (
    <g transform={`translate(${x} ${y})`} opacity={opacity}>
      <path d={`M0 ${-size} L${w} ${-h} L0 0 L${-w} ${-h} Z`} fill={top} stroke={stroke} strokeWidth=".7" />
      <path d={`M${-w} ${-h} L0 0 L0 ${size * 1.05} L${-w} ${size * 0.5} Z`} fill={left} stroke={stroke} strokeWidth=".7" />
      <path d={`M${w} ${-h} L0 0 L0 ${size * 1.05} L${w} ${size * 0.5} Z`} fill={right} stroke={stroke} strokeWidth=".7" />
    </g>
  )
}

function Tree({ x, y, scale = 1, colorful = false }: { x: number; y: number; scale?: number; colorful?: boolean }) {
  const leafTop = colorful ? '#f5b5dc' : '#a8ec76'
  const leafLeft = colorful ? '#d77db4' : '#63c65a'
  const leafRight = colorful ? '#b45b96' : '#3e9b4c'
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="3" cy="31" rx="26" ry="9" fill="rgba(8,17,12,.28)" filter="url(#hs-soft-blur)" />
      <path d="M-6 28 L-2 -12 L8 -16 L9 30 Z" fill="#6d452a" />
      <path d="M8 -16 L18 -10 L16 30 L9 30 Z" fill="#4d2f1d" />
      <path d="M-5 -12 L3 -17 L13 -12 L4 -7 Z" fill="#95633d" />
      <g>
        <IsoCube x={-2} y={-45} size={27} top={leafTop} left={leafLeft} right={leafRight} />
        <IsoCube x={17} y={-31} size={20} top={leafTop} left={leafLeft} right={leafRight} />
        <IsoCube x={-22} y={-26} size={19} top={leafTop} left={leafLeft} right={leafRight} />
        <IsoCube x={2} y={-67} size={18} top={colorful ? '#ffd4eb' : '#c8f99d'} left={leafLeft} right={leafRight} />
      </g>
      <path d="M-34 16 C-27 3 -18 1 -7 7" stroke="#78c45c" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".8" />
      <circle cx="-35" cy="16" r="3.4" fill="#f4d35e" />
      <circle cx="-29" cy="6" r="2.4" fill="#fff0b2" />
    </g>
  )
}

function Steve({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="35" rx="25" ry="8" fill="rgba(8,16,12,.32)" filter="url(#hs-soft-blur)" />
      <path d="M-17 7 L-3 2 L2 31 L-12 35 Z" fill="#26325a" />
      <path d="M-2 2 L13 7 L12 35 L1 31 Z" fill="#314372" />
      <path d="M-19 24 L-12 21 L-7 38 L-15 40 Z" fill="#313d65" />
      <path d="M-15 24 L-8 21 L-4 38 L-11 40 Z" fill="#242f52" />
      <path d="M-17 -24 L-2 -29 L0 7 L-16 11 Z" fill="#42b8b0" />
      <path d="M-1 -29 L15 -24 L15 11 L0 7 Z" fill="#2b8d8b" />
      <path d="M-16 -24 L-2 -29 L3 -23 L-12 -18 Z" fill="#6cdfd3" />
      <path d="M-16 -17 L-26 -8 L-22 7 L-14 3 Z" fill="#d39a81" />
      <path d="M15 -19 L23 -11 L20 4 L13 1 Z" fill="#b77e6a" />
      <path d="M-19 -38 L-2 -44 L2 -27 L-15 -22 Z" fill="#cf927b" />
      <path d="M-1 -44 L16 -37 L14 -20 L1 -26 Z" fill="#b57762" />
      <path d="M-19 -47 L-3 -54 L16 -43 L16 -35 L-1 -42 L-18 -35 Z" fill="#3f2b23" />
      <path d="M-18 -35 L-15 -22 L-8 -29 L-1 -23 L1 -27 L-3 -44 L-18 -38 Z" fill="#4c3327" />
      <rect x="-12" y="-39" width="6" height="7" rx="1" fill="#f0f4f7" />
      <rect x="2" y="-39" width="6" height="7" rx="1" fill="#f0f4f7" />
      <rect x="-10" y="-37" width="3.5" height="4.5" rx=".8" fill="#303044" />
      <rect x="4" y="-37" width="3.5" height="4.5" rx=".8" fill="#303044" />
      <rect x="-9" y="-28" width="12" height="3" rx="1" fill="#8c4d44" opacity=".8" />
      <path d="M22 13 L34 -34 L39 -32 L27 15 Z" fill="#b78a56" />
      <path d="M33 -38 L45 -42 L42 -28 L31 -25 Z" fill="#65d9cf" />
      <path d="M31 -25 L42 -28 L39 -21 L28 -18 Z" fill="#3ca69f" />
      <path d="M31 -40 L45 -42 L42 -28" fill="none" stroke="#bffcf0" strokeWidth="1.2" opacity=".7" />
    </g>
  )
}

function Portal({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="0" cy="19" rx="43" ry="15" fill="rgba(103,70,190,.22)" filter="url(#hs-soft-blur)" />
      <IsoCube x={-27} y={12} size={10} top="#5a5470" left="#3c374f" right="#2d2a3d" />
      <IsoCube x={27} y={12} size={10} top="#5a5470" left="#3c374f" right="#2d2a3d" />
      <path d="M-24 0 L-24 -57 L-15 -62 L-15 -4 Z" fill="#3c374f" />
      <path d="M-15 -62 L-3 -68 L-3 -10 L-15 -4 Z" fill="#514a67" />
      <path d="M15 -58 L24 -52 L24 0 L15 4 Z" fill="#322f43" />
      <path d="M3 -66 L15 -58 L15 4 L3 10 Z" fill="#47415a" />
      <path d="M-15 -62 L-3 -68 L9 -61 L-1 -57 Z" fill="#615a7b" />
      <rect x="-14" y="-55" width="28" height="55" rx="2" fill="url(#hs-portal-fill)" />
      <rect x="-12" y="-53" width="24" height="51" rx="1" fill="url(#hs-portal-inner)" opacity=".82" />
      <ellipse cx="3" cy="-25" rx="23" ry="35" fill="#a77bff" opacity=".17" filter="url(#hs-soft-blur)" />
      <path d="M-8 -45 C4 -30 -8 -20 3 -3" stroke="#e9ddff" strokeWidth=".8" opacity=".65" fill="none" />
      <path d="M8 -47 C-1 -31 13 -19 5 4" stroke="#f4c9ff" strokeWidth=".6" opacity=".45" fill="none" />
      <circle cx="-19" cy="-38" r="2.2" fill="#cbb3ff" />
      <circle cx="18" cy="-14" r="1.6" fill="#f1d8ff" />
      <circle cx="-24" cy="-7" r="1.2" fill="#b79aff" />
      <path d="M-27 15 C-33 25 -28 35 -22 47" stroke="#5b7d45" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M25 16 C31 27 27 35 31 48" stroke="#5b7d45" strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  )
}

function Lamp({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M0 0 L3 -17 L7 -17 L5 0 Z" fill="#82623f" />
      <rect x="1" y="-27" width="8" height="9" rx="1.5" fill="#ffd978" />
      <circle cx="5" cy="-24" r="17" fill="#ffd469" opacity=".15" filter="url(#hs-soft-blur)" />
      <circle cx="5" cy="-24" r="4" fill="#fff2be" />
    </g>
  )
}

export function HeroScene({ loader = 'vanilla', mcVersion = '1.21.1', mods = 0 }: { loader?: string; mcVersion?: string; mods?: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: 28 }, (_, index) => ({
        x: 70 + ((index * 137) % 620),
        y: 45 + ((index * 83) % 260),
        r: index % 5 === 0 ? 1.7 : index % 3 === 0 ? 1.2 : 0.8,
        o: 0.16 + ((index * 7) % 40) / 100
      })),
    []
  )

  return (
    <div className="hero-scene">
      <svg viewBox="0 0 760 590" role="img" aria-label="漂浮的方块世界">
        <defs>
          <radialGradient id="hs-halo" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#7b5deb" stopOpacity=".42" />
            <stop offset=".55" stopColor="#4936a8" stopOpacity=".14" />
            <stop offset="1" stopColor="#0c1020" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hs-warm" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#bbf679" stopOpacity=".25" />
            <stop offset="1" stopColor="#bbf679" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hs-top" x1="170" y1="185" x2="640" y2="380" gradientUnits="userSpaceOnUse">
            <stop stopColor="#a7e978" />
            <stop offset=".55" stopColor="#7bcf58" />
            <stop offset="1" stopColor="#59ad47" />
          </linearGradient>
          <linearGradient id="hs-left" x1="180" y1="330" x2="420" y2="520" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7f573d" />
            <stop offset="1" stopColor="#4d3628" />
          </linearGradient>
          <linearGradient id="hs-right" x1="430" y1="330" x2="660" y2="500" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5e402d" />
            <stop offset="1" stopColor="#39291f" />
          </linearGradient>
          <linearGradient id="hs-stone" x1="240" y1="430" x2="500" y2="530" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5b5c64" />
            <stop offset="1" stopColor="#353740" />
          </linearGradient>
          <linearGradient id="hs-water" x1="300" y1="250" x2="500" y2="330" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6be4e1" />
            <stop offset=".6" stopColor="#3ab9cf" />
            <stop offset="1" stopColor="#257fbb" />
          </linearGradient>
          <linearGradient id="hs-portal-fill" x1="-10" y1="-50" x2="15" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#d8c9ff" />
            <stop offset=".35" stopColor="#8f6cff" />
            <stop offset="1" stopColor="#5735ce" />
          </linearGradient>
          <linearGradient id="hs-portal-inner" x1="0" y1="-50" x2="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#2b165c" />
            <stop offset=".55" stopColor="#7b52f0" />
            <stop offset="1" stopColor="#dfb8ff" />
          </linearGradient>
          <linearGradient id="hs-cloud" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#c9d4ff" stopOpacity=".16" />
            <stop offset="1" stopColor="#6a78a3" stopOpacity="0" />
          </linearGradient>
          <filter id="hs-soft-blur" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
          <filter id="hs-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="hs-island-top">
            <path d="M430 150 L695 282 L430 414 L165 282 Z" />
          </clipPath>
        </defs>

        <ellipse cx="440" cy="280" rx="390" ry="270" fill="url(#hs-halo)" />
        <ellipse cx="540" cy="220" rx="210" ry="180" fill="url(#hs-warm)" />
        <g className="hero-stars">
          {stars.map((star, index) => (
            <circle key={index} cx={star.x} cy={star.y} r={star.r} fill="#dfe8ff" opacity={star.o} />
          ))}
        </g>

        <g opacity=".38">
          <path d="M45 404 C92 380 143 382 182 398 C196 370 240 363 266 386 C302 380 324 399 326 418 C278 431 114 435 45 420 Z" fill="url(#hs-cloud)" />
          <path d="M505 458 C552 434 612 438 648 454 C670 436 716 445 728 464 C703 486 566 491 505 472 Z" fill="url(#hs-cloud)" />
        </g>

        <g className="island-float">
          <ellipse cx="433" cy="505" rx="242" ry="46" fill="#070a12" opacity=".55" filter="url(#hs-soft-blur)" />

          {/* Hanging stone underside */}
          <path d="M183 331 L428 444 L430 522 L392 508 L371 535 L339 513 L303 529 L282 499 L252 505 L238 475 L205 462 Z" fill="url(#hs-stone)" opacity=".88" />
          <path d="M677 332 L430 444 L430 522 L469 505 L490 534 L521 512 L558 527 L578 496 L609 501 L623 470 L655 458 Z" fill="#2b2d35" opacity=".92" />
          <path d="M205 391 L249 413 L238 441 L196 418 Z" fill="#474852" opacity=".7" />
          <path d="M590 399 L635 377 L648 404 L604 425 Z" fill="#21232b" opacity=".8" />
          <path d="M371 457 L403 474 L389 492 L356 475 Z" fill="#3c3e48" opacity=".7" />
          <path d="M445 486 L476 500 L468 519 L438 505 Z" fill="#24262e" opacity=".8" />
          <path d="M325 487 L348 498 L341 514 L317 503 Z" fill="#454751" opacity=".6" />

          {/* Soil sides */}
          <path d="M165 282 L430 414 L430 486 L165 354 Z" fill="url(#hs-left)" />
          <path d="M695 282 L430 414 L430 486 L695 354 Z" fill="url(#hs-right)" />
          <path d="M165 282 L430 414 L430 442 L165 310 Z" fill="#4d8f3a" opacity=".8" />
          <path d="M695 282 L430 414 L430 442 L695 310 Z" fill="#356d2f" opacity=".88" />
          <path d="M165 310 L430 442 L430 454 L165 322 Z" fill="#2b5425" opacity=".45" />
          <path d="M695 310 L430 442 L430 454 L695 322 Z" fill="#203f1e" opacity=".5" />

          {/* Dirt strata / cracks */}
          <g opacity=".55">
            <path d="M180 345 L260 383 L280 401 L213 372 Z" fill="#8b6248" />
            <path d="M306 423 L352 445 L347 466 L300 443 Z" fill="#352419" />
            <path d="M242 424 L272 439 L257 461 L229 446 Z" fill="#2e2118" />
            <path d="M621 361 L664 384 L648 404 L605 381 Z" fill="#241810" />
            <path d="M534 432 L571 449 L560 470 L525 452 Z" fill="#21170f" />
            <path d="M423 472 L454 486 L446 505 L416 491 Z" fill="#1e150e" />
          </g>

          {/* Grass top */}
          <path d="M430 150 L695 282 L430 414 L165 282 Z" fill="url(#hs-top)" />
          <g clipPath="url(#hs-island-top)" opacity=".3" stroke="#2f7d36" strokeWidth=".8">
            {Array.from({ length: 9 }, (_, i) => {
              const offset = i * 54
              return (
                <g key={i}>
                  <path d={`M${165 + offset} 282 L${430 + offset * 0.0001} 150`} opacity="0" />
                  <path d={`M${165 + offset} 282 L${430} 414`} />
                  <path d={`M${165} 282 L${430 - offset} 150`} />
                </g>
              )
            })}
          </g>
          <path d="M430 150 L695 282 L430 414 L165 282 Z" fill="none" stroke="#c6f59b" strokeOpacity=".4" strokeWidth="1.3" />
          <path d="M183 287 L430 407 L677 287" fill="none" stroke="#3f8e36" strokeOpacity=".45" strokeWidth="3" />
          <path d="M246 300 L430 390 L614 300" fill="none" stroke="#edffcf" strokeOpacity=".08" strokeWidth="1" />

          {/* Pond */}
          <g>
            <path d="M314 297 L393 336 L465 298 L384 260 Z" fill="#368834" opacity=".8" />
            <path d="M322 296 L393 330 L457 296 L386 263 Z" fill="url(#hs-water)" />
            <path d="M339 293 C365 285 411 287 430 300 C402 316 360 316 339 304 Z" fill="#b4fffd" opacity=".18" />
            <path d="M360 300 C385 293 407 296 419 303" stroke="#c7ffff" strokeWidth="1.4" opacity=".45" fill="none" strokeLinecap="round" />
            <path d="M383 310 C397 306 410 308 416 313" stroke="#b4f5ff" strokeWidth="1" opacity=".35" fill="none" strokeLinecap="round" />
            <path d="M315 297 L306 298" stroke="#7fbf52" strokeWidth="3" strokeLinecap="round" />
            <path d="M456 297 L470 299" stroke="#6cb54c" strokeWidth="3" strokeLinecap="round" />
            <ellipse cx="398" cy="302" rx="9" ry="4" fill="#7be2c8" opacity=".5" />
            <circle cx="380" cy="291" r="2.2" fill="#d9fff4" opacity=".65" />
          </g>

          {/* Trail */}
          <g opacity=".35">
            <path d="M409 352 L432 341 L457 352 L434 364 Z" fill="#d8c27c" />
            <path d="M439 332 L461 321 L484 332 L462 344 Z" fill="#d8c27c" />
            <path d="M470 313 L489 304 L509 313 L490 323 Z" fill="#d8c27c" />
            <path d="M501 296 L517 288 L533 296 L517 305 Z" fill="#d8c27c" />
          </g>

          <Tree x={266} y={319} scale={0.94} />
          <Tree x={581} y={285} scale={0.58} colorful />
          <Tree x={333} y={242} scale={0.42} colorful />
          <Portal x={583} y={360} scale={0.98} />
          <Steve x={399} y={337} />
          <Lamp x={508} y={348} />

          {/* Flowers and grass tufts */}
          <g>
            <path d="M312 357 C310 347 313 342 317 337" stroke="#4f9c3f" strokeWidth="1.4" fill="none" />
            <circle cx="317" cy="335" r="3" fill="#f7e17b" />
            <path d="M497 375 C499 365 503 361 508 357" stroke="#4f9c3f" strokeWidth="1.3" fill="none" />
            <circle cx="508" cy="355" r="2.6" fill="#f2a7d0" />
            <path d="M537 330 C542 323 546 321 551 321" stroke="#4f9c3f" strokeWidth="1.2" fill="none" />
            <circle cx="552" cy="320" r="2.3" fill="#f6f0a0" />
            <path d="M226 327 C228 319 233 315 237 313" stroke="#4f9c3f" strokeWidth="1.5" fill="none" />
            <circle cx="238" cy="311" r="3" fill="#eef1b5" />
            <path d="M633 315 C638 307 641 305 646 305" stroke="#4f9c3f" strokeWidth="1.3" fill="none" />
            <circle cx="647" cy="304" r="2.5" fill="#f1b5d8" />
          </g>

          {/* Small mushrooms */}
          <g transform="translate(347 389)">
            <path d="M0 0 L2 -8 L5 -8 L6 0 Z" fill="#f2dfc6" />
            <path d="M-4 -8 C-3 -15 8 -16 11 -8 Z" fill="#d95d61" />
            <circle cx="1" cy="-11" r="1.2" fill="#ffe8d7" />
            <circle cx="7" cy="-10" r="1" fill="#ffe8d7" />
          </g>
        </g>

        {/* Floating chunks */}
        <g className="float-block float-1">
          <IsoCube x={145} y={180} size={13} top="#d3ffaa" left="#69b454" right="#3f772f" />
        </g>
        <g className="float-block float-2">
          <IsoCube x={704} y={180} size={10} top="#c9b9ff" left="#795fd2" right="#47368e" />
        </g>
        <g className="float-block float-3">
          <IsoCube x={661} y={422} size={8} top="#ffd9a1" left="#be824d" right="#7c522f" />
        </g>
        <g className="float-block float-4">
          <IsoCube x={141} y={380} size={6} top="#a9f4e7" left="#3fa69c" right="#27655f" />
        </g>

        {/* Fireflies */}
        <g className="hero-fireflies" filter="url(#hs-glow)">
          <circle cx="238" cy="248" r="2.6" fill="#d6ff9a" />
          <circle cx="655" cy="330" r="2" fill="#d5c6ff" />
          <circle cx="552" cy="218" r="1.8" fill="#f7ffc0" />
          <circle cx="352" cy="438" r="1.6" fill="#a9fff1" />
          <circle cx="497" cy="445" r="2.1" fill="#e0c7ff" />
          <circle cx="628" cy="249" r="1.4" fill="#f4d9a6" />
        </g>
      </svg>

      <div className="hero-scene-tag top-left">
        <span className="scene-signal" />
        <span>WORLD READY</span>
      </div>
      <div className="hero-scene-tag top-right">
        <span>MC {mcVersion}</span>
        <span className="scene-dot" />
        <span className={`scene-loader scene-loader-${loader}`}>{loader.toUpperCase()}</span>
      </div>
      <div className="hero-scene-card">
        <div className="scene-card-icon"><span /></div>
        <div>
          <span>当前世界</span>
          <strong>{mods > 0 ? mods + ' 个模组已装载' : '准备好开始冒险'}</strong>
        </div>
      </div>
    </div>
  )
}
