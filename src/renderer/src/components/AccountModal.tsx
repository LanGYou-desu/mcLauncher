import { useEffect, useState } from 'react'
import {
  BadgeCheck,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
  WifiOff
} from 'lucide-react'
import type { DeviceLoginStart } from '../../../shared/types'
import { Modal, ModalHeader } from './Modal'
import { PlayerAvatar } from './PlayerAvatar'
import { api } from '../lib/api'
import { useLauncher } from '../lib/launcher-context'

export function AccountModal() {
  const {
    accountOpen,
    setAccountOpen,
    auth,
    config,
    updateConfig,
    pushToast
  } = useLauncher()
  const [name, setName] = useState(config.playerName)
  const [device, setDevice] = useState<DeviceLoginStart | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountOpen) return
    setName(config.playerName)
    setError(null)
  }, [accountOpen, config.playerName])

  const close = () => {
    if (auth.deviceFlow?.status === 'waiting') {
      void api.auth.cancelMicrosoftLogin().catch(() => {})
    }
    setDevice(null)
    setAccountOpen(false)
  }

  const startMicrosoft = async () => {
    setBusy(true)
    setError(null)
    try {
      const start = await api.auth.startMicrosoftLogin()
      setDevice(start)
      pushToast('已打开 Microsoft 登录页面，请输入设备代码。', 'info')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      pushToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const cancelDevice = async () => {
    await api.auth.cancelMicrosoftLogin().catch(() => {})
    setDevice(null)
    setError(null)
  }

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      pushToast('设备代码已复制', 'success')
    } catch {
      pushToast('复制失败，请手动选择代码', 'error')
    }
  }

  const openVerification = async (url: string) => {
    try {
      await api.shell.openExternal(url)
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const useMicrosoft = async () => {
    setBusy(true)
    try {
      await api.auth.setMode('microsoft')
      pushToast('已切换到 Microsoft 正版账户', 'success')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const logoutMicrosoft = async () => {
    setBusy(true)
    try {
      await api.auth.logoutMicrosoft()
      setDevice(null)
      pushToast('已退出 Microsoft 账户', 'success')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const useOffline = async () => {
    if (!name.trim()) {
      setError('请输入玩家名称')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateConfig({ playerName: name, accountMode: 'offline' })
      pushToast('已切换到离线账户', 'success')
      setAccountOpen(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      pushToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const flow = auth.deviceFlow
  const waiting = flow?.status === 'waiting'
  const code = waiting ? flow?.userCode : device?.userCode
  const verificationUri = flow?.verificationUri ?? device?.verificationUri
  const flowError = flow?.status === 'error' ? flow.error : error
  const microsoft = auth.microsoft
  const activeMicrosoft = auth.mode === 'microsoft' && Boolean(microsoft)

  return (
    <Modal open={accountOpen} onClose={close} className="account-modal">
      <ModalHeader
        eyebrow="ACCOUNT"
        title="账户与验证"
        description="使用 Microsoft 正版账户联机，或保留本地离线档案。"
        onClose={close}
      />

      <section className="auth-section auth-microsoft-section">
        <div className="auth-section-heading">
          <div className="auth-section-icon microsoft"><KeyRound size={18} /></div>
          <div>
            <h3>Microsoft 正版账户</h3>
            <p>通过 Microsoft / Xbox Live 验证，使用官方档案和皮肤。</p>
          </div>
          {activeMicrosoft ? <span className="auth-chip active"><BadgeCheck size={12} /> 当前账户</span> : null}
        </div>

        {microsoft ? (
          <>
            <div className="account-preview microsoft">
              <div className="account-avatar-wrap">
                <PlayerAvatar name={microsoft.name} size={74} skinUrl={microsoft.skinUrl} />
                <span className="account-status-dot" />
              </div>
              <div className="account-profile-copy">
                <div className="account-name">{microsoft.name}</div>
                <div className="account-type premium"><BadgeCheck size={13} /> Microsoft 正版 · 已通过验证</div>
                <div className="account-uuid">UUID {microsoft.uuid}</div>
              </div>
            </div>
            <div className="account-button-row">
              {!activeMicrosoft ? (
                <button className="button primary" type="button" disabled={busy} onClick={() => void useMicrosoft()}>
                  <BadgeCheck size={15} /> 使用此正版账户
                </button>
              ) : (
                <span className="auth-active-note"><ShieldCheck size={14} /> 下次启动将使用此账户联机</span>
              )}
              <button className="button ghost" type="button" disabled={busy} onClick={() => void logoutMicrosoft()}>
                <LogOut size={14} /> 退出账户
              </button>
            </div>
          </>
        ) : null}

        {!microsoft && !waiting ? (
          <div className="auth-login-empty">
            <div>
              <strong>登录正版账户</strong>
              <span>支持正版服务器联机，账户凭据使用系统安全存储加密保存在本机。</span>
            </div>
            <button className="button primary" type="button" disabled={busy} onClick={() => void startMicrosoft()}>
              {busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
              {busy ? '正在请求…' : '使用 Microsoft 登录'}
            </button>
          </div>
        ) : null}

        {waiting && code ? (
          <div className="auth-device-box">
            <div className="auth-device-heading">
              <span className="auth-device-spinner"><Loader2 size={15} className="spin" /></span>
              <div>
                <strong>等待浏览器授权</strong>
                <span>请在打开的 Microsoft 页面输入下面的代码</span>
              </div>
            </div>
            <div className="auth-device-code-row">
              <button className="auth-device-code" type="button" onClick={() => void copyCode(code)} title="复制设备代码">
                {code}
                <Copy size={14} />
              </button>
              {verificationUri ? (
                <button className="button ghost small" type="button" onClick={() => void openVerification(verificationUri)}>
                  <ExternalLink size={14} /> 打开登录页
                </button>
              ) : null}
            </div>
            <div className="auth-device-foot">
              <span>授权会自动完成，请保持此窗口打开。</span>
              <button className="text-button" type="button" onClick={() => void cancelDevice()}>取消登录</button>
            </div>
          </div>
        ) : null}

        {flowError ? (
          <div className="inline-warning auth-error">
            <WifiOff size={15} />
            <span>{flowError}</span>
          </div>
        ) : null}

        {!auth.encryptionAvailable ? (
          <div className="inline-warning">
            <ShieldCheck size={15} />
            <span>当前系统安全存储不可用，登录状态仅会在本次运行期间保留。</span>
          </div>
        ) : null}

        {!microsoft ? (
          <p className="auth-fineprint">
            登录由 Microsoft 提供。默认使用公开的 OAuth 客户端；如需使用你自己的 Azure 应用，可在设置中填写客户端 ID。
          </p>
        ) : null}
      </section>

      <section className="auth-section auth-offline-section">
        <div className="auth-section-heading">
          <div className="auth-section-icon offline"><WifiOff size={18} /></div>
          <div>
            <h3>离线账户</h3>
            <p>用于本地游戏；名称会显示在局域网和多人游戏列表中。</p>
          </div>
        </div>
        <label className="field">
          <span className="field-label">玩家名称</span>
          <div className="account-offline-row">
            <input
              className="text-input"
              maxLength={16}
              value={name}
              onChange={(event) => setName(event.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void useOffline()
              }}
              placeholder="Steve"
            />
            <button className="button ghost" type="button" disabled={busy} onClick={() => void useOffline()}>
              {auth.mode === 'offline' ? '保存并使用' : '切换到离线账户'}
            </button>
          </div>
          <span className="field-hint">仅支持英文字母、数字与下划线，最多 16 个字符。</span>
        </label>
      </section>
    </Modal>
  )
}
