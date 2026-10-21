import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Loader2, Save, Trash2 } from 'lucide-react'
import type { InstanceSummary } from '../../../shared/types'
import { Modal, ModalHeader } from './Modal'
import { useLauncher } from '../lib/launcher-context'
import { api, friendlyError } from '../lib/api'

export function InstanceSettingsModal({
  instance,
  open,
  onClose,
  onRequestDelete
}: {
  instance: InstanceSummary | null
  open: boolean
  onClose: () => void
  onRequestDelete?: (instance: InstanceSummary) => void
}) {
  const { java, config, system, pushToast, refreshInstances } = useLauncher()
  const [name, setName] = useState('')
  const [javaMode, setJavaMode] = useState<'auto' | 'custom'>('auto')
  const [javaPath, setJavaPath] = useState('')
  const [memoryMode, setMemoryMode] = useState<'auto' | 'custom'>('auto')
  const [memoryMb, setMemoryMb] = useState(config.memoryMb)
  const [memoryDraft, setMemoryDraft] = useState(String(config.memoryMb))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !instance) return
    setName(instance.name)
    setJavaMode(instance.javaPath ? 'custom' : 'auto')
    setJavaPath(instance.javaPath ?? '')
    setMemoryMode(instance.memoryMb ? 'custom' : 'auto')
    const selectedMemory = instance.memoryMb ?? config.memoryMb
    setMemoryMb(selectedMemory)
    setMemoryDraft(String(selectedMemory))
  }, [open, instance, config.memoryMb])

  const defaultJava = useMemo(
    () => (config.globalJavaPath ? java.find((entry) => entry.path === config.globalJavaPath) : undefined) ?? java[0],
    [config.globalJavaPath, java]
  )

  if (!instance) return null

  const maxInstanceMemory = Math.max(1024, Math.min(65536, Math.floor((system.totalMemoryMb * 0.8) / 512) * 512))
  const normalizeInstanceMemory = (raw: string) => {
    const parsed = Number(raw)
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : memoryMb
    return Math.max(512, Math.min(maxInstanceMemory, Math.round(value / 512) * 512))
  }
  const applyInstanceMemory = (next: number) => {
    const value = Math.max(512, Math.min(maxInstanceMemory, Math.round(next / 512) * 512))
    setMemoryMb(value)
    setMemoryDraft(String(value))
  }

  const save = async () => {
    setSaving(true)
    try {
      const nextMemory = normalizeInstanceMemory(memoryDraft)
      await api.versions.update(instance.id, {
        name: name.trim(),
        javaPath: javaMode === 'custom' ? javaPath : null,
        memoryMb: memoryMode === 'custom' ? nextMemory : null
      })
      await refreshInstances()
      pushToast('实例设置已保存', 'success')
      onClose()
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="instance-settings-modal">
      <ModalHeader
        eyebrow="INSTANCE SETTINGS"
        title="实例设置"
        description={instance.name}
        onClose={onClose}
      />
      <div className="instance-settings-banner">
        <div className={`instance-settings-mark mark-${instance.loader}`}><span>{instance.mcVersion}</span></div>
        <div>
          <strong>Minecraft {instance.mcVersion}</strong>
          <span>{instance.loaderVersion ? instance.loader + ' ' + instance.loaderVersion : '原版游戏'} · {instance.external ? '外部导入目录' : '矿港独立目录'}</span>
        </div>
        <button className="button ghost small" type="button" onClick={() => void api.config.revealInstance(instance.id)}>
          <FolderOpen size={13} /> 打开目录
        </button>
      </div>

      <label className="field">
        <span className="field-label">实例名称</span>
        <input className="text-input" value={name} maxLength={50} onChange={(event) => setName(event.target.value)} />
      </label>

      <div className="two-column-fields">
        <div className="field">
          <span className="field-label">Java 运行时</span>
          <div className="segmented tiny">
            <button type="button" className={javaMode === 'auto' ? 'active' : ''} onClick={() => setJavaMode('auto')}>自动选择</button>
            <button type="button" className={javaMode === 'custom' ? 'active' : ''} onClick={() => setJavaMode('custom')} disabled={!java.length}>手动指定</button>
          </div>
          {javaMode === 'auto' ? (
            <div className="setting-readout">
              <span>{defaultJava ? 'Java ' + defaultJava.major + ' · ' + defaultJava.vendor : '未找到 Java'}</span>
              <em>根据游戏版本自动匹配</em>
            </div>
          ) : (
            <div className="select-wrap">
              <select value={javaPath} onChange={(event) => setJavaPath(event.target.value)}>
                <option value="">请选择 Java</option>
                {java.map((entry) => (
                  <option key={entry.path} value={entry.path}>Java {entry.major} · {entry.vendor} · {entry.path}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="field">
          <span className="field-label">内存上限</span>
          <div className="segmented tiny">
            <button type="button" data-memory-mode="auto" className={memoryMode === 'auto' ? 'active' : ''} onClick={() => setMemoryMode('auto')}>全局设置</button>
            <button type="button" data-memory-mode="custom" className={memoryMode === 'custom' ? 'active' : ''} onClick={() => setMemoryMode('custom')}>手动设置</button>
          </div>
          {memoryMode === 'auto' ? (
            <>
              <div className="setting-readout">
                <span>{Math.round(config.memoryMb / 1024 * 10) / 10} GB</span>
                <em>跟随全局内存配置</em>
              </div>
              <span className="field-hint">需要单独调整时选择「手动设置」，可直接输入 MB。</span>
            </>
          ) : (
            <>
              <div className="memory-control inline">
                <input
                  type="range"
                  min={512}
                  max={maxInstanceMemory}
                  step={512}
                  value={memoryMb}
                  onChange={(event) => applyInstanceMemory(Number(event.target.value))}
                />
                <div className="memory-number-field">
                  <input
                    type="number"
                    min={512}
                    max={maxInstanceMemory}
                    step={512}
                    value={memoryDraft}
                    aria-label="实例内存上限 MiB"
                    onChange={(event) => setMemoryDraft(event.target.value)}
                    onBlur={() => applyInstanceMemory(normalizeInstanceMemory(memoryDraft))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                  <span>MB</span>
                </div>
              </div>
              <span className="field-hint">全局默认 {Math.round(config.memoryMb / 1024 * 10) / 10} GB，可手动输入实例专用上限。</span>
            </>
          )}
        </div>
      </div>

      <div className="instance-path-box">
        <span>实例工作目录</span>
        <strong title={instance.gameDir}>{instance.gameDir}</strong>
      </div>

      <div className="modal-actions split-actions">
        {onRequestDelete ? (
          <button className="button danger-ghost" type="button" onClick={() => onRequestDelete(instance)}>
            <Trash2 size={14} /> 删除实例
          </button>
        ) : <span />}
        <div>
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button className="button primary" type="button" onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            保存设置
          </button>
        </div>
      </div>
    </Modal>
  )
}
