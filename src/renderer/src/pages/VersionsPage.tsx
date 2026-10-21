import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FolderOpen,
  Loader2,
  MemoryStick,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Wrench
} from 'lucide-react'
import type { InstanceSummary, LoaderType } from '../../../shared/types'
import { useLauncher } from '../lib/launcher-context'
import { api, formatBytes, formatRelativeTime, friendlyError } from '../lib/api'
import { LOADER_META } from '../lib/constants'
import { LoaderBadge } from '../components/LoaderBadge'
import { Modal, ModalHeader } from '../components/Modal'
import { InstallGameModal } from '../components/InstallGameModal'
import { ScanMinecraftPanel } from '../components/ScanMinecraftPanel'
import { InstanceSettingsModal } from '../components/InstanceSettingsModal'

type LoaderFilter = 'all' | LoaderType

export function VersionsPage() {
  const {
    instances,
    sessions,
    pushToast,
    refreshInstances,
    openContent,
    launchInstance,
    launchingInstanceId,
    config
  } = useLauncher()
  const [query, setQuery] = useState('')
  const [loaderFilter, setLoaderFilter] = useState<LoaderFilter>('all')
  const [sort, setSort] = useState<'recent' | 'name' | 'created'>('recent')
  const [installVersion, setInstallVersion] = useState<string | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [settingsInstance, setSettingsInstance] = useState<InstanceSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<InstanceSummary | null>(null)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [quickVersion, setQuickVersion] = useState('1.21.1')
  const [addingRoot, setAddingRoot] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    api.versions
      .catalog(false)
      .then((catalog) => {
        if (alive && catalog.latest?.release) setQuickVersion(catalog.latest.release)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!menuId) return
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuId(null)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [menuId])

  const runningIds = new Set(
    sessions.filter((session) => ['starting', 'running'].includes(session.status)).map((session) => session.instanceId)
  )

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase()
    const list = instances.filter((instance) => {
      if (loaderFilter !== 'all' && instance.loader !== loaderFilter) return false
      if (!search) return true
      return (
        instance.name.toLowerCase().includes(search) ||
        instance.mcVersion.toLowerCase().includes(search) ||
        (instance.loaderVersion ?? '').toLowerCase().includes(search)
      )
    })
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN')
      if (sort === 'created') return b.createdAt - a.createdAt
      return (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt)
    })
  }, [instances, query, loaderFilter, sort])

  const counts = useMemo(
    () => ({
      all: instances.length,
      vanilla: instances.filter((instance) => instance.loader === 'vanilla').length,
      fabric: instances.filter((instance) => instance.loader === 'fabric').length,
      forge: instances.filter((instance) => instance.loader === 'forge').length,
      neoforge: instances.filter((instance) => instance.loader === 'neoforge').length
    }),
    [instances]
  )

  const handleRepair = async (instance: InstanceSummary) => {
    setMenuId(null)
    try {
      await api.versions.repair(instance.id)
      pushToast('修复任务已加入队列', 'success')
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    }
  }

  const handleAddRoot = async () => {
    setAddingRoot(true)
    try {
      const result = await api.minecraft.addRoot()
      if (!result) return
      pushToast('版本目录已加入扫描：' + result.root, 'success')
      setScanOpen(true)
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setAddingRoot(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.versions.remove(deleteTarget.id, deleteFiles)
      await refreshInstances()
      pushToast('实例已删除', 'success')
      setDeleteTarget(null)
      setSettingsInstance(null)
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="page versions-page">
      <header className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dash" /> LIBRARY</div>
          <h1>版本库<span className="accent-dot">.</span></h1>
          <p>{instances.length} 个实例 · {instances.reduce((sum, instance) => sum + instance.modsCount, 0)} 个模组 · 在这里整理每一个世界。</p>
        </div>
        <div className="page-actions">
          <button className="button ghost" data-version-action="directory" type="button" disabled={addingRoot} onClick={() => void handleAddRoot()}>
            {addingRoot ? <Loader2 size={16} className="spin" /> : <FolderOpen size={16} />} 指定版本目录
          </button>
          <button className="button ghost" data-version-action="scan" type="button" onClick={() => setScanOpen(true)}>
            <ScanSearch size={16} /> 扫描本机
          </button>
          <button className="button primary" data-version-action="install" type="button" onClick={() => setInstallVersion(quickVersion)}>
            <Plus size={16} /> 安装新版本
          </button>
        </div>
      </header>

      <div className="library-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input placeholder="搜索实例、游戏版本或加载器…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="filter-group">
          {(['all', 'vanilla', 'fabric', 'forge', 'neoforge'] as LoaderFilter[]).map((filter) => (
            <button
              key={filter}
              type="button"
              className={loaderFilter === filter ? 'active' : ''}
              onClick={() => setLoaderFilter(filter)}
            >
              {filter === 'all' ? '全部' : LOADER_META[filter].name}
              <span>{counts[filter]}</span>
            </button>
          ))}
        </div>
        <div className="sort-control">
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="排序方式">
            <option value="recent">最近启动</option>
            <option value="created">最近创建</option>
            <option value="name">名称排序</option>
          </select>
        </div>
      </div>

      {filtered.length ? (
        <div className="instance-grid">
          {filtered.map((instance) => {
            const meta = LOADER_META[instance.loader]
            const running = runningIds.has(instance.id)
            return (
              <article
                key={instance.id}
                className={`instance-card ${running ? 'is-running' : ''}`}
                style={{ '--loader-color': meta.color, '--loader-soft': meta.soft } as React.CSSProperties}
              >
                <div className={`instance-cover cover-${instance.loader}`}>
                  <div className="cover-grid" />
                  <div className="instance-cover-top">
                    <div className="instance-menu-wrap">
                      <button
                        className="cover-icon-button"
                        type="button"
                        onClick={() => setMenuId(menuId === instance.id ? null : instance.id)}
                        aria-label="更多操作"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="instance-cover-heading">
                    <h3 title={instance.name}>{instance.name}</h3>
                  </div>
                  <div className="instance-cover-cube"><i /><i /><i /><i /></div>
                  <div className="instance-cover-bottom">
                    <span className="instance-cover-tech" style={{ color: meta.color }}>
                      MC {instance.mcVersion} · {meta.name}{instance.loaderVersion ? ' ' + instance.loaderVersion : ''}
                    </span>
                    {running ? <span className="cover-running"><span className="live-dot" /> 游戏运行中</span> : null}
                  </div>
                </div>
                {menuId === instance.id ? (
                  <div className="card-menu" ref={menuRef}>
                    <button type="button" onClick={() => { setSettingsInstance(instance); setMenuId(null) }}>
                      <Settings2 size={14} /> 内存与实例设置
                    </button>
                    <button type="button" onClick={() => void api.config.revealInstance(instance.id)}>
                      <FolderOpen size={14} /> 打开目录
                    </button>
                    <button type="button" onClick={() => void handleRepair(instance)}>
                      <Wrench size={14} /> 修复文件
                    </button>
                    <span className="menu-divider" />
                    <button className="danger" type="button" onClick={() => { setDeleteTarget(instance); setMenuId(null) }}>
                      <Trash2 size={14} /> 删除实例
                    </button>
                  </div>
                ) : null}
                <div className="instance-card-body">
                  <div className="instance-title-row">
                    <div className="instance-summary">
                      <strong>{instance.modsCount} 个模组</strong>
                      <span>{instance.shaderpacksCount} 光影 · {formatRelativeTime(instance.lastPlayedAt)}</span>
                    </div>
                    <button
                      className={`instance-play ${running ? 'is-running' : ''}`}
                      type="button"
                      onClick={() => (running ? openContent(instance.id) : void launchInstance(instance.id))}
                      disabled={launchingInstanceId === instance.id}
                      title={running ? '管理内容' : '启动游戏'}
                    >
                      {launchingInstanceId === instance.id ? <Loader2 size={15} className="spin" /> : running ? <SlidersHorizontal size={15} /> : <Play size={15} fill="currentColor" />}
                    </button>
                  </div>
                  <div className="instance-tags-row">
                    <LoaderBadge loader={instance.loader} compact />
                    {instance.external ? <span className="micro-badge">外部</span> : null}
                    <span className="micro-badge"><MemoryStick size={10} /> {Math.round(((instance.memoryMb ?? config.memoryMb) / 1024) * 10) / 10} GB</span>
                  </div>
                  <div className="instance-card-footer">
                    <button type="button" className="text-button" onClick={() => openContent(instance.id)}>
                      <SlidersHorizontal size={13} /> 管理内容
                    </button>
                    <span className="instance-size">{formatBytes(instance.installedSize)}</span>
                  </div>
                </div>
              </article>
            )
          })}
          <button className="instance-add-card" type="button" onClick={() => setInstallVersion(quickVersion)}>
            <span><Plus size={22} /></span>
            <strong>创建新实例</strong>
            <em>原版或任意模组加载器</em>
          </button>
        </div>
      ) : (
        <div className="library-empty">
          <div className="empty-illustration">
            <span className="empty-orbit orbit-one" />
            <span className="empty-orbit orbit-two" />
            <div className="empty-cube large"><i /><i /><i /><i /></div>
          </div>
          <div>
            <div className="eyebrow">EMPTY LIBRARY</div>
            <h2>{instances.length ? '没有匹配的实例' : '你的第一个世界，从这里开始'}</h2>
            <p>{instances.length ? '试试换一个搜索词或加载器筛选。' : '安装一个 Minecraft 版本，或者扫描本机已有的游戏目录。'}</p>
            <div className="empty-actions">
              <button className="button primary" type="button" onClick={() => setInstallVersion(quickVersion)}><Plus size={16} /> 安装游戏</button>
              <button className="button ghost" type="button" onClick={() => setScanOpen(true)}><ScanSearch size={16} /> 扫描本机版本</button>
            </div>
          </div>
        </div>
      )}

      <InstallGameModal open={Boolean(installVersion)} mcVersion={installVersion} onClose={() => setInstallVersion(null)} />

      <Modal open={scanOpen} onClose={() => setScanOpen(false)} className="scan-modal">
        <ModalHeader
          eyebrow="IMPORT"
          title="扫描本机 Minecraft"
          description="发现已有版本并导入到矿港的版本库。"
          onClose={() => setScanOpen(false)}
        />
        <ScanMinecraftPanel onImported={() => setScanOpen(false)} />
      </Modal>

      <InstanceSettingsModal
        instance={settingsInstance}
        open={Boolean(settingsInstance)}
        onClose={() => setSettingsInstance(null)}
        onRequestDelete={(instance) => {
          setSettingsInstance(null)
          setDeleteTarget(instance)
        }}
      />

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} className="confirm-modal">
        <ModalHeader
          eyebrow="DANGER ZONE"
          title="删除这个实例？"
          description={deleteTarget ? '实例「' + deleteTarget.name + '」将从版本库中移除。' : undefined}
          onClose={() => setDeleteTarget(null)}
        />
        <div className="delete-summary">
          <div className={`delete-mark mark-${deleteTarget?.loader ?? 'vanilla'}`}>{deleteTarget?.mcVersion}</div>
          <div>
            <strong>{deleteTarget?.name}</strong>
            <span>{deleteTarget ? LOADER_META[deleteTarget.loader].name + ' · ' + deleteTarget.modsCount + ' 个模组 · ' + formatBytes(deleteTarget.installedSize) : ''}</span>
          </div>
        </div>
        {deleteTarget && !deleteTarget.external ? (
          <label className="checkbox-row">
            <input type="checkbox" checked={deleteFiles} onChange={(event) => setDeleteFiles(event.target.checked)} />
            <span className="fake-checkbox" />
            <div>
              <strong>同时删除实例目录</strong>
              <span>模组、存档、配置和日志将无法恢复。</span>
            </div>
          </label>
        ) : (
          <div className="inline-warning subtle">这是外部导入的实例。矿港不会删除它的游戏目录，只会移除版本库中的记录。</div>
        )}
        <div className="inline-warning danger">
          共享的版本核心、资源和运行库不会被删除，以免影响其它实例。
        </div>
        <div className="modal-actions">
          <button className="button ghost" type="button" onClick={() => setDeleteTarget(null)}>取消</button>
          <button className="button danger" type="button" disabled={deleting} onClick={() => void handleDelete()}>
            {deleting ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
            确认删除
          </button>
        </div>
      </Modal>
    </div>
  )
}