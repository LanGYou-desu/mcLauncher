import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  Check,
  FolderPlus,
  Loader2,
  RefreshCw,
  ScanSearch,
  TriangleAlert
} from 'lucide-react'
import type { DiscoveredMinecraftVersion, MinecraftScanResult } from '../../../shared/types'
import { useLauncher } from '../lib/launcher-context'
import { api, formatRelativeTime, friendlyError } from '../lib/api'
import { LoaderBadge } from './LoaderBadge'

function versionMark(mcVersion: string): string {
  const cleaned = mcVersion.replace(/[^0-9.]/g, '')
  const parts = cleaned.split('.').filter(Boolean)
  if (parts[0] === '1' && parts[1]) return parts[1].slice(0, 2)
  return parts[0]?.slice(0, 2) ?? '?'
}

function versionKey(version: Pick<DiscoveredMinecraftVersion, 'root' | 'versionId'>): string {
  return version.root + '|' + version.versionId
}

export function ScanMinecraftPanel({ onImported }: { onImported?: (instanceId: string) => void }) {
  const { config, pushToast, refreshInstances } = useLauncher()
  const [scan, setScan] = useState<MinecraftScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [importingKey, setImportingKey] = useState<string | null>(null)
  const [bulkImporting, setBulkImporting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const importable = useMemo(
    () => (scan?.versions ?? []).filter((version) => !version.imported),
    [scan]
  )

  const scanNow = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setScan(await api.minecraft.scan())
    } catch (scanError) {
      setError(friendlyError(scanError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void scanNow()
  }, [scanNow])

  useEffect(() => {
    const valid = new Set(importable.map(versionKey))
    setSelected((prev) => {
      const next = new Set([...prev].filter((key) => valid.has(key)))
      return next.size === prev.size ? prev : next
    })
  }, [importable])

  const addRoot = async () => {
    setAdding(true)
    try {
      const result = await api.minecraft.addRoot()
      if (result) {
        setScan(result)
        pushToast('版本目录已添加', 'success')
      }
    } catch (addError) {
      pushToast(friendlyError(addError), 'error')
    } finally {
      setAdding(false)
    }
  }

  const toggleSelected = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === importable.length) setSelected(new Set())
    else setSelected(new Set(importable.map(versionKey)))
  }

  const importVersion = async (version: DiscoveredMinecraftVersion) => {
    const key = versionKey(version)
    setImportingKey(key)
    try {
      const instance = await api.minecraft.importVersion(version.root, version.versionId)
      await refreshInstances()
      setScan((prev) =>
        prev
          ? {
              ...prev,
              versions: prev.versions.map((item) =>
                versionKey(item) === key
                  ? { ...item, imported: true, instanceName: instance.name }
                  : item
              )
            }
          : prev
      )
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      pushToast('已导入「' + instance.name + '」', 'success')
      onImported?.(instance.id)
    } catch (importError) {
      pushToast(friendlyError(importError), 'error')
    } finally {
      setImportingKey(null)
    }
  }

  const importSelected = async () => {
    const versions = importable.filter((version) => selected.has(versionKey(version)))
    if (!versions.length || bulkImporting) return
    setBulkImporting(true)
    setError('')
    try {
      const result = await api.minecraft.importVersions(
        versions.map((version) => ({ root: version.root, versionId: version.versionId }))
      )
      await refreshInstances()
      await scanNow()
      setSelected(new Set())
      if (result.failed.length) {
        pushToast(
          '已导入 ' + result.instances.length + ' 个，' + result.failed.length + ' 个失败：' +
            result.failed[0].error,
          'error'
        )
      } else {
        pushToast('已导入 ' + result.instances.length + ' 个实例', 'success')
      }
    } catch (importError) {
      setError(friendlyError(importError))
      pushToast(friendlyError(importError), 'error')
    } finally {
      setBulkImporting(false)
    }
  }

  const rootLabel = (path: string) => scan?.roots.find((root) => root.path === path)?.label ?? '自定义目录'
  const allSelected = importable.length > 0 && selected.size === importable.length
  const busy = bulkImporting || Boolean(importingKey)

  return (
    <div className="scan-panel">
      <div className="scan-toolbar">
        <div className="scan-intro">
          <span className="scan-icon"><ScanSearch size={19} /></span>
          <div>
            <strong>本机 Minecraft</strong>
            <p>扫描 PCL2、官方启动器与自定义目录，可一次选择多个实例导入</p>
          </div>
        </div>
        <div className="scan-actions">
          <button className="button ghost small" type="button" onClick={() => void addRoot()} disabled={adding || busy}>
            {adding ? <Loader2 size={15} className="spin" /> : <FolderPlus size={15} />}
            指定版本目录
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => void scanNow()}
            disabled={loading || bulkImporting}
            title="重新扫描"
            aria-label="重新扫描本机版本"
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error ? <div className="inline-warning"><TriangleAlert size={15} /> {error}</div> : null}

      {loading && !scan ? (
        <div className="scan-loading">
          <div className="scan-radar"><span /><span /><ScanSearch size={24} /></div>
          <strong>正在扫描本机版本…</strong>
          <span>只会读取已知的 Minecraft 目录，不会遍历整个磁盘</span>
        </div>
      ) : scan ? (
        <>
          <div className="scan-root-summary">
            <span className="scan-default-root" title={config.gameRoot}>矿港目录 · {config.gameRoot}</span>
            <div className="scan-root-pills">
              {scan.roots.length ? scan.roots.map((root) => (
                <span key={root.path} className="scan-root-pill" title={root.path}>
                  {root.label} <em>{root.versionCount}</em>
                </span>
              )) : <span className="scan-root-pill muted">未发现其它目录</span>}
            </div>
          </div>

          {scan.versions.length === 0 ? (
            <div className="scan-empty">
              <div className="empty-cube small"><i /><i /><i /><i /></div>
              <strong>没有发现可导入的版本</strong>
              <span>如果游戏安装在其它位置，可以指定 PCL2 根目录、.minecraft 或 versions 文件夹。</span>
              <button className="button ghost small" type="button" onClick={() => void addRoot()}>
                <FolderPlus size={15} /> 指定版本目录
              </button>
            </div>
          ) : (
            <>
              <div className="scan-selection-bar">
                <label className="scan-select-all">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={!importable.length || busy}
                    onChange={toggleAll}
                  />
                  <span>全选可导入</span>
                </label>
                <span className="scan-selection-count">
                  已选 {selected.size} / {importable.length}
                </span>
                <button
                  className="button small primary scan-bulk-import"
                  type="button"
                  disabled={!selected.size || busy}
                  onClick={() => void importSelected()}
                >
                  {bulkImporting ? <Loader2 size={15} className="spin" /> : <ArrowDownToLine size={15} />}
                  {bulkImporting ? '正在导入…' : '导入选中' + (selected.size ? ' (' + selected.size + ')' : '')}
                </button>
              </div>

              <div className="scan-list">
                {scan.versions.map((version) => {
                  const key = versionKey(version)
                  return (
                    <div className={'scan-version-row' + (version.imported ? ' is-imported' : '')} key={key}>
                      <label className="scan-check-target" title={version.imported ? '该版本已导入' : '选择这个实例'}>
                        <input
                          className="scan-checkbox"
                          type="checkbox"
                          checked={selected.has(key)}
                          disabled={version.imported || busy}
                          onChange={(event) => toggleSelected(key, event.target.checked)}
                          aria-label={'选择实例 ' + version.versionId}
                        />
                      </label>
                      <div className={'scan-version-mark mark-' + version.loader}>
                        <span>{versionMark(version.mcVersion)}</span>
                      </div>
                      <div className="scan-version-copy">
                        <strong title={version.versionId}>{version.versionId}</strong>
                        <div>
                          <LoaderBadge loader={version.loader} compact />
                          <span>MC {version.mcVersion}</span>
                          <span title={version.root}>{rootLabel(version.root)}</span>
                          <span>{formatRelativeTime(version.lastModified)}</span>
                        </div>
                      </div>
                      <span className={'scan-jar-state ' + (version.jarExists ? 'ok' : 'bad')}>
                        {version.jarExists ? <Check size={13} /> : <TriangleAlert size={13} />}
                        {version.jarExists ? '完整' : '缺核心'}
                      </span>
                      <div className="scan-row-action">
                        {version.imported ? (
                          <span className="scan-imported" title={version.instanceName ? '已导入为「' + version.instanceName + '」' : '已导入'}>
                            <Check size={13} />
                            <span>{version.instanceName ? '已导入 · ' + version.instanceName : '已导入'}</span>
                          </span>
                        ) : (
                          <button
                            className="button small ghost"
                            type="button"
                            disabled={busy}
                            onClick={() => void importVersion(version)}
                          >
                            {importingKey === key ? <Loader2 size={14} className="spin" /> : <ArrowDownToLine size={14} />}
                            导入
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
          {scan.warnings.length ? (
            <div className="scan-warnings">
              {scan.warnings.slice(0, 3).map((warning) => <span key={warning}>{warning}</span>)}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
