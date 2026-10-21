import { useState } from 'react'
import {
  Check,
  Coffee,
  Cpu,
  FolderOpen,
  HardDrive,
  Loader2,
  MemoryStick,
  MonitorCog,
  Plus,
  RefreshCw,
  ScanSearch,
  Star,
  Trash2
} from 'lucide-react'
import type { JavaInfo } from '../../../shared/types'
import { useLauncher } from '../lib/launcher-context'
import { api, friendlyError } from '../lib/api'
import { ScanMinecraftPanel } from '../components/ScanMinecraftPanel'

const SOURCE_LABEL: Record<JavaInfo['source'], string> = {
  JAVA_HOME: 'JAVA_HOME',
  PATH: 'PATH',
  common: '常见目录',
  minecraft: 'Minecraft 运行时',
  manual: '手动添加',
  custom: '自定义路径'
}

export function JavaPage() {
  const { config, java, system, pushToast, updateConfig } = useLauncher()
  const [scanning, setScanning] = useState(false)
  const [adding, setAdding] = useState(false)
  const [settingDefault, setSettingDefault] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const scan = async () => {
    setScanning(true)
    try {
      const result = await api.java.scan()
      pushToast(result.java.length ? '已发现 ' + result.java.length + ' 个 Java 运行时' : '没有发现新的 Java 运行时', result.java.length ? 'success' : 'error')
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setScanning(false)
    }
  }

  const addJava = async () => {
    setAdding(true)
    try {
      const result = await api.java.add()
      if (result) pushToast('Java 已加入运行时列表', 'success')
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setAdding(false)
    }
  }

  const setDefault = async (entry: JavaInfo | null) => {
    const path = entry?.path ?? null
    setSettingDefault(path ?? 'auto')
    try {
      await updateConfig({ globalJavaPath: path })
      pushToast(entry ? '已将 Java ' + entry.major + ' 设为全局默认' : '已切换为自动选择 Java', 'success')
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setSettingDefault(null)
    }
  }

  const removeJava = async (entry: JavaInfo) => {
    setRemoving(entry.path)
    try {
      await api.java.removeCustom(entry.path)
      if (config.globalJavaPath === entry.path) {
        await updateConfig({ globalJavaPath: null })
      }
      pushToast('已从自定义列表移除', 'success')
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="page java-page">
      <header className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dash" /> RUNTIMES</div>
          <h1>Java 环境<span className="accent-dot">.</span></h1>
          <p>找到本机的 Java，扫描已有的 Minecraft 目录，让一切就绪。</p>
        </div>
        <div className="page-actions">
          <button className="button ghost" type="button" onClick={() => void addJava()} disabled={adding}>
            {adding ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} 手动添加
          </button>
          <button className="button primary" type="button" onClick={() => void scan()} disabled={scanning}>
            {scanning ? <RefreshCw size={16} className="spin" /> : <ScanSearch size={16} />}
            {scanning ? '扫描中…' : '重新扫描 Java'}
          </button>
        </div>
      </header>

      <div className="java-layout">
        <section className="java-main panel-block">
          <div className="section-header">
            <div>
              <h3>已发现的 Java</h3>
              <p>{java.length ? '共找到 ' + java.length + ' 个运行时，启动时会根据游戏版本自动匹配' : '还没有发现可用的 Java 运行时'}</p>
            </div>
            <span className="subtle-badge"><Cpu size={13} /> {system.arch}</span>
          </div>

          {java.length ? (
            <div className="java-list">
              {java.map((entry) => {
                const isDefault = config.globalJavaPath === entry.path
                const isCustom = config.customJavaPaths.includes(entry.path)
                return (
                  <div className={isDefault ? 'java-card is-default' : 'java-card'} key={entry.path}>
                    <div className="java-icon"><Coffee size={21} /></div>
                    <div className="java-copy">
                      <div className="java-title">
                        <strong>Java {entry.major}</strong>
                        <span>{entry.version}</span>
                        {isDefault ? <span className="default-badge"><Star size={11} fill="currentColor" /> 默认</span> : null}
                        {isCustom ? <span className="source-badge">{SOURCE_LABEL[entry.source]}</span> : <span className="source-badge muted">{SOURCE_LABEL[entry.source]}</span>}
                      </div>
                      <span className="java-vendor">{entry.vendor} · {entry.arch}</span>
                      <span className="java-path" title={entry.path}>{entry.path}</span>
                    </div>
                    <div className="java-actions">
                      {!isDefault ? (
                        <button
                          className="button tiny ghost"
                          type="button"
                          disabled={settingDefault === entry.path}
                          onClick={() => void setDefault(entry)}
                        >
                          {settingDefault === entry.path ? <Loader2 size={12} className="spin" /> : <Star size={12} />} 设为默认
                        </button>
                      ) : (
                        <span className="java-active"><Check size={13} /> 正在使用</span>
                      )}
                      {isCustom ? (
                        <button
                          className="icon-button tiny danger"
                          type="button"
                          title="从自定义列表移除"
                          disabled={removing === entry.path}
                          onClick={() => void removeJava(entry)}
                        >
                          {removing === entry.path ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="java-empty">
              <div className="java-empty-icon"><Coffee size={28} /></div>
              <strong>还没有 Java 运行时</strong>
              <span>矿港会扫描常见 Java 安装目录与 Minecraft 自带运行时。你也可以手动选择 java.exe。</span>
              <div className="empty-actions">
                <button className="button primary small" type="button" onClick={() => void scan()} disabled={scanning}>
                  {scanning ? <Loader2 size={14} className="spin" /> : <ScanSearch size={14} />} 重新扫描
                </button>
                <button className="button ghost small" type="button" onClick={() => void addJava()}>
                  <Plus size={14} /> 手动添加
                </button>
              </div>
            </div>
          )}

          <button
            className={config.globalJavaPath ? 'auto-java-row' : 'auto-java-row active'}
            type="button"
            onClick={() => void setDefault(null)}
            disabled={settingDefault !== null}
          >
            <span className="auto-java-dot" />
            <div>
              <strong>自动选择合适的 Java</strong>
              <span>矿港会根据实例的 Minecraft 版本匹配最低兼容的 Java。</span>
            </div>
            {!config.globalJavaPath ? <span className="auto-java-current">当前</span> : <span className="auto-java-action">切换</span>}
          </button>
        </section>

        <aside className="java-side">
          <div className="aside-card system-card">
            <div className="aside-card-title">
              <span className="aside-icon"><MonitorCog size={16} /></span>
              <div><strong>运行环境</strong><em>System</em></div>
            </div>
            <div className="system-rows">
              <div><span>操作系统</span><strong>{system.osVersion}</strong></div>
              <div><span>处理器架构</span><strong>{system.arch}</strong></div>
              <div><span>物理内存</span><strong>{Math.round(system.totalMemoryMb / 1024)} GB</strong></div>
              <div><span>游戏内存</span><strong>{Math.round(config.memoryMb / 1024 * 10) / 10} GB</strong></div>
            </div>
            <div className="system-cpu" title={system.cpuModel}><Cpu size={13} /><span>{system.cpuModel}</span></div>
          </div>

          <div className="aside-card java-guide">
            <div className="aside-card-title">
              <span className="aside-icon"><MemoryStick size={16} /></span>
              <div><strong>版本匹配</strong><em>Java compatibility</em></div>
            </div>
            <div className="compat-row"><span>Minecraft 1.20.5+</span><strong>Java 21</strong></div>
            <div className="compat-row"><span>Minecraft 1.18 – 1.20.4</span><strong>Java 17</strong></div>
            <div className="compat-row"><span>Minecraft 1.17</span><strong>Java 16</strong></div>
            <div className="compat-row"><span>经典旧版本</span><strong>Java 8</strong></div>
            <p className="aside-note">如果自动匹配不准确，可以在实例设置中手动指定 Java。</p>
          </div>

          <button className="aside-card game-folder-card" type="button" onClick={() => void api.config.revealGameRoot()}>
            <span className="aside-icon"><HardDrive size={16} /></span>
            <div>
              <strong>游戏根目录</strong>
              <span>{config.gameRoot}</span>
            </div>
            <FolderOpen size={15} />
          </button>
        </aside>
      </div>

      <section className="minecraft-scan-section panel-block">
        <ScanMinecraftPanel />
      </section>
    </div>
  )
}
