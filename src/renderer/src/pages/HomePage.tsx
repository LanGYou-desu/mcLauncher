import { useState } from 'react'
import {
  ArrowRight,
  Blocks,
  Boxes,
  Clock3,
  Cpu,
  DownloadCloud,
  FolderOpen,
  Layers3,
  PackagePlus,
  Play,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  SquareArrowOutUpRight,
  TerminalSquare
} from 'lucide-react'
import type { InstanceSummary, LaunchSession } from '../../../shared/types'
import { useLauncher } from '../lib/launcher-context'
import { api, formatPlayTime, formatRelativeTime, friendlyError, greet } from '../lib/api'
import { SOURCE_SHORT, LOADER_META } from '../lib/constants'
import { HeroScene } from '../components/HeroScene'
import { LoaderBadge } from '../components/LoaderBadge'
import { PlayerAvatar } from '../components/PlayerAvatar'

export function HomePage() {
  const {
    config,
    auth,
    activeAccountName,
    selectedInstance,
    instances,
    java,
    sessions,
    launchInstance,
    launchingInstanceId,
    navigate,
    selectInstance,
    openContent,
    openConsole,
    pushToast,
    refreshInstances
  } = useLauncher()
  const [importing, setImporting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const activeSession: LaunchSession | undefined = selectedInstance
    ? sessions.find(
        (session) =>
          session.instanceId === selectedInstance.id && ['starting', 'running'].includes(session.status)
      )
    : undefined
  const stats = {
    instances: instances.length,
    mods: instances.reduce((sum, instance) => sum + instance.modsCount, 0),
    shaders: instances.reduce((sum, instance) => sum + instance.shaderpacksCount, 0),
    playTime: instances.reduce((sum, instance) => sum + (instance.playTimeMs ?? 0), 0)
  }
  const recent = [...instances]
    .sort((a, b) => (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt))
    .slice(0, 3)

  const sourceLabel = SOURCE_SHORT[config.downloadSource]
  const now = new Date()
  const dateLabel = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  const handleImport = async () => {
    setImporting(true)
    try {
      const submission = await api.modrinth.importModpack()
      if (submission) pushToast('整合包已加入安装队列', 'success')
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setImporting(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshInstances()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="page home-page">
      <header className="home-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dash" /> MY LAUNCHPAD</div>
          <h1>{greet()}，{activeAccountName}<span className="accent-dot">.</span></h1>
          <p>{dateLabel} · 选择一个世界，让今天的冒险继续。</p>
        </div>
        <div className="home-heading-actions">
          <button className="chip-button" type="button" onClick={() => navigate('java')} title="Java 运行环境">
            <Cpu size={14} />
            <span>Java</span>
            <span className="chip-value">{java.length ? java.length + ' 个' : '未发现'}</span>
          </button>
          <button className="chip-button" type="button" onClick={() => navigate('downloads', { tab: 'game' })} title="当前下载源">
            <DownloadCloud size={14} />
            <span>{sourceLabel}</span>
          </button>
        </div>
      </header>

      <section className="hero-panel">
        <div className="hero-panel-glow" />
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dash" /> READY TO EXPLORE</div>
          <h2>下一段旅程，<br /><span>从方块开始。</span></h2>
          <p className="hero-description">
            从原版生存到大型整合包，矿港会照顾好下载、加载器与运行环境。你只需要决定，去哪里。
          </p>

          {selectedInstance ? (
            <div className="hero-instance">
              <div className={`hero-instance-mark mark-${selectedInstance.loader}`}>
                <span className="mark-cube"><i /><i /><i /></span>
              </div>
              <div className="hero-instance-copy">
                <span className="hero-instance-label">当前实例</span>
                <strong>{selectedInstance.name}</strong>
                <div className="hero-instance-badges">
                  <LoaderBadge loader={selectedInstance.loader} version={selectedInstance.loaderVersion} />
                  <span className="micro-badge">MC {selectedInstance.mcVersion}</span>
                  {selectedInstance.modsCount > 0 ? <span className="micro-badge">{selectedInstance.modsCount} 模组</span> : null}
                </div>
              </div>
              <div className="hero-instance-actions">
                {activeSession ? (
                  <button className="button launch-button running" type="button" onClick={() => openConsole(activeSession.id)}>
                    <TerminalSquare size={17} />
                    <span>运行中</span>
                    <span className="running-wave"><i /><i /><i /></span>
                  </button>
                ) : (
                  <button
                    className="button launch-button"
                    type="button"
                    disabled={launchingInstanceId === selectedInstance.id}
                    onClick={() => void launchInstance(selectedInstance.id)}
                  >
                    {launchingInstanceId === selectedInstance.id ? (
                      <RefreshCw size={17} className="spin" />
                    ) : (
                      <Play size={17} fill="currentColor" />
                    )}
                    <span>{launchingInstanceId === selectedInstance.id ? '启动中…' : '开始游戏'}</span>
                  </button>
                )}
                <div className="hero-icon-actions">
                  <button type="button" className="square-button" title="管理实例内容" onClick={() => openContent(selectedInstance.id)}>
                    <SlidersHorizontal size={16} />
                  </button>
                  <button
                    type="button"
                    className="square-button"
                    title="打开实例目录"
                    onClick={() => void api.config.revealInstance(selectedInstance.id).catch((error) => pushToast(friendlyError(error), 'error'))}
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="hero-empty">
              <div>
                <strong>还没有游戏实例</strong>
                <span>安装一个 Minecraft 版本，开启你的第一段旅程。</span>
              </div>
              <button className="button primary" type="button" onClick={() => navigate('downloads', { tab: 'game' })}>
                <Plus size={16} /> 安装游戏
              </button>
            </div>
          )}

          <div className="hero-subline">
            <span><span className="status-dot" /> {auth.mode === 'microsoft' ? '正版登录' : '本地启动'} · {activeAccountName}</span>
            <span className="hero-subline-dot">·</span>
            <span>{config.memoryMb >= 1024 ? Math.round(config.memoryMb / 1024) + ' GB' : config.memoryMb + ' MB'} 内存</span>
            <span className="hero-subline-dot">·</span>
            <span>{config.downloadConcurrency} 线程下载</span>
          </div>
        </div>

        <div className="hero-visual">
          <HeroScene
            loader={selectedInstance?.loader ?? 'vanilla'}
            mcVersion={selectedInstance?.mcVersion ?? '1.21.1'}
            mods={selectedInstance?.modsCount ?? 0}
          />
        </div>
      </section>

      <section className="stats-grid">
        <StatCard icon={Boxes} label="游戏实例" value={String(stats.instances).padStart(2, '0')} hint="这个启动器里的世界" tone="lime" />
        <StatCard icon={Blocks} label="已装载模组" value={String(stats.mods).padStart(2, '0')} hint="不同实例合并统计" tone="violet" />
        <StatCard icon={Sparkles} label="光影收藏" value={String(stats.shaders).padStart(2, '0')} hint="随时为世界换个光线" tone="teal" />
        <StatCard icon={Clock3} label="陪伴时长" value={formatPlayTime(stats.playTime).replace(' ', '')} hint="在方块之间度过的时光" tone="gold" />
      </section>

      <section className="home-lower">
        <div className="section-block recent-block">
          <div className="section-header">
            <div>
              <h3>继续旅程</h3>
              <p>最近打开过的世界</p>
            </div>
            <button className="text-button" type="button" onClick={() => navigate('versions')}>
              全部版本 <ArrowRight size={14} />
            </button>
          </div>
          {recent.length ? (
            <div className="recent-grid">
              {recent.map((instance) => (
                <RecentCard
                  key={instance.id}
                  instance={instance}
                  active={instance.id === selectedInstance?.id}
                  running={sessions.some(
                    (session) => session.instanceId === instance.id && ['starting', 'running'].includes(session.status)
                  )}
                  onSelect={() => selectInstance(instance.id)}
                  onLaunch={() => void launchInstance(instance.id)}
                  onManage={() => openContent(instance.id)}
                />
              ))}
            </div>
          ) : (
            <div className="recent-empty">
              <div className="empty-cube"><i /><i /><i /><i /></div>
              <div>
                <strong>世界还在等待生成</strong>
                <span>下载一个版本，或者导入你已有的 Minecraft 目录。</span>
              </div>
              <button className="button ghost small" type="button" onClick={() => navigate('downloads', { tab: 'game' })}>
                去下载
              </button>
            </div>
          )}
        </div>

        <aside className="section-block quick-block">
          <div className="section-header compact">
            <div>
              <h3>探索更多</h3>
              <p>把新的内容带进世界</p>
            </div>
            <button className="icon-button small" type="button" onClick={() => void handleRefresh()} title="刷新实例">
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            </button>
          </div>
          <div className="quick-list">
            <QuickAction icon={PackagePlus} label="下载整合包" hint="由 Modrinth 驱动" color="violet" onClick={() => navigate('downloads', { tab: 'modpack' })} />
            <QuickAction icon={DownloadCloud} label="安装新版本" hint="原版 / 模组加载器" color="lime" onClick={() => navigate('downloads', { tab: 'game' })} />
            <QuickAction icon={Blocks} label="安装模组与光影" hint="选择实例后一键安装" color="teal" onClick={() => navigate('downloads', { tab: 'mod' })} />
            <QuickAction
              icon={importing ? RefreshCw : SquareArrowOutUpRight}
              label={importing ? '正在打开…' : '导入本地整合包'}
              hint="支持 .mrpack 格式"
              color="gold"
              onClick={() => void handleImport()}
              spinning={importing}
            />
          </div>
          <div className="quick-footer">
            <div className="quick-status">
              <span className="status-dot" />
              <span>游戏目录</span>
              <strong title={config.gameRoot}>{shortPath(config.gameRoot)}</strong>
            </div>
            <button type="button" className="mini-link" onClick={() => void api.config.revealGameRoot()}>
              打开
            </button>
          </div>
        </aside>
      </section>
    </div>
  )
}

function shortPath(path: string): string {
  if (path.length <= 32) return path
  const parts = path.split(/[\\/]/)
  return parts[0] + '…' + parts.slice(-1)[0]
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone
}: {
  icon: typeof Boxes
  label: string
  value: string
  hint: string
  tone: 'lime' | 'violet' | 'teal' | 'gold'
}) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-icon"><Icon size={17} /></div>
      <div className="stat-content">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <span className="stat-hint">{hint}</span>
    </div>
  )
}

function RecentCard({
  instance,
  active,
  running,
  onSelect,
  onLaunch,
  onManage
}: {
  instance: InstanceSummary
  active: boolean
  running: boolean
  onSelect: () => void
  onLaunch: () => void
  onManage: () => void
}) {
  const meta = LOADER_META[instance.loader]
  return (
    <div className={`recent-card ${active ? 'is-active' : ''}`} onClick={onSelect}>
      <div className={`recent-cover cover-${instance.loader}`}>
        <div className="cover-grid" />
        <div className="cover-cube"><i /><i /><i /></div>
        <span className="cover-name" title={instance.name}>{instance.name}</span>
        <span className="cover-loader" style={{ color: meta.color }}>MC {instance.mcVersion} · {meta.short}</span>
        {running ? <span className="cover-running"><span className="live-dot" /> 运行中</span> : null}
      </div>
      <div className="recent-body">
        <div className="recent-title-row">
          <span className="recent-version-label">Minecraft {instance.mcVersion}</span>
          <button
            type="button"
            className="round-play"
            title={running ? '游戏运行中' : '启动游戏'}
            onClick={(event) => {
              event.stopPropagation()
              if (running) {
                onManage()
              } else {
                onLaunch()
              }
            }}
          >
            <Play size={13} fill="currentColor" />
          </button>
        </div>
        <div className="recent-meta">
          <span>{instance.modsCount} 个模组</span>
          <span>·</span>
          <span>{formatRelativeTime(instance.lastPlayedAt)}</span>
        </div>
        <div className="recent-tags">
          <LoaderBadge loader={instance.loader} compact />
          {instance.shaderpacksCount ? <span className="micro-badge"><Sparkles size={10} /> {instance.shaderpacksCount}</span> : null}
          {instance.external ? <span className="micro-badge">外部</span> : null}
        </div>
      </div>
      <button className="recent-manage" type="button" onClick={(event) => { event.stopPropagation(); onManage() }} title="管理模组与光影">
        <Layers3 size={14} />
      </button>
    </div>
  )
}

function QuickAction({
  icon: Icon,
  label,
  hint,
  color,
  onClick,
  spinning
}: {
  icon: typeof DownloadCloud
  label: string
  hint: string
  color: 'violet' | 'lime' | 'teal' | 'gold'
  onClick: () => void
  spinning?: boolean
}) {
  return (
    <button className={`quick-action quick-${color}`} type="button" onClick={onClick}>
      <span className="quick-icon"><Icon size={17} className={spinning ? 'spin' : ''} /></span>
      <span className="quick-copy">
        <strong>{label}</strong>
        <em>{hint}</em>
      </span>
      <ArrowRight size={14} className="quick-arrow" />
    </button>
  )
}