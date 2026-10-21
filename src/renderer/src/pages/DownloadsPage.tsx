import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  Cpu,
  Download,
  DownloadCloud,
  Gamepad2,
  Globe2,
  Gauge,
  Layers3,
  Loader2,
  Package,
  Puzzle,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
  Zap
} from 'lucide-react'
import type {
  DownloadSource,
  ModrinthSearchHit,
  VersionCatalog
} from '../../../shared/types'
import { useLauncher, type DownloadTab } from '../lib/launcher-context'
import { api, formatDate, formatNumber, friendlyError } from '../lib/api'
import { LOADER_META, VERSION_TYPE_LABELS } from '../lib/constants'
import { InstallGameModal } from '../components/InstallGameModal'
import { ProjectVersionsModal } from '../components/ProjectVersionsModal'
import { LoaderBadge } from '../components/LoaderBadge'

const TABS: Array<{ id: DownloadTab; label: string; hint: string; icon: typeof Gamepad2 }> = [
  { id: 'game', label: '游戏本体', hint: 'VANILLA', icon: Gamepad2 },
  { id: 'modpack', label: '整合包', hint: 'MODPACKS', icon: Package },
  { id: 'mod', label: '模组', hint: 'MODS', icon: Puzzle },
  { id: 'shader', label: '光影', hint: 'SHADERS', icon: Sparkles }
]

const MODRINTH_TYPE: Record<Exclude<DownloadTab, 'game'>, 'modpack' | 'mod' | 'shader'> = {
  modpack: 'modpack',
  mod: 'mod',
  shader: 'shader'
}

const SOURCES: Array<{ id: DownloadSource; icon: typeof Gauge; short: string }> = [
  { id: 'auto', icon: Gauge, short: '自动' },
  { id: 'official', icon: Globe2, short: '官方' },
  { id: 'bmclapi', icon: Zap, short: 'BMCLAPI' }
]

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function DownloadsPage() {
  const {
    downloadTab,
    navigate,
    config,
    updateConfig,
    selectedInstance,
    instances,
    selectInstance,
    java,
    pushToast
  } = useLauncher()
  const [catalog, setCatalog] = useState<VersionCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [versionQuery, setVersionQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'release' | 'snapshot'>('release')
  const [installVersion, setInstallVersion] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [sort, setSort] = useState<'relevance' | 'downloads' | 'newest'>('relevance')
  const [results, setResults] = useState<ModrinthSearchHit[]>([])
  const [resultTotal, setResultTotal] = useState(0)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchNonce, setSearchNonce] = useState(0)
  const [projectModal, setProjectModal] = useState<{ id: string; mode: 'mod' | 'shader' | 'modpack' } | null>(null)
  const [importing, setImporting] = useState(false)
  const searchSeq = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setQuery('')
    setDebouncedQuery('')
    setResults([])
    setResultTotal(0)
  }, [downloadTab])

  const loadCatalog = async (force = false) => {
    setCatalogLoading(true)
    setCatalogError('')
    try {
      const data = await api.versions.catalog(force)
      setCatalog(data)
    } catch (error) {
      setCatalogError(friendlyError(error))
    } finally {
      setCatalogLoading(false)
    }
  }

  useEffect(() => {
    if (downloadTab === 'game' && !catalog && !catalogLoading) void loadCatalog(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadTab, config.downloadSource])

  useEffect(() => {
    if (downloadTab === 'game') return
    const seq = ++searchSeq.current
    setSearchLoading(true)
    setSearchError('')
    const mode = downloadTab as Exclude<DownloadTab, 'game'>
    const request = {
      query: debouncedQuery,
      type: MODRINTH_TYPE[mode],
      sort,
      limit: 24,
      mcVersion: mode === 'modpack' ? undefined : selectedInstance?.mcVersion,
      loader: mode === 'mod' ? selectedInstance?.loader : undefined
    }
    api.modrinth
      .search(request)
      .then((result) => {
        if (seq !== searchSeq.current) return
        setResults(result.hits)
        setResultTotal(result.total_hits)
      })
      .catch((error) => {
        if (seq !== searchSeq.current) return
        setSearchError(friendlyError(error))
        setResults([])
      })
      .finally(() => {
        if (seq === searchSeq.current) setSearchLoading(false)
      })
  }, [downloadTab, debouncedQuery, sort, selectedInstance?.id, selectedInstance?.mcVersion, selectedInstance?.loader, searchNonce])

  const filteredVersions = useMemo(() => {
    if (!catalog) return []
    const search = versionQuery.trim().toLowerCase()
    return catalog.versions
      .filter((version) => {
        if (typeFilter === 'release' && version.type !== 'release') return false
        if (typeFilter === 'snapshot' && version.type !== 'snapshot') return false
        if (!search) return true
        return version.id.toLowerCase().includes(search)
      })
      .slice(0, 120)
  }, [catalog, versionQuery, typeFilter])

  const latest = catalog?.versions.find((version) => version.id === catalog.latest.release) ?? catalog?.versions[0]

  const changeSource = async (source: DownloadSource) => {
    try {
      await updateConfig({ downloadSource: source })
      await loadCatalog(true)
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    }
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      const submission = await api.modrinth.importModpack()
      if (submission) pushToast('本地整合包已加入安装队列', 'success')
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="page downloads-page">
      <header className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dash" /> DISCOVER</div>
          <h1>资源下载<span className="accent-dot">.</span></h1>
          <p>原版游戏、加载器、整合包和模组，一个地方都准备好。</p>
        </div>
        <div className="page-actions">
          {downloadTab === 'modpack' ? (
            <button className="button ghost" type="button" onClick={() => void handleImport()} disabled={importing}>
              {importing ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} 导入本地整合包
            </button>
          ) : null}
          <button className="button ghost" type="button" onClick={() => void loadCatalog(true)} disabled={catalogLoading}>
            <RefreshCw size={15} className={catalogLoading ? 'spin' : ''} /> 刷新版本清单
          </button>
        </div>
      </header>

      <nav className="download-tabs">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              data-download-tab={tab.id}
              className={downloadTab === tab.id ? 'active' : ''}
              onClick={() => navigate('downloads', { tab: tab.id })}
            >
              <span className="download-tab-icon"><Icon size={17} /></span>
              <span>
                <strong>{tab.label}</strong>
                <em>{tab.hint}</em>
              </span>
            </button>
          )
        })}
      </nav>

      {downloadTab === 'game' ? (
        <div className="game-download-layout">
          <div className="game-main">
            {catalogLoading && !catalog ? (
              <div className="download-loading-card">
                <Loader2 size={24} className="spin" />
                <strong>正在获取版本清单…</strong>
                <span>通常会从所选镜像源读取 Mojang 的版本列表</span>
              </div>
            ) : catalogError && !catalog ? (
              <div className="download-error-card">
                <Globe2 size={26} />
                <strong>版本清单加载失败</strong>
                <span>{catalogError}</span>
                <button className="button ghost small" type="button" onClick={() => void loadCatalog(true)}>
                  <RefreshCw size={14} /> 重试
                </button>
              </div>
            ) : (
              <>
                {latest ? (
                  <div className="game-latest-card">
                    <div className="game-latest-copy">
                      <span className="game-latest-eyebrow">LATEST RELEASE · {catalog?.sourceUsed === 'bmclapi' ? 'BMCLAPI' : 'MOJANG'}</span>
                      <h2>{latest.id}</h2>
                      <p>Minecraft Java Edition 最新正式版，带来新的世界生成、机制与修复。</p>
                      <div className="game-latest-actions">
                        <button className="button primary" data-open-install type="button" onClick={() => setInstallVersion(latest.id)}>
                          <Download size={16} /> 安装这个版本
                        </button>
                        <button className="button ghost" type="button" onClick={() => navigate('versions')}>
                          查看版本库 <ArrowUpRight size={14} />
                        </button>
                      </div>
                      <span className="game-latest-date">发布于 {formatDate(latest.releaseTime)}</span>
                    </div>
                    <div className="game-latest-art">
                      <span className="latest-grid" />
                      <div className="latest-cube"><i /><i /><i /><i /></div>
                      <span className="latest-label">JAVA EDITION</span>
                    </div>
                  </div>
                ) : null}

                <div className="version-panel">
                  <div className="version-panel-head">
                    <div>
                      <h3>全部游戏版本</h3>
                      <p>共 {catalog?.versions.length ?? 0} 个版本 · 展示前 120 个结果</p>
                    </div>
                    <div className="version-panel-controls">
                      <div className="search-box compact">
                        <Search size={14} />
                        <input placeholder="搜索版本号…" value={versionQuery} onChange={(event) => setVersionQuery(event.target.value)} />
                      </div>
                      <div className="filter-pills">
                        {(['release', 'snapshot', 'all'] as const).map((filter) => (
                          <button
                            key={filter}
                            type="button"
                            className={typeFilter === filter ? 'active' : ''}
                            onClick={() => setTypeFilter(filter)}
                          >
                            {filter === 'release' ? '正式版' : filter === 'snapshot' ? '快照' : '全部'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="version-table">
                    <div className="version-table-head">
                      <span>版本</span><span>类型</span><span>发布时间</span><span />
                    </div>
                    {filteredVersions.length ? (
                      filteredVersions.map((version) => (
                        <div className="version-table-row" key={version.id}>
                          <span className="version-id-cell">
                            <span className={cx('version-type-dot', version.type)} />
                            <strong>{version.id}</strong>
                            {version.id === catalog?.latest.release ? <em>最新</em> : null}
                          </span>
                          <span><span className={cx('type-chip', 'type-' + version.type)}>{VERSION_TYPE_LABELS[version.type] ?? version.type}</span></span>
                          <span className="version-date">{formatDate(version.releaseTime)}</span>
                          <span className="version-install-cell">
                            <button className="button tiny primary-soft" type="button" onClick={() => setInstallVersion(version.id)}>
                              <Download size={12} /> 安装
                            </button>
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="version-table-empty">没有符合筛选条件的版本，换个关键词试试。</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <aside className="download-aside">
            <div className="aside-card source-card">
              <div className="aside-card-title">
                <span className="aside-icon"><Zap size={16} /></span>
                <div><strong>下载源</strong><em>Source</em></div>
              </div>
              <div className="source-list">
                {SOURCES.map((source) => {
                  const Icon = source.icon
                  return (
                    <button
                      key={source.id}
                      type="button"
                      className={config.downloadSource === source.id ? 'active' : ''}
                      onClick={() => void changeSource(source.id)}
                    >
                      <span><Icon size={14} /> {source.short}</span>
                      <em>{source.id === 'auto' ? '国内优先，自动回退' : source.id === 'official' ? 'Mojang 官方 CDN' : '国内加速镜像'}</em>
                      {config.downloadSource === source.id ? <span className="selected-ring" /> : null}
                    </button>
                  )
                })}
              </div>
              <p className="aside-note">切换下载源后会自动重新获取版本清单。</p>
            </div>

            <div className="aside-card guide-card">
              <div className="aside-card-title">
                <span className="aside-icon"><Layers3 size={16} /></span>
                <div><strong>安装流程</strong><em>How it works</em></div>
              </div>
              <ol className="install-steps">
                <li><span>01</span><div><strong>选择版本</strong><em>正式版或任意快照</em></div></li>
                <li><span>02</span><div><strong>挑选加载器</strong><em>Fabric / Forge / NeoForge</em></div></li>
                <li><span>03</span><div><strong>自动完成</strong><em>资源、运行库与 Java 检查</em></div></li>
              </ol>
              <div className="java-mini-status">
                <Cpu size={14} />
                <span>{java.length ? '已发现 ' + java.length + ' 个 Java 运行时' : '尚未发现 Java 运行时'}</span>
                <button type="button" onClick={() => navigate('java')}>管理</button>
              </div>
            </div>

            <div className="aside-card source-notice">
              <span className="notice-glow" />
              <DownloadCloud size={20} />
              <strong>为国内网络优化</strong>
              <p>BMCLAPI 镜像提供与原版一致的下载文件，并支持 Fabric、Forge 与 NeoForge 安装所需资源。</p>
              <span className="notice-meta">自动源会优先尝试国内镜像</span>
            </div>
          </aside>
        </div>
      ) : (
        <div className="modrinth-browser">
          <div className="browser-toolbar">
            <div className="search-box browser-search">
              <Search size={16} />
              <input
                placeholder={
                  downloadTab === 'modpack'
                    ? '搜索整合包，例如「better mc」「atm」…'
                    : downloadTab === 'mod'
                      ? '搜索模组，例如「sodium」「jei」…'
                      : '搜索光影，例如「complementary」「bsl」…'
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? <button type="button" onClick={() => setQuery('')} className="clear-search">清空</button> : null}
            </div>
            {downloadTab === 'mod' || downloadTab === 'shader' ? (
              <div className="target-instance-select">
                <span>目标实例</span>
                {instances.length ? (
                  <div className="select-wrap">
                    <select
                      value={selectedInstance?.id ?? ''}
                      onChange={(event) => selectInstance(event.target.value)}
                    >
                      {instances.map((instance) => (
                        <option key={instance.id} value={instance.id}>
                          {instance.name} · MC {instance.mcVersion}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} />
                  </div>
                ) : (
                  <button className="link-button" type="button" onClick={() => navigate('downloads', { tab: 'game' })}>先安装一个实例</button>
                )}
              </div>
            ) : null}
            <div className="sort-select">
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="relevance">相关性</option>
                <option value="downloads">下载量</option>
                <option value="newest">最新发布</option>
              </select>
              <ChevronDown size={13} />
            </div>
            {downloadTab === 'modpack' ? (
              <button className="button ghost small import-inline" type="button" onClick={() => void handleImport()} disabled={importing}>
                {importing ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} 本地导入
              </button>
            ) : null}
          </div>

          <div className="browser-context-line">
            <span className="browser-source"><span className="status-dot" /> 数据来自 Modrinth</span>
            {downloadTab !== 'modpack' && selectedInstance ? (
              <span>
                仅显示兼容 <LoaderBadge loader={selectedInstance.loader} compact /> · MC {selectedInstance.mcVersion} 的版本
              </span>
            ) : downloadTab === 'modpack' ? (
              <span>整合包会自动创建独立实例，不影响现有版本</span>
            ) : (
              <span>先在版本库中创建一个实例，才能安装模组与光影</span>
            )}
            <strong>{resultTotal ? formatNumber(resultTotal) + ' 个结果' : ''}</strong>
          </div>

          {searchLoading ? (
            <div className="browser-grid">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="browser-card skeleton" key={index}>
                  <div className="skeleton-icon" />
                  <div className="skeleton-lines"><span /><span /><span /></div>
                </div>
              ))}
            </div>
          ) : searchError ? (
            <div className="browser-error">
              <Globe2 size={26} />
              <strong>没有连上 Modrinth</strong>
              <span>{searchError}</span>
              <button className="button ghost small" type="button" onClick={() => setSearchNonce((value) => value + 1)}>重试</button>
            </div>
          ) : results.length === 0 ? (
            <div className="browser-empty">
              <Search size={26} />
              <strong>{debouncedQuery ? '没有找到相关项目' : '这里还没有内容'}</strong>
              <span>{debouncedQuery ? '试试更短的关键词，或者换一个下载分类。' : '换一个关键词开始探索。'}</span>
            </div>
          ) : (
            <>
              <div className="browser-grid">
                {results.map((hit) => (
                  <ProjectCard
                    key={hit.project_id}
                    hit={hit}
                    mode={MODRINTH_TYPE[downloadTab as Exclude<DownloadTab, 'game'>]}
                    onInstall={() =>
                      setProjectModal({
                        id: hit.project_id,
                        mode: MODRINTH_TYPE[downloadTab as Exclude<DownloadTab, 'game'>]
                      })
                    }
                  />
                ))}
              </div>
              <div className="browser-footer">
                <span>只展示前 {results.length} 个结果</span>
                <button className="text-button" type="button" onClick={() => void api.shell.openExternal('https://modrinth.com')}>
                  在 Modrinth 浏览全部 <ArrowUpRight size={13} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <InstallGameModal open={Boolean(installVersion)} mcVersion={installVersion} onClose={() => setInstallVersion(null)} />
      <ProjectVersionsModal
        open={Boolean(projectModal)}
        projectId={projectModal?.id ?? null}
        mode={projectModal?.mode ?? 'mod'}
        onClose={() => setProjectModal(null)}
      />
    </div>
  )
}

function ProjectCard({
  hit,
  mode,
  onInstall
}: {
  hit: ModrinthSearchHit
  mode: 'mod' | 'shader' | 'modpack'
  onInstall: () => void
}) {
  const tags = (hit.display_categories?.length ? hit.display_categories : hit.categories).slice(0, 3)
  return (
    <article className="browser-card">
      <div className="browser-card-icon">
        {hit.icon_url ? <img src={hit.icon_url} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <Package size={26} />}
      </div>
      <div className="browser-card-top">
        <div>
          <h3>{hit.title}</h3>
          <span className="browser-author">{hit.author ? 'by ' + hit.author : 'Modrinth 项目'}</span>
        </div>
        <button className="card-install-button" type="button" onClick={onInstall}>
          <Download size={14} /> 安装
        </button>
      </div>
      <p>{hit.description}</p>
      <div className="browser-tags">
        {tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <div className="browser-card-footer">
        <span><Download size={13} /> {formatNumber(hit.downloads)}</span>
        <span className="browser-loaders">
          {(hit.display_categories ?? []).filter((tag) => ['fabric', 'forge', 'neoforge', 'quilt'].includes(tag)).map((tag) => (
            <span key={tag} className={'loader-dot dot-' + tag}>{LOADER_META[tag as keyof typeof LOADER_META]?.name ?? tag}</span>
          ))}
        </span>
        <span className="updated">{formatDate(hit.date_modified)}</span>
      </div>
    </article>
  )
}