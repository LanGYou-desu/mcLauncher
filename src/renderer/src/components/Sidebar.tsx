import {
  Boxes,
  ChevronRight,
  DownloadCloud,
  Home,
  Settings,
  Sprout,
  TerminalSquare
} from 'lucide-react'
import { useLauncher, type Page } from '../lib/launcher-context'
import { PlayerAvatar } from './PlayerAvatar'
import { LoaderBadge } from './LoaderBadge'

const NAV_ITEMS: Array<{ id: Page; label: string; hint: string; icon: typeof Home }> = [
  { id: 'home', label: '启动台', hint: 'HOME', icon: Home },
  { id: 'versions', label: '版本库', hint: 'INSTANCES', icon: Boxes },
  { id: 'downloads', label: '资源下载', hint: 'DISCOVER', icon: DownloadCloud },
  { id: 'java', label: 'Java 环境', hint: 'RUNTIMES', icon: TerminalSquare },
  { id: 'settings', label: '设置', hint: 'SETTINGS', icon: Settings }
]

export function Sidebar() {
  const {
    page,
    navigate,
    instances,
    selectedInstance,
    selectInstance,
    auth,
    activeAccountName,
    activeSkinUrl,
    setAccountOpen,
    sessions,
    openConsole
  } = useLauncher()
  const runningIds = new Set(
    sessions.filter((session) => ['starting', 'running'].includes(session.status)).map((session) => session.instanceId)
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-section-label">导航</div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              data-nav={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-icon"><Icon size={18} strokeWidth={1.9} /></span>
              <span className="nav-copy">
                <span className="nav-label">{item.label}</span>
                <span className="nav-hint">{item.hint}</span>
              </span>
              {page === item.id ? <span className="nav-active-mark" /> : null}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-section-label recent-label">
        最近实例
        <span>{instances.length}</span>
      </div>
      <div className="sidebar-instances">
        {instances.length === 0 ? (
          <button className="sidebar-empty" type="button" onClick={() => navigate('downloads', { tab: 'game' })}>
            <Sprout size={16} />
            <span>还没有游戏实例<br /><em>去下载一个吧</em></span>
          </button>
        ) : (
          instances.slice(0, 4).map((instance) => (
            <button
              key={instance.id}
              type="button"
              className={`sidebar-instance ${selectedInstance?.id === instance.id ? 'active' : ''}`}
              onClick={() => {
                selectInstance(instance.id)
                navigate('home')
              }}
            >
              <span className={`mini-cube cube-${instance.loader}`}>
                <span />
              </span>
              <span className="sidebar-instance-copy">
                <span className="sidebar-instance-name">{instance.name}</span>
                <span className="sidebar-instance-meta">
                  {runningIds.has(instance.id) ? <span className="running-text"><span className="live-dot" />运行中</span> : <LoaderBadge loader={instance.loader} compact />}
                </span>
              </span>
              <ChevronRight size={13} className="sidebar-instance-arrow" />
            </button>
          ))
        )}
      </div>

      <div className="sidebar-bottom">
        {sessions.some((session) => ['starting', 'running'].includes(session.status)) ? (
          <button
            className="sidebar-console-link"
            type="button"
            onClick={() => openConsole()}
          >
            <span className="live-dot" />
            <span>游戏控制台</span>
            <TerminalSquare size={14} />
          </button>
        ) : null}
        <button type="button" className="sidebar-profile" onClick={() => setAccountOpen(true)}>
          <PlayerAvatar name={activeAccountName} size={35} skinUrl={activeSkinUrl} />
          <span>
            <strong>{activeAccountName}</strong>
            <em>{auth.mode === 'microsoft' ? 'Microsoft 正版 · 在线档案' : '离线账户 · 本地世界'}</em>
          </span>
          <ChevronRight size={13} />
        </button>
        <div className="sidebar-build">
          <span>MINEHARBOR</span>
          <span>v1.0.0</span>
        </div>
      </div>
    </aside>
  )
}
