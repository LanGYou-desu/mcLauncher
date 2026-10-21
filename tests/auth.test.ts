import { describe, expect, it } from 'vitest'
import { formatMinecraftUuid, mapOAuthError, mapXboxError } from '../src/main/services/auth'

describe('Microsoft authentication helpers', () => {
  it('formats the Minecraft profile id as a dashed UUID', () => {
    expect(formatMinecraftUuid('069A79F444E94726A5BEFCA90E38AAF5')).toBe('069a79f4-44e9-4726-a5be-fca90e38aaf5')
    expect(formatMinecraftUuid('not-a-uuid')).toBe('not-a-uuid')
  })

  it('maps common Xbox family and region errors to useful messages', () => {
    expect(mapXboxError(2148916233)).toContain('Xbox')
    expect(mapXboxError(2148916238)).toContain('儿童')
    expect(mapXboxError(2148916235)).toContain('地区')
    expect(mapXboxError(undefined)).toContain('Xbox Live')
  })

  it('maps OAuth errors and strips noisy diagnostic detail', () => {
    expect(mapOAuthError('expired_token')).toContain('过期')
    expect(mapOAuthError('invalid_client')).toContain('客户端 ID')
    const detail = 'AADSTS123: something failed. Trace ID: abc Correlation ID: def Timestamp: 123'
    expect(mapOAuthError('temporarily_unavailable', detail)).not.toContain('Trace ID')
    expect(mapOAuthError('temporarily_unavailable', detail)).not.toContain('Correlation ID')
  })
})
