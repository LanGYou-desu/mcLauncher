import { useEffect, useMemo, useState } from 'react'
import {
  Anvil,
  Box,
  ChevronDown,
  DownloadCloud,
  Flame,
  FolderOpen,
  Gauge,
  Globe2,
  HardDrive,
  Loader2,
  Scissors,
  Sparkles,
  Zap
} from 'lucide-react'
import type { DownloadSource, LoaderCatalog, LoaderType } from '../../../shared/types'
import { Modal, ModalHeader } from './Modal'
import { useLauncher } from '../lib/launcher-context'
import { api, formatBytes, friendlyError } from '../lib/api'
import { LOADER_META, SOURCE_LABELS } from '../lib/constants'

const LOADERS: Array<{ id: LoaderType; icon: typeof Box; description: string }> = [
  { id: 'vanilla', icon: Box, description: '纯净原版体验' },
  { id: 'fabric', icon: Scissors, description: '轻量 · 更新快' },
  { id: 'forge', icon: Anvil, description: '经典模组生态' },
  { id: 'neoforge', icon: Flame, description: '新生代 Forge' }
]

const SOURCES: Array<{ id: DownloadSource; icon: typeof Gauge; title: string; hint: string }> = [
  { id: 'auto', icon: Gauge, title: '自动', hint: '国内优先' },
  { id: 'official', icon: Globe2, title: '官方', hint: 'Mojang' },
  { id: 'bmclapi', icon: Zap, title: 'BMCLAPI', hint: '国内镜像' }
]

const EMPTY_CATALOG: LoaderCatalog = { fabric: [], forge: [], neoforge: [], warnings: [], fetchedAt: 0 }

export function InstallGameModal({
  open,
  mcVersion,
  onClose
}: {
  open: boolean
  mcVersion: string | null
  onClose: () => void
}) {
  const { config, system, java, pushToast, navigate, refreshInstances } = useLauncher()
  const [source, setSource] = useState<DownloadSource>(config.downloadSource)
  const [loader, setLoader] = useState<LoaderType>('vanilla')
  const [catalog, setCatalog] = useState<LoaderCatalog>(EMPTY_CATALOG)
  const [loadingLoaders, setLoadingLoaders] = useState(false)
  const [loaderError, setLoaderError] = useState('')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [name, setName] = useState('')
  const [targetRoot, setTargetRoot] = useState(config.gameRoot)
  const [memoryDraft, setMemoryDraft] = useState(String(config.memoryMb))
  const [choosingRoot, setChoosingRoot] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (!open) return
    setSource(config.downloadSource)
    setLoader('vanilla')
    setLoaderVersion('')
    setName('')
    setTargetRoot(config.gameRoot)
    setMemoryDraft(String(config.memoryMb))
    setLoaderError('')
  }, [open, config.downloadSource, config.gameRoot, config.memoryMb, mcVersion])

  useEffect(() => {
    if (!open || !mcVersion) return
    let cancelled = false
    setLoadingLoaders(true)
    setLoaderError('')
    setCatalog(EMPTY_CATALOG)
    setLoaderVersion('')
    api.versions
      .loaders(mcVersion, source)
      .then((result) => {
        if (cancelled) return
        setCatalog(result)
      })
      .catch((error) => {
        if (!cancelled) setLoaderError(friendlyError(error))
      })
      .finally(() => {
        if (!cancelled) setLoadingLoaders(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, mcVersion, source])

  const versions = useMemo(() => {
    if (loader === 'fabric') return catalog.fabric
    if (loader === 'forge') return catalog.forge
    if (loader === 'neoforge') return catalog.neoforge
    return []
  }, [catalog, loader])

  useEffect(() => {
    if (loader === 'vanilla') {
      setLoaderVersion('')
      return
    }
    if (!versions.length) {
      setLoaderVersion('')
      return
    }
    if (!versions.some((version) => version.version === loaderVersion)) {
      setLoaderVersion((versions.find((version) => version.recommended) ?? versions[0]).version)
    }
  }, [loader, versions, loaderVersion])

  if (!mcVersion) return null
  const loaderMeta = LOADER_META[loader]
  const maxMemory = Math.max(2048, Math.min(65536, Math.floor((system.totalMemoryMb * 0.8) / 512) * 512))
  const selectedMemory = (() => {
    const parsed = Number(memoryDraft)
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : config.memoryMb
    return Math.max(512, Math.min(maxMemory, Math.round(value / 512) * 512))
  })()
  const needsJava = loader !== 'vanilla' && java.length === 0
  const selectedVersion = versions.find((version) => version.version === loaderVersion)
  const canInstall = !installing && (loader === 'vanilla' || Boolean(loaderVersion)) && !needsJava

  const chooseTargetRoot = async () => {
    setChoosingRoot(true)
    try {
      const selected = await api.dialog.chooseDirectory(
        '选择版本目录（PCL2、.minecraft 或 versions）',
        targetRoot || config.gameRoot
      )
      if (selected) setTargetRoot(selected)
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setChoosingRoot(false)
    }
  }

  const submit = async () => {
    if (!canInstall) return
    setInstalling(true)
    try {
      await api.versions.install({
        mcVersion,
        loader,
        loaderVersion: loader === 'vanilla' ? undefined : loaderVersion,
        name: name.trim() || undefined,
        source,
        targetRoot: targetRoot.trim() || undefined,
        memoryMb: selectedMemory !== config.memoryMb ? selectedMemory : undefined
      })
      pushToast('安装任务已加入队列', 'success')
      onClose()
      void refreshInstances().catch(() => {})
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="install-modal">
      <ModalHeader
        eyebrow="NEW INSTANCE"
        title={`安装 Minecraft ${mcVersion}`}
        description="选择加载器和下载源，矿港会完成剩下的工作。"
        onClose={onClose}
      />
      <div className="install-summary">
        <div className="install-version-mark">
          <span>MC</span>
          <strong>{mcVersion}</strong>
        </div>
        <div className="install-summary-copy">
          <span>即将创建</span>
          <strong>{name.trim() || mcVersion + ' · ' + LOADER_META[loader].name}</strong>
        </div>
        <span className="install-chip"><HardDrive size={13} /> 实例独立目录</span>
      </div>

      <div className="form-section">
        <div className="form-section-head">
          <span className="step-num">01</span>
          <div><strong>模组加载器</strong><em>选择世界将要运行的底层框架</em></div>
        </div>
        <div className="loader-grid">
          {LOADERS.map((item) => {
            const Icon = item.icon
            const meta = LOADER_META[item.id]
            const count =
              item.id === 'vanilla'
                ? 1
                : item.id === 'fabric'
                  ? catalog.fabric.length
                  : item.id === 'forge'
                    ? catalog.forge.length
                    : catalog.neoforge.length
            return (
              <button
                key={item.id}
                type="button"
                className={`loader-option ${loader === item.id ? 'selected' : ''}`}
                style={{ '--loader-color': meta.color } as React.CSSProperties}
                onClick={() => setLoader(item.id)}
              >
                <span className="loader-option-icon"><Icon size={19} /></span>
                <strong>{meta.name}</strong>
                <em>{loadingLoaders && item.id !== 'vanilla' ? '读取中…' : item.description}</em>
                <span className="loader-option-count">{item.id === 'vanilla' ? '纯净体验' : loadingLoaders ? '' : count ? count + ' 版本' : '暂无'}</span>
                {loader === item.id ? <span className="loader-selected-dot" /> : null}
              </button>
            )
          })}
        </div>
        {loader !== 'vanilla' ? (
          <div className="compact-select-row">
            <label className="field compact-field">
              <span className="field-label">{loaderMeta.name} 版本</span>
              {loadingLoaders ? (
                <div className="select-skeleton"><Loader2 size={14} className="spin" /> 正在获取版本列表…</div>
              ) : versions.length ? (
                <div className="select-wrap">
                  <select value={loaderVersion} onChange={(event) => setLoaderVersion(event.target.value)}>
                    {versions.slice(0, 250).map((version) => (
                      <option key={version.version} value={version.version}>
                        {version.version}{version.recommended ? ' · 推荐' : version.stable ? '' : ' · 测试版'}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              ) : (
                <div className="field-error">{loaderError || '该游戏版本暂无可用加载器版本'}</div>
              )}
            </label>
            <div className="loader-version-note">
              <Sparkles size={14} />
              <span>{selectedVersion?.recommended ? '这是推荐的稳定版本' : '建议选择稳定版本以获得更好的兼容性'}</span>
            </div>
          </div>
        ) : null}
        {loaderError && loader !== 'vanilla' ? <div className="inline-warning">{loaderError}</div> : null}
        {catalog.warnings.length ? <div className="inline-warning subtle">{catalog.warnings[0]}</div> : null}
      </div>

      <div className="form-section two-column-section">
        <div>
          <div className="form-section-head">
            <span className="step-num">02</span>
            <div><strong>实例名称</strong><em>留空则自动命名</em></div>
          </div>
          <label className="field compact-field">
            <input
              className="text-input"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              placeholder={`${mcVersion} ${loaderMeta.name}`}
            />
          </label>
        </div>
        <div>
          <div className="form-section-head">
            <span className="step-num">03</span>
            <div><strong>下载源</strong><em>随时可以在设置中修改</em></div>
          </div>
          <div className="source-switch">
            {SOURCES.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className={source === item.id ? 'active' : ''}
                  onClick={() => setSource(item.id)}
                  title={SOURCE_LABELS[item.id]}
                >
                  <Icon size={14} />
                  <span>{item.title}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="form-section install-target-section">
        <div className="form-section-head">
          <span className="step-num">04</span>
          <div><strong>版本安装目录</strong><em>支持 PCL2、.minecraft 或 versions 目录</em></div>
        </div>
        <div className="install-target-row">
          <div className="install-target-path" title={targetRoot}>{targetRoot}</div>
          <button className="button ghost small" type="button" disabled={choosingRoot} onClick={() => void chooseTargetRoot()}>
            <FolderOpen size={14} /> {choosingRoot ? '选择中…' : '更改目录'}
          </button>
        </div>
        <span className="field-hint">
          默认使用设置中的版本目录。选择 versions 文件夹时，会自动使用它的上一级作为 Minecraft 根目录。
        </span>
      </div>

      <div className="form-section install-memory-section">
        <div className="form-section-head">
          <span className="step-num">05</span>
          <div><strong>游戏内存</strong><em>默认跟随全局设置，也可以为这个实例单独指定</em></div>
        </div>
        <div className="install-memory-row">
          <input
            className="install-memory-input"
            type="number"
            min={512}
            max={maxMemory}
            step={512}
            value={memoryDraft}
            aria-label="新实例游戏内存 MiB"
            onChange={(event) => setMemoryDraft(event.target.value)}
            onBlur={() => setMemoryDraft(String(selectedMemory))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
          <span>MB</span>
          <span className="field-hint">
            全局默认 {(Math.round(config.memoryMb / 1024 * 10) / 10)} GB；当前 {(Math.round(selectedMemory / 1024 * 10) / 10)} GB。
            修改后仅此实例使用独立内存。
          </span>
        </div>
      </div>

      {needsJava ? (
        <div className="inline-warning">
          安装 {loaderMeta.name} 需要可用的 Java。请先在「Java 环境」中扫描或手动添加 Java。
          <button
            type="button"
            onClick={() => {
              onClose()
              navigate('java')
            }}
          >
            前往 Java 环境
          </button>
        </div>
      ) : (
        <div className="install-note">
          <DownloadCloud size={15} />
          <span>{source === 'bmclapi' ? '将通过 BMCLAPI 国内镜像下载游戏文件' : source === 'official' ? '将优先通过 Mojang 官方源下载游戏文件' : '将自动选择可用的最快下载源'}</span>
          <span className="install-note-divider" />
          <span>{config.downloadConcurrency} 线程并发</span>
        </div>
      )}

      <div className="modal-actions install-actions">
        <button className="button ghost" type="button" onClick={onClose}>取消</button>
        <button className="button primary install-confirm" type="button" disabled={!canInstall} onClick={() => void submit()}>
          {installing ? <Loader2 size={16} className="spin" /> : <DownloadCloud size={16} />}
          {installing ? '正在提交…' : '开始安装'}
        </button>
      </div>
    </Modal>
  )
}