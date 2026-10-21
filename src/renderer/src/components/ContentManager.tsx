import { useEffect, useMemo, useState } from 'react'
import {
  Blocks,
  DownloadCloud,
  FileArchive,
  FolderOpen,
  Image,
  Loader2,
  Map,
  Package,
  Plus,
  Puzzle,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type { ContentItem, ContentKind, InstanceContent } from '../../../shared/types'
import { useLauncher } from '../lib/launcher-context'
import { api, formatBytes, formatRelativeTime, friendlyError } from '../lib/api'
import { STAGE_LABELS } from '../lib/constants'
import { Modal, ModalClose } from './Modal'
import { LoaderBadge } from './LoaderBadge'

const TABS: Array<{ id: ContentKind; label: string; icon: typeof Blocks }> = [
  { id: 'mods', label: '模组', icon: Puzzle },
  { id: 'shaderpacks', label: '光影', icon: Sparkles },
  { id: 'resourcepacks', label: '资源包', icon: Image },
  { id: 'saves', label: '存档', icon: Map }
]

const IMPORT_LABEL: Record<ContentKind, string> = {
  mods: '导入模组',
  shaderpacks: '导入光影',
  resourcepacks: '导入资源包',
  saves: '导入存档'
}

const EMPTY_CONTENT: InstanceContent = { mods: [], shaderpacks: [], resourcepacks: [], saves: [] }

export function ContentManager() {
  const {
    contentInstance,
    closeContent,
    contentRefreshToken,
    pushToast,
    navigate,
    selectInstance,
    sessions
  } = useLauncher()
  const [tab, setTab] = useState<ContentKind>('mods')
  const [content, setContent] = useState<InstanceContent>(EMPTY_CONTENT)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [busyFile, setBusyFile] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ContentItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!contentInstance) return
    let cancelled = false
    setLoading(true)
    setError('')
    api.versions
      .content(contentInstance.id)
      .then((next) => {
        if (!cancelled) setContent(next)
      })
      .catch((loadError) => {
        if (!cancelled) setError(friendlyError(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contentInstance?.id, contentRefreshToken, reloadToken])

  useEffect(() => {
    if (!contentInstance) return
    setTab('mods')
    setQuery('')
    setDeleteTarget(null)
  }, [contentInstance?.id])

  const running = contentInstance
    ? sessions.some(
        (session) => session.instanceId === contentInstance.id && ['starting', 'running'].includes(session.status)
      )
    : false

  const items = useMemo(() => {
    const search = query.trim().toLowerCase()
    return content[tab]
      .filter((item) => {
        if (!search) return true
        return (
          item.displayName.toLowerCase().includes(search) ||
          item.fileName.toLowerCase().includes(search) ||
          (item.author ?? '').toLowerCase().includes(search)
        )
      })
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.displayName.localeCompare(b.displayName, 'zh-CN'))
  }, [content, tab, query])

  const importContent = async () => {
    if (!contentInstance) return
    setImporting(true)
    try {
      const result = await api.versions.importContent(contentInstance.id, tab)
      if (result) {
        setContent(result.content)
        pushToast(`已导入 ${result.imported} 个文件${result.skipped ? `，跳过 ${result.skipped} 个` : ''}`, 'success')
      }
    } catch (importError) {
      pushToast(friendlyError(importError), 'error')
    } finally {
      setImporting(false)
    }
  }

  const toggleItem = async (item: ContentItem) => {
    if (!contentInstance) return
    setBusyFile(item.fileName)
    try {
      const next = await api.versions.toggleContent(contentInstance.id, tab, item.fileName)
      setContent(next)
      pushToast(item.enabled ? `已禁用 ${item.displayName}` : `已启用 ${item.displayName}`, 'success')
    } catch (toggleError) {
      pushToast(friendlyError(toggleError), 'error')
    } finally {
      setBusyFile(null)
    }
  }

  const removeItem = async () => {
    if (!contentInstance || !deleteTarget) return
    setDeleting(true)
    try {
      const next = await api.versions.deleteContent(contentInstance.id, tab, deleteTarget.fileName)
      setContent(next)
      pushToast('已删除 ' + deleteTarget.displayName, 'success')
      setDeleteTarget(null)
    } catch (deleteError) {
      pushToast(friendlyError(deleteError), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const goDownload = () => {
    if (!contentInstance) return
    selectInstance(contentInstance.id)
    closeContent()
    navigate('downloads', { tab: 'mod' })
  }

  if (!contentInstance) return null
  const total = content.mods.length + content.shaderpacks.length + content.resourcepacks.length + content.saves.length

  return (
    <Modal open={Boolean(contentInstance)} onClose={closeContent} className="content-modal">
      <header className="content-modal-header">
        <div>
          <div className="eyebrow">INSTANCE CONTENT</div>
          <h2>{contentInstance.name}</h2>
          <div className="content-subline">
            <LoaderBadge loader={contentInstance.loader} version={contentInstance.loaderVersion} />
            <span>MC {contentInstance.mcVersion}</span>
            <span className="content-dot">·</span>
            <span>{total} 个内容文件</span>
            {running ? <span className="content-running"><span className="live-dot" /> 游戏运行中</span> : null}
          </div>
        </div>
        <div className="content-header-actions">
          <button className="button ghost small" type="button" onClick={() => void api.config.revealInstance(contentInstance.id)}>
            <FolderOpen size={14} /> 打开目录
          </button>
          <button className="button primary small" type="button" onClick={goDownload}>
            <DownloadCloud size={14} /> 下载模组
          </button>
          <ModalClose onClose={closeContent} />
        </div>
      </header>

      <div className="content-tabs-row">
        <div className="content-tabs">
          {TABS.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
                <Icon size={15} />
                <span>{item.label}</span>
                <em>{content[item.id].length}</em>
              </button>
            )
          })}
        </div>
        <div className="content-toolbar">
          <div className="search-box compact">
            <Search size={14} />
            <input placeholder="筛选文件…" value={query} onChange={(event) => setQuery(event.target.value)} />
            {query ? <button type="button" onClick={() => setQuery('')}><X size={12} /></button> : null}
          </div>
          <button
            className="button ghost small"
            type="button"
            onClick={() => void api.versions.revealContent(contentInstance.id, tab)}
            title="打开内容文件夹"
          >
            <FolderOpen size={14} />
          </button>
          <button className="button small primary-soft" type="button" onClick={() => void importContent()} disabled={importing}>
            {importing ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            {IMPORT_LABEL[tab]}
          </button>
        </div>
      </div>

      <div className={`content-body ${deleteTarget ? 'has-confirm' : ''}`}>
        {loading ? (
          <div className="content-loading"><Loader2 size={22} className="spin" /><span>正在读取实例内容…</span></div>
        ) : error ? (
          <div className="content-empty">
            <Package size={28} />
            <strong>读取失败</strong>
            <span>{error}</span>
            <button className="button ghost small" type="button" onClick={() => setReloadToken((value) => value + 1)}>刷新</button>
          </div>
        ) : items.length === 0 ? (
          <div className="content-empty">
            <div className="content-empty-icon">
              {tab === 'mods' ? <Puzzle size={27} /> : tab === 'shaderpacks' ? <Sparkles size={27} /> : tab === 'resourcepacks' ? <Image size={27} /> : <Map size={27} />}
            </div>
            <strong>{query ? '没有找到匹配的文件' : `还没有${STAGE_LABELS[tab]}`}</strong>
            <span>
              {query
                ? '试试换一个关键词。'
                : tab === 'mods'
                  ? '从 Modrinth 下载模组，或导入本地的 .jar 文件。'
                  : tab === 'saves'
                    ? '把已有的世界文件夹导入到这个实例。'
                    : `导入本地 .zip ${STAGE_LABELS[tab]}包，或者去下载中心寻找更多。`}
            </span>
            <div className="content-empty-actions">
              {!query ? (
                <button className="button ghost small" type="button" onClick={() => void importContent()}>
                  <Plus size={14} /> {IMPORT_LABEL[tab]}
                </button>
              ) : null}
              {tab === 'mods' ? (
                <button className="button primary-soft small" type="button" onClick={goDownload}>
                  <DownloadCloud size={14} /> 浏览 Modrinth
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className={`content-grid ${tab === 'saves' ? 'saves-grid' : ''}`}>
            {items.map((item) => (
              <div key={item.fileName} className={`content-card ${item.enabled ? '' : 'is-disabled'}`}>
                <div className="content-icon">
                  {item.iconDataUrl ? (
                    <img src={item.iconDataUrl} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} />
                  ) : (
                    <span className={`content-icon-fallback fallback-${tab}`}>
                      {tab === 'mods' ? <Puzzle size={19} /> : tab === 'shaderpacks' ? <Sparkles size={19} /> : tab === 'resourcepacks' ? <Image size={19} /> : <Map size={19} />}
                    </span>
                  )}
                </div>
                <div className="content-copy">
                  <div className="content-title-row">
                    <strong title={item.displayName}>{item.displayName}</strong>
                    {!item.enabled ? <span className="disabled-badge">已禁用</span> : null}
                  </div>
                  <span className="content-filename" title={item.fileName}>
                    {item.version ? 'v' + item.version + ' · ' : ''}
                    {item.author ? item.author + ' · ' : ''}
                    {formatBytes(item.size)}
                  </span>
                  <p>{item.description || item.fileName}</p>
                  <div className="content-item-footer">
                    <span>{formatRelativeTime(item.modified)}</span>
                    <div className="content-item-actions">
                      {tab !== 'saves' ? (
                        <button
                          type="button"
                          className="toggle-button"
                          disabled={busyFile === item.fileName}
                          onClick={() => void toggleItem(item)}
                          title={item.enabled ? '禁用' : '启用'}
                        >
                          <span className={`toggle-track ${item.enabled ? 'on' : ''}`}><span /></span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="icon-button tiny"
                        title="在文件夹中显示"
                        onClick={() => void api.versions.revealContent(contentInstance.id, tab, item.fileName)}
                      >
                        <FolderOpen size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button tiny danger"
                        title="删除"
                        onClick={() => setDeleteTarget(item)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {deleteTarget ? (
          <div className="content-confirm">
            <div className="content-confirm-card">
              <span className="confirm-icon"><Trash2 size={21} /></span>
              <strong>删除「{deleteTarget.displayName}」？</strong>
              <p>此操作会从实例目录中移除文件，无法恢复。</p>
              <span className="confirm-file"><FileArchive size={12} /> {deleteTarget.fileName}</span>
              <div className="confirm-buttons">
                <button className="button ghost small" type="button" onClick={() => setDeleteTarget(null)}>取消</button>
                <button className="button danger small" type="button" disabled={deleting} onClick={() => void removeItem()}>
                  {deleting ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} 确认删除
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="content-modal-footer">
        <span><ShieldLine /> 放入实例目录的文件同样会被矿港识别</span>
        <span>禁用模组会在文件名后添加 .disabled</span>
      </footer>
    </Modal>
  )
}

function ShieldLine() {
  return <span className="shield-line" />
}