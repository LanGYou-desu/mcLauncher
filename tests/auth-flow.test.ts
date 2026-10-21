import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthService, type AuthEncryption } from '../src/main/services/auth'

const encryption: AuthEncryption = {
  available: true,
  encrypt: (plain) => Buffer.from(plain, 'utf8'),
  decrypt: (payload) => payload.toString('utf8')
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

async function waitFor<T>(read: () => T | null, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for authentication')
}

describe('Microsoft authentication flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('completes device auth, Xbox/Minecraft profile fetch, refresh and encrypted persistence', async () => {
    let devicePolls = 0
    let mcLoginCalls = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/devicecode')) {
        return json({
          device_code: 'device-code',
          user_code: 'ABCDEFGH',
          verification_uri: 'https://www.microsoft.com/link',
          expires_in: 900,
          interval: 3
        })
      }
      if (url.includes('/oauth2/v2.0/token')) {
        devicePolls++
        return json({
          access_token: devicePolls > 1 ? 'msa-refreshed' : 'msa-access',
          refresh_token: devicePolls > 1 ? 'refresh-refreshed' : 'refresh-initial',
          expires_in: 3600
        })
      }
      if (url.includes('user.auth.xboxlive.com')) {
        return json({ Token: 'xbl-token', DisplayClaims: { xui: [{ uhs: 'user-hash' }] } })
      }
      if (url.includes('xsts.auth.xboxlive.com')) {
        return json({
          Token: 'xsts-token',
          DisplayClaims: { xui: [{ uhs: 'user-hash', xid: '123456789' }] }
        })
      }
      if (url.includes('login_with_xbox')) {
        mcLoginCalls++
        // Force the launch path to refresh the Minecraft session once.
        return json({ access_token: 'mc-token-' + mcLoginCalls, expires_in: 1 })
      }
      if (url.includes('/minecraft/profile')) {
        return json({
          id: '069A79F444E94726A5BEFCA90E38AAF5',
          name: 'PremiumPlayer',
          skins: [{ url: 'https://textures.minecraft.net/texture/demo', state: 'ACTIVE' }]
        })
      }
      throw new Error('unexpected auth URL: ' + url)
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const dir = await mkdtemp(join(tmpdir(), 'mineharbor-auth-flow-'))
    try {
      const auth = new AuthService({
        userDataPath: dir,
        encryption,
        getClientId: () => ''
      })
      const start = await auth.startDeviceLogin()
      expect(start.userCode).toBe('ABCDEFGH')
      expect(auth.getSessionInfo()).toBeNull()

      const profile = await waitFor(() => auth.getSessionInfo())
      expect(profile).toMatchObject({
        name: 'PremiumPlayer',
        uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5'
      })
      expect(auth.hasSession()).toBe(true)

      const launch = await auth.getLaunchProfile()
      expect(launch).toMatchObject({
        name: 'PremiumPlayer',
        uuid: '069a79f444e94726a5befca90e38aaf5',
        accessToken: 'mc-token-2'
      })
      expect(devicePolls).toBeGreaterThanOrEqual(2)

      const reloaded = new AuthService({
        userDataPath: dir,
        encryption,
        getClientId: () => ''
      })
      await reloaded.load()
      expect(reloaded.getSessionInfo()?.name).toBe('PremiumPlayer')
      expect(reloaded.hasSession()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 15_000)
})
