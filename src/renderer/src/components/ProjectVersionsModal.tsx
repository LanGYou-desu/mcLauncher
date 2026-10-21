import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  CircleAlert,
  Download,
  ExternalLink,
  FileArchive,
  Loader2,
  Package,
  PackagePlus,
  RefreshCw,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import type {
  InstanceSummary,
  ModrinthProject,
  ModrinthVersion
} from '../../../shared/types'
import { Modal, ModalClose } from './Modal'
import { useLauncher } from '../lib/launcher-context'
import { api, formatBytes, formatDate, formatNumber, friendlyError } from '../lib/api'
import { LOADER_META } from '../lib/constants'

export type ProjectMode = 'mod' | 'shader' | 'modpack'

const MODE_LABEL: Record<ProjectMode, string> = {
  mod: '模组',
  shader: '光影',
  modpack: '整合包'
}

const MODE_ACTION: Record<ProjectMode, string> = {
  mod: '安装模组',
  shader: '安装光影',
  modpack: '安装整合包'
}

function contentKind(mode: Exclude<ProjectMode, 'modpack'>): 'mod' | 'shader' {
  return mode
}

function hasUsableFile(version: ModrinthVersion, mode: ProjectMode): boolean {
  return version.files.some((file) => {
    const name = file.filename.toLowerCase()
    if (mode === 'modpack') return name.endsWith('.mrpack')
    if (mode === 'mod') return name.endsWith('.jar') || name.endsWith('.zip')
    return name.endsWith('.zip')
  })
}

function supportsLoader(version: ModrinthVersion): boolean {
  if (!version.loaders?.length) return true
  return version.loaders.some((loader) => ['fabric', 'forge', 'neoforge'].includes(loader))
}

function isCompatible(version: ModrinthVersion, mode: ProjectMode, instance: InstanceSummary | null): boolean {
  if (!hasUsableFile(version, mode)) return false
  if (mode === 'modpack') return supportsLoader(version)
  if (!instance) return false
  if (!version.game_versions?.includes(instance.mcVersion)) return false
  if (mode === 'mod' && instance.loader !== 'vanilla' && !version.loaders?.includes(instance.loader)) return false
  return true
}

export function ProjectVersionsModal({
  open,
  projectId,
  mode,
  onClose
}: {
  open: boolean
  projectId: string | null
  mode: ProjectMode
  onClose: () => void
}) {
  const { selectedInstance, pushToast } = useLauncher()
  const [project, setProject] = useState<ModrinthProject | null>(null)
  const [versions, setVersions] = useState<ModrinthVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installDependencies, setInstallDependencies] = useState(true)
  const [showAllVersions, setShowAllVersions] = useState(false)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    setError('')
    try {
      const [projectData, versionData] = await Promise.all([
        api.modrinth.project(projectId),
        api.modrinth.versions(projectId)
      ])
      setProject(projectData)
      setVersions(versionData)
      const usable = versionData.filter((version) => isCompatible(version, mode, selectedInstance))
      const preferred = usable.find((version) => !version.version_type || version.version_type === 'release') ?? usable[0]
      setSelectedId(preferred?.id ?? '')
    } catch (loadError) {
      setError(friendlyError(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !projectId) return
    setProject(null)
    setVersions([])
    setSelectedId('')
    setShowAllVersions(false)
    void load()
    // selectedInstance intentionally captured on open; instance can be switched after closing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, mode])

  const compatibleVersions = useMemo(
    () => versions.filter((version) => isCompatible(version, mode, selectedInstance)),
    [versions, mode, selectedInstance]
  )
  const displayedVersions = showAllVersions ? versions.filter((version) => hasUsableFile(version, mode)) : compatibleVersions
  const selected = versions.find((version) => version.id === selectedId) ?? null
  const selectedFile = selected
    ? selected.files.find((file) => file.primary) ?? selected.files.find((file) => hasUsableFile(selected, mode))
    : null
  const actionDisabled = installing || !selected || (mode !== 'modpack' && !selectedInstance) || (mode !== 'modpack' && !compatibleVersions.some((version) => version.id === selected.id))

  const install = async () => {
    if (!selected) return
    if (mode !== 'modpack' && !selectedInstance) {
      pushToast('请先选择一个游戏实例', 'error')
      return
    }
    setInstalling(true)
    try {
      if (mode === 'modpack') {
        await api.modrinth.installModpack({
          projectId: selected.project_id,
          versionId: selected.id,
          name: project?.title
        })
        pushToast('整合包已加入安装队列', 'success')
      } else {
        await api.modrinth.installContent({
          instanceId: selectedInstance!.id,
          projectId: selected.project_id,
          versionId: selected.id,
          kind: contentKind(mode),
          installDependencies
        })
        pushToast(MODE_LABEL[mode] + '已加入安装队列', 'success')
      }
      onClose()
    } catch (installError) {
      pushToast(friendlyError(installError), 'error')
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="project-modal">
      <div className="project-modal-top">
        <button
          className="project-cover-large"
          type="button"
          onClick={() => {
            if (project) void api.shell.openExternal('https://modrinth.com/' + project.project_type + '/' + project.slug)
          }}
          title="在 Modrinth 上打开"
        >
          {project?.icon_url ? (
            <img src={project.icon_url} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} />
          ) : (
            <Package size={30} />
          )}
        </button>
        <div className="project-modal-heading">
          <div className="eyebrow">{MODE_LABEL[mode].toUpperCase()} · MODRINTH</div>
          <h2>{loading && !project ? '正在读取项目…' : project?.title ?? '资源详情'}</h2>
          <p>{project?.description ?? '从 Modrinth 获取最新版本。'}</p>
          {project ? (
            <div className="project-heading-meta">
              <span><Download size={13} /> {formatNumber(project.downloads)}</span>
              <span><Sparkles size={13} /> {formatNumber(project.followers)} 关注</span>
              {project.license?.name ? <span><ShieldCheck size={13} /> {project.license.name}</span> : null}
              <span>{formatDate(project.updated)} 更新</span>
            </div>
          ) : null}
        </div>
        <div className="project-modal-actions">
          <button
            className="button ghost small"
            type="button"
            onClick={() => {
              if (project) void api.shell.openExternal('https://modrinth.com/' + project.project_type + '/' + project.slug)
            }}
            disabled={!project}
          >
            <ExternalLink size={13} /> Modrinth
          </button>
          <ModalClose onClose={onClose} />
        </div>
      </div>

      {loading ? (
        <div className="project-loading">
          <div className="scan-radar small"><span /><span /><Loader2 size={22} className="spin" /></div>
          <strong>正在整理版本信息…</strong>
          <span>只展示与你的实例兼容的文件</span>
        </div>
      ) : error ? (
        <div className="project-error">
          <CircleAlert size={22} />
          <strong>加载失败</strong>
          <span>{error}</span>
          <button className="button ghost small" type="button" onClick={() => void load()}><RefreshCw size={14} /> 重试</button>
        </div>
      ) : (
        <div className="project-modal-body">
          <aside className="version-rail">
            <div className="version-rail-head">
              <span>选择版本</span>
              <em>{compatibleVersions.length} {mode === 'modpack' ? '个可安装' : '个兼容'}</em>
            </div>
            {displayedVersions.length ? (
              <div className="version-list">
                {displayedVersions.map((version) => {
                  const compatible = isCompatible(version, mode, selectedInstance)
                  return (
                    <button
                      key={version.id}
                      type="button"
                      className={`version-list-item ${selected?.id === version.id ? 'selected' : ''}`}
                      onClick={() => setSelectedId(version.id)}
                    >
                      <span className="version-item-top">
                        <strong>{version.version_number}</strong>
                        {version.version_type ? <span className={`version-channel channel-${version.version_type}`}>{version.version_type}</span> : null}
                      </span>
                      <span className="version-item-name">{version.name}</span>
                      <span className="version-item-meta">
                        {version.game_versions.slice(0, 2).join(', ')}
                        {version.game_versions.length > 2 ? ' +' + (version.game_versions.length - 2) : ''}
                        <span>·</span>
                        {version.loaders.map((loader) => loader.toUpperCase()).join(' / ')}
                      </span>
                      {!compatible ? <span className="version-incompatible">与当前实例不兼容</span> : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="version-rail-empty">
                <Package size={21} />
                <strong>没有兼容版本</strong>
                <span>{mode === 'modpack' ? '该整合包没有可安装的发布文件。' : '该资源没有适配当前实例的版本。'}</span>
              </div>
            )}
            <button className="show-all-toggle" type="button" onClick={() => setShowAllVersions((value) => !value)}>
              {showAllVersions ? '只看兼容版本' : '显示所有版本'}
              <ChevronDown size={13} className={showAllVersions ? 'rotated' : ''} />
            </button>
          </aside>

          <div className="version-detail">
            {selected ? (
              <>
                <div className="version-detail-head">
                  <div>
                    <div className="eyebrow">SELECTED VERSION</div>
                    <h3>{selected.version_number}</h3>
                    <p>{selected.name}</p>
                  </div>
                  {mode === 'modpack' ? (
                    <span className="compat-ok"><ShieldCheck size={13} /> 可安装</span>
                  ) : !compatibleVersions.some((version) => version.id === selected.id) ? (
                    <span className="compat-warning"><CircleAlert size={13} /> 与当前实例不兼容</span>
                  ) : (
                    <span className="compat-ok"><ShieldCheck size={13} /> 兼容当前实例</span>
                  )}
                </div>

                <div className="version-kv">
                  <div><span>游戏版本</span><strong>{selected.game_versions.length > 4 ? selected.game_versions.slice(0, 4).join(', ') + ' +' : selected.game_versions.join(', ')}</strong></div>
                  <div><span>支持加载器</span><strong>{selected.loaders.map((loader) => LOADER_META[loader as keyof typeof LOADER_META]?.name ?? loader).join(' / ') || '原版'}</strong></div>
                  <div><span>发布日期</span><strong>{formatDate(selected.date_published)}</strong></div>
                  <div><span>下载文件</span><strong>{selectedFile ? formatBytes(selectedFile.size) : '—'}</strong></div>
                </div>

                {selectedFile ? (
                  <div className="file-card">
                    <span className="file-icon"><FileArchive size={18} /></span>
                    <div>
                      <strong>{selectedFile.filename}</strong>
                      <span>{selectedFile.hashes?.sha1 ? 'SHA1 ' + selectedFile.hashes.sha1.slice(0, 16) + '…' : 'Modrinth CDN'}</span>
                    </div>
                    <span className="file-ready">已校验</span>
                  </div>
                ) : null}

                {mode === 'mod' ? (
                  <div className="dependency-row">
                    <div>
                      <strong><PackagePlus size={15} /> 必需依赖</strong>
                      <span>
                        {selected.dependencies.filter((dependency) => dependency.dependency_type === 'required').length
                          ? '该模组声明了 ' + selected.dependencies.filter((dependency) => dependency.dependency_type === 'required').length + ' 个必需依赖'
                          : '没有额外必需依赖'}
                      </span>
                    </div>
                    <label className="switch-label">
                      <input type="checkbox" checked={installDependencies} onChange={(event) => setInstallDependencies(event.target.checked)} />
                      <span className="switch" />
                      <em>自动安装</em>
                    </label>
                  </div>
                ) : null}

                {mode === 'modpack' ? (
                  <div className="modpack-instance-warning">
                    <PackagePlus size={15} />
                    <div>
                      <strong>将创建一个新的游戏实例</strong>
                      <span>整合包包含的加载器、模组和配置会自动安装到独立目录。</span>
                    </div>
                  </div>
                ) : (
                  <div className="target-instance-line">
                    <span>安装到</span>
                    <strong>{selectedInstance ? selectedInstance.name : '尚未选择实例'}</strong>
                    {selectedInstance ? <em>MC {selectedInstance.mcVersion} · {LOADER_META[selectedInstance.loader].name}</em> : null}
                  </div>
                )}

                {selected.changelog ? (
                  <div className="changelog-preview">
                    <span>更新说明</span>
                    <p>{selected.changelog.replace(/[#*_`>-]/g, '').replace(/\n+/g, ' ').slice(0, 260)}</p>
                  </div>
                ) : null}

                <div className="project-install-footer">
                  <div className="install-meta-note">
                    <ShieldCheck size={14} />
                    <span>文件完整性校验 · Modrinth CDN</span>
                  </div>
                  <button className="button primary" type="button" disabled={actionDisabled} onClick={() => void install()}>
                    {installing ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                    {installing ? '正在提交…' : MODE_ACTION[mode]}
                  </button>
                </div>
              </>
            ) : (
              <div className="version-detail-empty">
                <Package size={28} />
                <strong>选择一个版本</strong>
                <span>从左侧选择要安装的版本，然后查看详细信息。</span>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}