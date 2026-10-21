import { describe, expect, it } from 'vitest'
import { isAbsolute } from 'node:path'
import { offlineUuid, resolveInside, safeFileName, sanitizePlayerName, splitCommandLine } from '../src/main/services/util'
import { chooseJava, parseJavaVersionOutput, resolveJavaExecutable } from '../src/main/services/java'
import type { JavaInfo } from '../src/shared/types'

const java = (major: number, path = 'C:/Java/' + major + '/bin/java.exe'): JavaInfo => ({
  major,
  path,
  version: major + '.0.1',
  vendor: 'Test',
  arch: 'amd64',
  source: 'common',
  addedAt: 0
})

describe('offline profile helpers', () => {
  it('creates a deterministic UUID in the offline format', () => {
    const one = offlineUuid('Steve')
    expect(one).toBe(offlineUuid('Steve'))
    expect(one).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(one).not.toBe(offlineUuid('Alex'))
  })

  it('sanitizes names and protects zip extraction', () => {
    expect(sanitizePlayerName(' 玩家_ABC!! ')).toBe('_ABC')
    expect(sanitizePlayerName('')).toBe('Steve')
    expect(safeFileName('a:b*c?.jar')).toBe('a-b-c-.jar')
    const base = 'C:/games/instance'
    expect(resolveInside(base, 'mods/foo.jar')).toContain('mods')
    expect(resolveInside(base, '../secret.txt')).toBeNull()
    expect(resolveInside(base, '..\\secret.txt')).toBeNull()
    expect(resolveInside(base, isAbsolute('C:/Windows') ? 'C:/Windows' : '/tmp')).toBeNull()
  })

  it('splits quoted command line arguments', () => {
    expect(splitCommandLine('-Xmx4G -Dfoo="hello world" --arg test')).toEqual([
      '-Xmx4G',
      '-Dfoo=hello world',
      '--arg',
      'test'
    ])
  })
})

describe('Java discovery helpers', () => {
  const java8 = 'java version "1.8.0_503"\nJava(TM) SE Runtime Environment (build 1.8.0_503-b01)'
  const java21 = `
    Property settings:
        java.home = /opt/java
        java.vendor = Eclipse Adoptium
        java.version = 21.0.7
        os.arch = amd64
  `

  it('parses Java 8 and modern version output', () => {
    expect(parseJavaVersionOutput(java8)).toMatchObject({ version: '1.8.0_503', major: 8 })
    const parsed = parseJavaVersionOutput(java21)
    expect(parsed).toMatchObject({ version: '21.0.7', major: 21, vendor: 'Eclipse Adoptium', arch: 'amd64', home: '/opt/java' })
  })

  it('chooses the lowest compatible runtime, or falls back to the newest', () => {
    const runtimes = [java(8), java(17), java(21, 'C:/Java/21b/bin/java.exe')]
    expect(chooseJava(runtimes, 17)?.major).toBe(17)
    expect(chooseJava(runtimes, 17, 'C:/Java/21b/bin/java.exe')?.major).toBe(21)
    expect(chooseJava(runtimes, 17, 'C:/Java/8/bin/java.exe')?.major).toBe(17)
    expect(chooseJava([java(8), java(21)], 17)?.major).toBe(21)
    expect(chooseJava([java(8)], 17)?.major).toBe(8)
    expect(chooseJava([], 17)).toBeUndefined()
  })

  it('resolves Java home folders to an executable path when one exists', () => {
    expect(resolveJavaExecutable('C:/definitely/not/a/java/home')).toBeNull()
  })
})