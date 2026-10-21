import { useEffect, useState } from 'react'
import {
  BadgeCheck,
  Check,
  Coffee,
  DownloadCloud,
  ExternalLink,
  FolderOpen,
  Gauge,
  Globe2,
  HardDrive,
  Info,
  MemoryStick,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
  Zap
} from 'lucide-react'
import type { DownloadSource } from '../../../shared/types'
import { useLauncher } from '../lib/launcher-context'
import { api, friendlyError } from '../lib/api'
import { SOURCE_LABELS, SOURCE_SHORT } from '../lib/constants'
import { Logo } from '../components/Logo'
import { PlayerAvatar } from '../components/PlayerAvatar'

const SOURCES: Array<{ id: DownloadSource; icon: typeof Gauge }> = [
  { id: 'auto', icon: Gauge },
  { id: 'official', icon: Globe2 },
  { id: 'bmclapi', icon: Zap }
]

export function SettingsPage() {
  const {
    config,
    auth,
    activeAccountName,
    activeSkinUrl,
    system,
    java,
    updateConfig,
    pushToast,
    setAccountOpen
  } = useLauncher()
  const [playerName, setPlayerName] = useState(config.playerName)
  const [microsoftClientId, setMicrosoftClientId] = useState(config.microsoftClientId)
  const [source, setSource] = useState<DownloadSource>(config.downloadSource)
  const [memoryMb, setMemoryMb] = useState(config.memoryMb)
  const [minMemoryMb, setMinMemoryMb] = useState(config.minMemoryMb)
  const [memoryDraft, setMemoryDraft] = useState(String(config.memoryMb))
  const [minMemoryDraft, setMinMemoryDraft] = useState(String(config.minMemoryMb))
  const [concurrency, setConcurrency] = useState(config.downloadConcurrency)
  const [jvmArgs, setJvmArgs] = useState(config.jvmArgs)
  const [gameArgs, setGameArgs] = useState(config.gameArgs)
  const [saving, setSaving] = useState(false)
  const [choosingRoot, setChoosingRoot] = useState(false)

  useEffect(() => {
    setPlayerName(config.playerName)
    setMicrosoftClientId(config.microsoftClientId)
    setSource(config.downloadSource)
    setMemoryMb(config.memoryMb)
    setMinMemoryMb(config.minMemoryMb)
    setMemoryDraft(String(config.memoryMb))
    setMinMemoryDraft(String(config.minMemoryMb))
    setConcurrency(config.downloadConcurrency)
    setJvmArgs(config.jvmArgs)
    setGameArgs(config.gameArgs)
  }, [config])

  const memoryMax = Math.max(2048, Math.min(65536, Math.floor((system.totalMemoryMb * 0.8) / 512) * 512))
  const automaticMemory = Math.min(memoryMax, Math.max(1024, Math.round((system.totalMemoryMb / 2) / 512) * 512))
  const minMemoryMax = Math.min(8192, memoryMb)
  const defaultJava = java.find((entry) => entry.path === config.globalJavaPath) ?? java[0]

  const normalizeMemory = (raw: string, fallback: number, max: number) => {
    const parsed = Number(raw)
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
    return Math.max(512, Math.min(max, Math.round(value / 512) * 512))
  }

  const applyMemoryMb = (next: number) => {
    const value = Math.max(512, Math.min(memoryMax, Math.round(next / 512) * 512))
    setMemoryMb(value)
    setMemoryDraft(String(value))
    if (minMemoryMb > Math.min(8192, value)) {
      const nextMin = Math.min(8192, value)
      setMinMemoryMb(nextMin)
      setMinMemoryDraft(String(nextMin))
    }
  }

  const applyMinMemoryMb = (next: number) => {
    const value = Math.max(512, Math.min(minMemoryMax, Math.round(next / 512) * 512))
    setMinMemoryMb(value)
    setMinMemoryDraft(String(value))
  }

  const save = async () => {
    setSaving(true)
    try {
      const nextMemory = normalizeMemory(memoryDraft, memoryMb, memoryMax)
      const nextMinMemory = Math.max(512, Math.min(Math.min(8192, nextMemory), normalizeMemory(minMemoryDraft, minMemoryMb, Math.min(8192, nextMemory))))
      applyMemoryMb(nextMemory)
      applyMinMemoryMb(nextMinMemory)
      await updateConfig({
        playerName,
        microsoftClientId,
        downloadSource: source,
        memoryMb: nextMemory,
        minMemoryMb: nextMinMemory,
        downloadConcurrency: concurrency,
        jvmArgs,
        gameArgs
      })
      pushToast('设置已保存', 'success')
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const chooseRoot = async () => {
    setChoosingRoot(true)
    try {
      const root = await api.config.chooseGameRoot()
      if (root) pushToast('游戏根目录已更新', 'success')
    } catch (error) {
      pushToast(friendlyError(error), 'error')
    } finally {
      setChoosingRoot(false)
    }
  }

  const dirty =
    playerName !== config.playerName ||
    microsoftClientId !== config.microsoftClientId ||
    source !== config.downloadSource ||
    normalizeMemory(memoryDraft, memoryMb, memoryMax) !== config.memoryMb ||
    normalizeMemory(minMemoryDraft, minMemoryMb, Math.min(8192, memoryMb)) !== config.minMemoryMb ||
    concurrency !== config.downloadConcurrency ||
    jvmArgs !== config.jvmArgs ||
    gameArgs !== config.gameArgs

  return (
    <div className="page settings-page">
      <header className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-dash" /> SETTINGS</div>
          <h1>设置<span className="accent-dot">.</span></h1>
          <p>让矿港更贴近你的电脑、网络和游戏习惯。</p>
        </div>
        <div className="page-actions">
          {dirty ? <span className="unsaved-hint">有未保存的更改</span> : <span className="saved-hint"><Check size={14} /> 设置已同步</span>}
          <button className="button primary" type="button" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? <RefreshCw size={15} className="spin" /> : <Save size={15} />} 保存设置
          </button>
        </div>
      </header>

      <div className="settings-layout">
        <div className="settings-main">
          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon"><UserRound size={17} /></span>
              <div><h3>玩家档案</h3><p>启动游戏时使用的账户与名称</p></div>
              <button className="text-button" type="button" onClick={() => setAccountOpen(true)}>管理账户</button>
            </div>
            <div className="profile-account-status">
              <div className="profile-account-main">
                <PlayerAvatar
                  name={auth.mode === 'microsoft' ? activeAccountName : playerName || 'Steve'}
                  size={44}
                  skinUrl={activeSkinUrl}
                />
                <div>
                  <strong>{auth.mode === 'microsoft' ? activeAccountName : '本地离线账户'}</strong>
                  <span>{auth.mode === 'microsoft' ? 'Microsoft 正版 · 已通过验证' : '离线模式 · 仅限本地与局域网'}</span>
                </div>
              </div>
              {auth.mode === 'microsoft' ? (
                <span className="premium-pill"><BadgeCheck size={12} /> PREMIUM</span>
              ) : auth.microsoft ? (
                <span className="offline-pill">OFFLINE · 已连接正版</span>
              ) : (
                <span className="offline-pill">OFFLINE</span>
              )}
            </div>
            <div className="profile-setting-row">
              <div className="profile-setting-main">
                <label className="field compact-field">
                  <span className="field-label">离线玩家名称</span>
                  <input
                    className="text-input"
                    maxLength={16}
                    value={playerName}
                    onChange={(event) => setPlayerName(event.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
                  />
                </label>
                <span className="field-hint">切换到离线账户时使用；名称会显示在多人游戏列表中。</span>
              </div>
            </div>
            <label className="field auth-client-id-field">
              <span className="field-label"><ShieldCheck size={13} /> Microsoft 客户端 ID（可选）</span>
              <input
                className="text-input mono-input"
                placeholder="留空使用内置的公开 OAuth 客户端"
                value={microsoftClientId}
                onChange={(event) => setMicrosoftClientId(event.target.value.trim())}
              />
              <span className="field-hint">仅在你想使用自己的 Azure 应用登录时填写标准 UUID；修改后需要重新登录。</span>
            </label>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon"><HardDrive size={17} /></span>
              <div><h3>默认版本目录</h3><p>新安装版本默认保存到这里，也可在安装时单独指定</p></div>
            </div>
            <div className="path-setting">
              <div className="path-display" title={config.gameRoot}>{config.gameRoot}</div>
              <button className="button ghost small" type="button" onClick={() => void api.config.revealGameRoot()}>
                <FolderOpen size={14} /> 打开
              </button>
              <button className="button ghost small" type="button" onClick={() => void chooseRoot()} disabled={choosingRoot}>
                {choosingRoot ? <RefreshCw size={14} className="spin" /> : <FolderOpen size={14} />} 更改
              </button>
            </div>
            <p className="settings-note">支持 PCL2 启动器目录、.minecraft 或 versions 文件夹；安装窗口也可单独指定。已有实例保留在原来的位置。</p>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon"><DownloadCloud size={17} /></span>
              <div><h3>下载源</h3><p>为原版游戏与加载器选择网络线路</p></div>
            </div>
            <div className="source-option-grid">
              {SOURCES.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={source === item.id ? 'source-option active' : 'source-option'}
                    onClick={() => setSource(item.id)}
                  >
                    <Icon size={18} />
                    <div>
                      <strong>{SOURCE_LABELS[item.id]}</strong>
                      <span>{item.id === 'auto' ? '国内优先，失败时自动回退官方源' : item.id === 'official' ? '直接从 Mojang CDN 下载，海外网络推荐' : '国内加速，Forge/Fabric 支持良好'}</span>
                    </div>
                    {source === item.id ? <Check size={15} /> : null}
                  </button>
                )
              })}
            </div>
            <div className="slider-row">
              <div>
                <strong>并发下载数</strong>
                <span>同时连接的文件数量，网络不稳定时建议降低</span>
              </div>
              <input
                type="range"
                min={1}
                max={16}
                value={concurrency}
                onChange={(event) => setConcurrency(Number(event.target.value))}
              />
              <strong className="slider-value">{concurrency}</strong>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon"><MemoryStick size={17} /></span>
              <div><h3>性能</h3><p>调整 Java 内存与高级启动参数</p></div>
            </div>
            <div className="memory-auto-line">
              <span>默认按物理内存的一半设置：物理内存 {Math.round(system.totalMemoryMb / 1024)} GB · 默认 {(Math.round(automaticMemory / 1024 * 10) / 10)} GB</span>
              <button className="text-button" type="button" onClick={() => applyMemoryMb(automaticMemory)}>
                使用物理内存一半
              </button>
            </div>
            <div className="slider-row memory-slider">
              <div>
                <strong>游戏内存上限</strong>
                <span>可直接输入 MB，或拖动滑块；大型整合包建议 6–12 GB</span>
              </div>
              <input
                type="range"
                min={1024}
                max={memoryMax}
                step={512}
                value={memoryMb}
                onChange={(event) => applyMemoryMb(Number(event.target.value))}
              />
              <div className="memory-number-field">
                <input
                  type="number"
                  min={512}
                  max={memoryMax}
                  step={512}
                  value={memoryDraft}
                  aria-label="游戏内存上限 MiB"
                  onChange={(event) => setMemoryDraft(event.target.value)}
                  onBlur={() => applyMemoryMb(normalizeMemory(memoryDraft, memoryMb, memoryMax))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
                <span>MB</span>
              </div>
            </div>
            <div className="memory-scale"><span>1 GB</span><span>系统内存 {Math.round(system.totalMemoryMb / 1024)} GB</span><span>上限 {Math.round(memoryMax / 1024)} GB</span></div>
            <div className="slider-row memory-slider min-memory-row">
              <div>
                <strong>初始内存</strong>
                <span>传给 JVM 的 -Xms；不会超过游戏内存上限</span>
              </div>
              <input
                type="range"
                min={512}
                max={minMemoryMax}
                step={512}
                value={minMemoryMb}
                onChange={(event) => applyMinMemoryMb(Number(event.target.value))}
              />
              <div className="memory-number-field">
                <input
                  type="number"
                  min={512}
                  max={minMemoryMax}
                  step={512}
                  value={minMemoryDraft}
                  aria-label="初始内存 MiB"
                  onChange={(event) => setMinMemoryDraft(event.target.value)}
                  onBlur={() => applyMinMemoryMb(normalizeMemory(minMemoryDraft, minMemoryMb, minMemoryMax))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
                <span>MB</span>
              </div>
            </div>
            <div className="memory-manual-note">
              当前：上限 {(Math.round(memoryMb / 1024 * 10) / 10)} GB（{memoryMb} MB） · 初始 {(Math.round(minMemoryMb / 1024 * 10) / 10)} GB（{minMemoryMb} MB）
            </div>
            <div className="memory-action-row">
              <span>修改内存后直接保存，或使用页面右上角的「保存设置」。</span>
              <button
                className="button small primary memory-save-button"
                type="button"
                data-settings-save="memory"
                disabled={saving || !dirty}
                onClick={() => void save()}
              >
                {saving ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
                保存设置
              </button>
            </div>
            <div className="two-column-fields settings-fields">
              <label className="field">
                <span className="field-label">额外 JVM 参数</span>
                <input
                  className="text-input mono-input"
                  placeholder="-XX:+UseG1GC …"
                  value={jvmArgs}
                  onChange={(event) => setJvmArgs(event.target.value)}
                />
                <span className="field-hint">追加到 Java 启动命令，留空即可。</span>
              </label>
              <label className="field">
                <span className="field-label">额外游戏参数</span>
                <input
                  className="text-input mono-input"
                  placeholder="--fullscreen …"
                  value={gameArgs}
                  onChange={(event) => setGameArgs(event.target.value)}
                />
                <span className="field-hint">追加到 Minecraft 启动参数。</span>
              </label>
            </div>
          </section>

          <section className="settings-card about-card">
            <div className="settings-card-head">
              <span className="settings-icon"><Info size={17} /></span>
              <div><h3>关于矿港</h3><p>MineHarbor · 一个属于方块世界的港口</p></div>
            </div>
            <div className="about-body">
              <Logo size={56} />
              <div>
                <strong>MineHarbor <span>v{system.appVersion}</span></strong>
                <p>Electron + React + TypeScript 构建的现代 Minecraft 启动器。下载核心基于 XMCL，内容数据来自 Modrinth，国内镜像来自 BMCLAPI。</p>
                <div className="about-links">
                  <button type="button" onClick={() => void api.shell.openExternal('https://modrinth.com')}>Modrinth <ExternalLink size={11} /></button>
                  <button type="button" onClick={() => void api.shell.openExternal('https://bmclapi2.bangbang93.com')}>BMCLAPI <ExternalLink size={11} /></button>
                  <button type="button" onClick={() => void api.shell.openExternal('https://github.com/Voxelum/x-minecraft-launcher')}>XMCL <ExternalLink size={11} /></button>
                </div>
              </div>
              <div className="about-version">
                <span>Electron {system.electronVersion}</span>
                <span>Chromium {system.chromeVersion}</span>
                <span>Node {system.nodeVersion}</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="settings-aside">
          <div className="settings-tip-card">
            <span className="tip-orb" />
            <Sparkles size={20} />
            <h3>让游戏跑得更稳</h3>
            <p>大多数现代版本需要 Java 17 或 21。为整合包分配足够内存，同时保持系统和其它程序有余量。</p>
            <div className="tip-divider" />
            <div className="tip-info"><Coffee size={14} /><span>{defaultJava ? '默认 Java ' + defaultJava.major : '尚未配置 Java'}</span></div>
            <div className="tip-info"><MemoryStick size={14} /><span>{Math.round(memoryMb / 1024 * 10) / 10} GB 已分配</span></div>
          </div>
          <div className="settings-side-card">
            <h4>数据来源</h4>
            <p>{SOURCE_SHORT[config.downloadSource]} · Modrinth Open API</p>
            <h4>游戏目录</h4>
            <p className="break-path">{config.gameRoot}</p>
            <h4>系统</h4>
            <p>{system.osVersion}</p>
          </div>
          <div className="settings-side-card system-summary">
            <Gauge size={16} />
            <div><strong>{Math.round(system.totalMemoryMb / 1024)} GB</strong><span>系统物理内存</span></div>
            <div><strong>{java.length}</strong><span>Java 运行时</span></div>
          </div>
        </aside>
      </div>
    </div>
  )
}
