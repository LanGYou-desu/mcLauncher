import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../src/main/services/config'

let root = ''

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

describe('external instance registration', () => {
  it('defaults game memory to half of physical memory', async () => {
    root = await mkdtemp(join(tmpdir(), 'mineharbor-memory-'))
    const store = await ConfigStore.load({
      userDataPath: join(root, 'data'),
      appDataPath: root,
      homePath: root,
      defaultPlayerName: 'Steve',
      defaultGameRoot: join(root, 'game'),
      totalMemoryMb: 32768
    })
    expect(store.get().memoryMb).toBe(16384)
  })

  it('does not create directories inside an imported external game directory', async () => {
    root = await mkdtemp(join(tmpdir(), 'mineharbor-config-'))
    const gameRoot = join(root, 'game')
    const store = await ConfigStore.load({
      userDataPath: join(root, 'data'),
      appDataPath: root,
      homePath: root,
      defaultPlayerName: 'Steve',
      defaultGameRoot: gameRoot
    })
    const externalDir = join(root, 'external-instance')
    await store.addInstance({
      name: 'External',
      mcVersion: '1.20.1',
      loader: 'vanilla',
      versionId: '1.20.1',
      minecraftRoot: join(root, 'external-root'),
      gameDir: externalDir,
      external: true,
      source: 'import',
      createdAt: 1
    })
    expect(existsSync(externalDir)).toBe(false)

    const managedDir = join(gameRoot, 'instances', 'managed')
    await store.addInstance({
      name: 'Managed',
      mcVersion: '1.20.1',
      loader: 'vanilla',
      versionId: '1.20.1',
      minecraftRoot: gameRoot,
      gameDir: managedDir,
      external: false,
      source: 'launcher',
      createdAt: 2
    })
    expect(existsSync(join(managedDir, 'mods'))).toBe(true)
  })
})
