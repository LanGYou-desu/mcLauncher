import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  DeviceFlowState,
  DeviceLoginStart,
  MicrosoftAccountInfo
} from '../../shared/types'
import { describeError } from './http'

export const DEFAULT_MICROSOFT_CLIENT_ID = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb'
const DEVICE_CODE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const XBOX_USER_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MINECRAFT_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MINECRAFT_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const MICROSOFT_SCOPE = 'XboxLive.signin offline_access'

export interface AuthEncryption {
  available: boolean
  encrypt(plain: string): Buffer
  decrypt(payload: Buffer): string
}

export interface AuthServiceOptions {
  userDataPath: string
  encryption: AuthEncryption
  getClientId: () => string
}

interface XboxProfile {
  id: string
  name: string
  skins?: Array<{ url?: string; state?: string }>
  capes?: Array<{ url?: string; state?: string }>
}

interface StoredMicrosoftSession {
  version: 1
  clientId: string
  profile: XboxProfile
  msa: {
    accessToken: string
    refreshToken: string
    expiresAt: number
  }
  minecraft: {
    accessToken: string
    expiresAt: number
    xuid?: string
  }
  signedInAt: number
}

interface ActiveDeviceFlow {
  info: DeviceFlowState
  deviceCode: string
  clientId: string
  cancelled: boolean
}

export interface MicrosoftLaunchProfile {
  name: string
  uuid: string
  accessToken: string
  xuid?: string
  clientId: string
}

interface JsonResponse<T> {
  status: number
  ok: boolean
  data: T | null
  text: string
}

interface MsaTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface DeviceCodeResponse {
  device_code?: string
  user_code?: string
  verification_uri?: string
  expires_in?: number
  interval?: number
  message?: string
  error?: string
  error_description?: string
}

interface XboxAuthResponse {
  Token?: string
  DisplayClaims?: { xui?: Array<{ uhs?: string; xid?: string }> }
  XErr?: number
  error?: string
  error_description?: string
}

interface MinecraftLoginResponse {
  access_token?: string
  expires_in?: number
  username?: string
  error?: string
  errorMessage?: string
}

export function formatMinecraftUuid(value: string): string {
  const raw = value.replace(/-/g, '').toLowerCase()
  if (raw.length !== 32) return value
  return raw.slice(0, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16) + '-' + raw.slice(16, 20) + '-' + raw.slice(20)
}

export function mapXboxError(code: number | string | undefined): string {
  const numeric = Number(code)
  switch (numeric) {
    case 2148916233:
      return '该 Microsoft 账户还没有 Xbox 账户。请先在 xbox.com 创建一个 Xbox 档案后重试。'
    case 2148916235:
      return 'Xbox Live 在账户所在地区不可用。'
    case 2148916236:
    case 2148916237:
      return '该 Microsoft 账户需要在 Xbox 页面完成年龄验证。'
    case 2148916238:
      return '这是儿童账户，需要先加入 Microsoft 家庭组并获得成人同意。'
    default:
      return 'Xbox Live 身份验证失败' + (code ? '（错误码 ' + code + '）' : '') + '。'
  }
}

export function mapOAuthError(error: string | undefined, description?: string): string {
  switch (error) {
    case 'invalid_client':
    case 'unauthorized_client':
      return 'Microsoft 登录客户端不可用，请在设置中填写有效的 Azure 应用客户端 ID。'
    case 'invalid_scope':
      return 'Microsoft 登录授权范围无效，请稍后重试。'
    case 'authorization_declined':
      return '你已取消 Microsoft 登录授权。'
    case 'expired_token':
    case 'code_expired':
      return '设备登录代码已过期，请重新开始登录。'
    case 'bad_verification_code':
      return '设备登录代码无效，请重新开始登录。'
    case 'invalid_grant':
      return 'Microsoft 登录会话已失效，请重新登录。'
    default:
      return cleanOAuthDescription(description) || 'Microsoft 登录失败，请稍后重试。'
  }
}

function cleanOAuthDescription(description?: string): string {
  if (!description) return ''
  return description
    .replace(/Trace ID:[^\n]*/gi, '')
    .replace(/Correlation ID:[^\n]*/gi, '')
    .replace(/Timestamp:[^\n]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260)
}

async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000
): Promise<JsonResponse<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('网络请求超时')), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' })
    const text = await response.text()
    let data: T | null = null
    try {
      data = text ? (JSON.parse(text) as T) : null
    } catch {
      data = null
    }
    return { status: response.status, ok: response.ok, data, text }
  } finally {
    clearTimeout(timer)
  }
}

function formBody(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class AuthService extends EventEmitter {
  private readonly options: AuthServiceOptions
  private readonly sessionPath: string
  private session: StoredMicrosoftSession | null = null
  private device: ActiveDeviceFlow | null = null
  private lastError: string | undefined

  constructor(options: AuthServiceOptions) {
    super()
    this.options = options
    this.sessionPath = join(options.userDataPath, 'account-session.bin')
  }

  async load(): Promise<void> {
    if (!this.options.encryption.available || !existsSync(this.sessionPath)) return
    try {
      const encrypted = await readFile(this.sessionPath)
      const raw = this.options.encryption.decrypt(encrypted)
      const parsed = JSON.parse(raw) as StoredMicrosoftSession
      if (
        parsed?.version !== 1 ||
        !parsed.profile?.id ||
        !parsed.profile?.name ||
        !parsed.minecraft?.accessToken ||
        !parsed.msa?.refreshToken
      ) {
        throw new Error('账户会话格式无效')
      }
      this.session = parsed
    } catch (error) {
      this.lastError = '无法读取已保存的 Microsoft 登录状态：' + describeError(error)
      await rm(this.sessionPath, { force: true }).catch(() => {})
    }
  }

  getSessionInfo(): MicrosoftAccountInfo | null {
    if (!this.session) return null
    return {
      uuid: formatMinecraftUuid(this.session.profile.id),
      name: this.session.profile.name,
      skinUrl: this.session.profile.skins?.find((skin) => skin.url)?.url,
      capeUrl: this.session.profile.capes?.find((cape) => cape.url)?.url
    }
  }

  hasSession(): boolean {
    return Boolean(this.session)
  }

  getLastError(): string | undefined {
    return this.lastError
  }

  getEffectiveClientId(): string {
    return this.options.getClientId().trim() || DEFAULT_MICROSOFT_CLIENT_ID
  }

  getDeviceFlow(): DeviceFlowState | null {
    return this.device ? { ...this.device.info } : null
  }

  async startDeviceLogin(): Promise<DeviceLoginStart> {
    this.cancelDeviceLogin()
    this.lastError = undefined
    const clientId = this.getEffectiveClientId()
    let response: JsonResponse<DeviceCodeResponse>
    try {
      response = await jsonRequest<DeviceCodeResponse>(DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        },
        body: formBody({ client_id: clientId, scope: MICROSOFT_SCOPE }).toString()
      })
    } catch (error) {
      throw new Error('无法连接 Microsoft 登录服务：' + describeError(error))
    }
    const data = response.data
    if (!response.ok || !data || data.error) {
      const message = mapOAuthError(data?.error, data?.error_description)
      this.lastError = message
      this.emit('update')
      throw new Error(message)
    }
    if (!data.device_code || !data.user_code || !data.verification_uri) {
      throw new Error('Microsoft 登录服务返回了不完整的设备代码')
    }
    const intervalSeconds = Math.max(3, Number(data.interval) || 5)
    const expiresAt = Date.now() + Math.max(60, Number(data.expires_in) || 900) * 1000
    const flow: ActiveDeviceFlow = {
      deviceCode: data.device_code,
      clientId,
      cancelled: false,
      info: {
        sessionId: randomUUID(),
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        expiresAt,
        intervalSeconds,
        status: 'waiting'
      }
    }
    this.device = flow
    this.emit('update')
    void this.pollDeviceFlow(flow)
    return {
      sessionId: flow.info.sessionId,
      userCode: flow.info.userCode,
      verificationUri: flow.info.verificationUri,
      expiresAt,
      intervalSeconds
    }
  }

  cancelDeviceLogin(): void {
    if (!this.device) return
    this.device.cancelled = true
    this.device.info.status = 'cancelled'
    this.device = null
    this.emit('update')
  }

  private async pollDeviceFlow(flow: ActiveDeviceFlow): Promise<void> {
    let interval = flow.info.intervalSeconds
    try {
      while (!flow.cancelled && Date.now() < flow.info.expiresAt) {
        await sleep(interval * 1000)
        if (flow.cancelled) return
        if (Date.now() >= flow.info.expiresAt) {
          this.failDeviceFlow(flow, '设备登录代码已过期，请重新开始登录。')
          return
        }
        let response: JsonResponse<MsaTokenResponse>
        try {
          response = await jsonRequest<MsaTokenResponse>(TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json'
            },
            body: formBody({
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              client_id: flow.clientId,
              device_code: flow.deviceCode
            }).toString()
          })
        } catch (error) {
          this.lastError = '等待 Microsoft 授权时网络连接中断：' + describeError(error)
          this.emit('update')
          continue
        }
        if (flow.cancelled || this.device !== flow) return
        const data = response.data
        if (data?.access_token) {
          await this.finishDeviceLogin(flow, data)
          return
        }
        const error = data?.error ?? 'authorization_pending'
        if (error === 'authorization_pending') continue
        if (error === 'slow_down') {
          interval += 5
          continue
        }
        this.failDeviceFlow(flow, mapOAuthError(error, data?.error_description))
        return
      }
    } catch (error) {
      this.failDeviceFlow(flow, 'Microsoft 登录失败：' + describeError(error))
    }
  }

  private failDeviceFlow(flow: ActiveDeviceFlow, message: string): void {
    if (flow.cancelled) return
    flow.info.status = 'error'
    flow.info.error = message
    this.lastError = message
    this.emit('update')
  }

  private async finishDeviceLogin(flow: ActiveDeviceFlow, tokens: MsaTokenResponse): Promise<void> {
    if (!tokens.access_token || !tokens.refresh_token) {
      this.failDeviceFlow(flow, 'Microsoft 返回的登录凭据不完整。')
      return
    }
    try {
      const result = await this.authenticateMinecraft(tokens.access_token)
      const session: StoredMicrosoftSession = {
        version: 1,
        clientId: flow.clientId,
        profile: result.profile,
        msa: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000
        },
        minecraft: {
          accessToken: result.accessToken,
          expiresAt: Date.now() + result.expiresIn * 1000,
          xuid: result.xuid
        },
        signedInAt: Date.now()
      }
      this.session = session
      this.lastError = undefined
      await this.persistSession()
      flow.info.status = 'success'
      this.emit('authenticated', this.getSessionInfo())
      this.emit('update')
      // Do not keep the device code around after success.
      this.device = null
    } catch (error) {
      this.failDeviceFlow(flow, '无法完成 Xbox / Minecraft 验证：' + describeError(error))
    }
  }

  private async authenticateMinecraft(msaAccessToken: string): Promise<{
    profile: XboxProfile
    accessToken: string
    expiresIn: number
    xuid?: string
  }> {
    const xboxUser = await jsonRequest<XboxAuthResponse>(XBOX_USER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-xbl-contract-version': '1'
      },
      body: JSON.stringify({
        Properties: {
          AuthMethod: 'RPS',
          SiteName: 'user.auth.xboxlive.com',
          RpsTicket: 'd=' + msaAccessToken
        },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT'
      })
    })
    if (!xboxUser.ok || !xboxUser.data?.Token) {
      throw new Error('Xbox Live 用户认证失败' + (xboxUser.data?.error ? '：' + xboxUser.data.error : '。'))
    }
    const uhs = xboxUser.data.DisplayClaims?.xui?.[0]?.uhs
    if (!uhs) throw new Error('Xbox Live 用户认证响应缺少用户标识。')

    const xsts = await jsonRequest<XboxAuthResponse>(XSTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-xbl-contract-version': '1'
      },
      body: JSON.stringify({
        Properties: { SandboxId: 'RETAIL', UserTokens: [xboxUser.data.Token] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT'
      })
    })
    if (!xsts.ok || !xsts.data?.Token) {
      if (xsts.data?.XErr) throw new Error(mapXboxError(xsts.data.XErr))
      throw new Error('Xbox Live 安全令牌获取失败。')
    }
    const xstsUhs = xsts.data.DisplayClaims?.xui?.[0]?.uhs ?? uhs
    const xuid = xsts.data.DisplayClaims?.xui?.[0]?.xid
    const identityToken = 'XBL3.0 x=' + xstsUhs + ';' + xsts.data.Token
    const minecraftLogin = await jsonRequest<MinecraftLoginResponse>(MINECRAFT_LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ identityToken })
    })
    if (!minecraftLogin.ok || !minecraftLogin.data?.access_token) {
      throw new Error(
        'Minecraft 服务登录失败' +
          (minecraftLogin.data?.errorMessage ? '：' + minecraftLogin.data.errorMessage : '。')
      )
    }
    const token = minecraftLogin.data.access_token
    const profileResponse = await jsonRequest<XboxProfile & { error?: string; errorMessage?: string }>(
      MINECRAFT_PROFILE_URL,
      { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }
    )
    if (profileResponse.status === 404) {
      throw new Error('该 Microsoft 账户没有购买 Minecraft Java Edition。')
    }
    if (!profileResponse.ok || !profileResponse.data?.id || !profileResponse.data?.name) {
      throw new Error('无法读取 Minecraft 档案，请确认账户已拥有 Java 版游戏。')
    }
    return {
      profile: profileResponse.data,
      accessToken: token,
      expiresIn: Number(minecraftLogin.data.expires_in) || 86_400,
      xuid
    }
  }

  async getLaunchProfile(): Promise<MicrosoftLaunchProfile> {
    if (!this.session) throw new Error('尚未登录 Microsoft 账户。')
    const session = this.session
    if (session.minecraft.expiresAt > Date.now() + 90_000) {
      return this.toLaunchProfile(session)
    }

    let refreshed: MsaTokenResponse | null = null
    try {
      const response = await jsonRequest<MsaTokenResponse>(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        },
        body: formBody({
          client_id: session.clientId,
          grant_type: 'refresh_token',
          refresh_token: session.msa.refreshToken,
          scope: MICROSOFT_SCOPE
        }).toString()
      })
      refreshed = response.data
      if (!response.ok || !refreshed?.access_token) {
        const error = mapOAuthError(refreshed?.error, refreshed?.error_description)
        if (['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(refreshed?.error ?? '')) {
          await this.invalidateSession(error)
        }
        throw new Error(error)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('登录会话已失效')) throw error
      this.lastError = '刷新 Microsoft 登录状态失败：' + describeError(error)
      this.emit('update')
      throw new Error(this.lastError)
    }

    const result = await this.authenticateMinecraft(refreshed.access_token)
    const updated: StoredMicrosoftSession = {
      ...session,
      profile: result.profile,
      msa: {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || session.msa.refreshToken,
        expiresAt: Date.now() + (Number(refreshed.expires_in) || 3600) * 1000
      },
      minecraft: {
        accessToken: result.accessToken,
        expiresAt: Date.now() + result.expiresIn * 1000,
        xuid: result.xuid ?? session.minecraft.xuid
      }
    }
    this.session = updated
    this.lastError = undefined
    await this.persistSession()
    this.emit('update')
    return this.toLaunchProfile(updated)
  }

  private toLaunchProfile(session: StoredMicrosoftSession): MicrosoftLaunchProfile {
    return {
      name: session.profile.name,
      // Minecraft expects the compact 32-character profile id for online auth.
      uuid: session.profile.id.replace(/-/g, '').toLowerCase(),
      accessToken: session.minecraft.accessToken,
      xuid: session.minecraft.xuid,
      clientId: session.clientId
    }
  }

  private async invalidateSession(reason: string): Promise<void> {
    this.session = null
    this.lastError = reason
    await rm(this.sessionPath, { force: true }).catch(() => {})
    this.emit('invalidated', reason)
    this.emit('update')
  }

  async logout(): Promise<void> {
    this.cancelDeviceLogin()
    this.session = null
    this.lastError = undefined
    await rm(this.sessionPath, { force: true }).catch(() => {})
    this.emit('update')
  }

  private async persistSession(): Promise<void> {
    if (!this.session) return
    if (!this.options.encryption.available) {
      this.lastError = '系统安全存储不可用，登录状态只能在本次运行期间保留。'
      return
    }
    try {
      const encrypted = this.options.encryption.encrypt(JSON.stringify(this.session))
      await mkdir(dirname(this.sessionPath), { recursive: true })
      await writeFile(this.sessionPath, encrypted, { mode: 0o600 })
    } catch (error) {
      this.lastError = '登录成功，但账户凭据保存失败：' + describeError(error)
    }
  }
}
