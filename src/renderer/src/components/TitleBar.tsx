import { Maximize2, Minus, Square, TerminalSquare, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLauncher } from '../lib/launcher-context'
import { PlayerAvatar } from './PlayerAvatar'
import { Logo } from './Logo'

export function TitleBar() {
  const { auth, activeAccountName, activeSkinUrl, sessions, openConsole, setAccountOpen } = useLauncher()
  const [maximized, setMaximized] = useState(false)
  const activeSession = sessions.find((session) => ['starting', 'running'].includes(session.status))

  useEffect(() => {
    let alive = true
    const refresh = () => {
      void window.mineHarbor.window.isMaximized().then((value) => {
        if (alive) setMaximized(value)
      })
    }
    refresh()
    window.addEventListener('resize', refresh)
    return () => {
      alive = false
      window.removeEventListener('resize', refresh)
    }
  }, [])

  return (
    <header
      className="titlebar"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        void window.mineHarbor.window.maximize()
      }}
    >
      <div className="titlebar-brand">
        <Logo size={21} />
        <span className="titlebar-name">矿港</span>
        <span className="titlebar-divider" />
        <span className="titlebar-sub">MINEHARBOR</span>
      </div>
      <div className="titlebar-spacer" />
      {activeSession ? (
        <button className="titlebar-session" onClick={() => openConsole(activeSession.id)} type="button">
          <span className="live-dot" />
          <span>游戏运行中</span>
          <TerminalSquare size={14} />
        </button>
      ) : (
        <span className="titlebar-status"><span className="status-dot" /> 就绪</span>
      )}
      <button className="titlebar-profile no-drag" onClick={() => setAccountOpen(true)} type="button">
        <PlayerAvatar name={activeAccountName} size={25} skinUrl={activeSkinUrl} />
        <span>{activeAccountName}</span>
        <span className={`offline-tag ${auth.mode === 'microsoft' ? 'premium' : ''}`}>
          {auth.mode === 'microsoft' ? '正版' : '离线'}
        </span>
      </button>
      <div className="window-controls no-drag">
        <button type="button" aria-label="最小化" onClick={() => window.mineHarbor.window.minimize()}>
          <Minus size={15} />
        </button>
        <button
          type="button"
          aria-label={maximized ? '还原' : '最大化'}
          onClick={() => window.mineHarbor.window.maximize()}
        >
          {maximized ? <Square size={12} /> : <Maximize2 size={13} />}
        </button>
        <button type="button" className="window-close" aria-label="关闭" onClick={() => window.mineHarbor.window.close()}>
          <X size={16} />
        </button>
      </div>
    </header>
  )
}