import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveClientJarVersion } from '../src/main/services/game'

let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })

describe('external client jar resolution', () => {
  it('uses a PCL version-local jar instead of the vanilla parent jar', async () => {
    root = await mkdtemp(join(tmpdir(), 'mineharbor-jar-'))
    const versionDir = join(root, 'versions', 'RLCraft')
    await mkdir(versionDir, { recursive: true })
    await writeFile(join(versionDir, 'RLCraft.jar'), 'jar')
    expect(resolveClientJarVersion({ minecraftRoot: root, versionId: 'RLCraft', external: true }, '1.12.2')).toBe('RLCraft')
    expect(resolveClientJarVersion({ minecraftRoot: root, versionId: 'RLCraft', external: false }, '1.12.2')).toBe('1.12.2')
    expect(resolveClientJarVersion({ minecraftRoot: root, versionId: 'Missing', external: true }, '1.12.2')).toBe('1.12.2')
  })
})
