import { mkdtemp, mkdir, rm, writeFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Instance } from '../src/shared/types'
import {
  deleteContent,
  listInstanceContent,
  scanContentSummary,
  toggleContent
} from '../src/main/services/content'
import { loaderFromIndex, readMrpackIndex } from '../src/main/services/contentInstaller'

let root = ''
let instance: Instance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mineharbor-test-'))
  instance = {
    id: 'test',
    name: 'Test',
    mcVersion: '1.20.1',
    loader: 'fabric',
    versionId: '1.20.1',
    minecraftRoot: root,
    gameDir: join(root, 'instance'),
    external: false,
    source: 'launcher',
    createdAt: 0
  }
  await mkdir(join(instance.gameDir, 'mods'), { recursive: true })
  await mkdir(join(instance.gameDir, 'shaderpacks'), { recursive: true })
  const zip = new AdmZip()
  zip.addFile(
    'fabric.mod.json',
    Buffer.from(JSON.stringify({ id: 'example', name: 'Example Mod', version: '1.2.3', description: 'A test mod', authors: ['Tester'] }))
  )
  zip.writeZip(join(instance.gameDir, 'mods', 'example.jar'))
  await writeFile(join(instance.gameDir, 'shaderpacks', 'nice-shader.zip'), Buffer.from('fake'))
  const versionDir = join(root, 'versions', '1.20.1')
  await mkdir(versionDir, { recursive: true })
  await writeFile(join(versionDir, '1.20.1.json'), JSON.stringify({ id: '1.20.1' }))
})

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

describe('instance content management', () => {
  it('reads mod metadata and counts content', async () => {
    const content = await listInstanceContent(instance)
    expect(content.mods).toHaveLength(1)
    expect(content.mods[0]).toMatchObject({
      displayName: 'Example Mod',
      version: '1.2.3',
      author: 'Tester',
      enabled: true
    })
    expect(content.shaderpacks).toHaveLength(1)
    const summary = await scanContentSummary(instance)
    expect(summary.modsCount).toBe(1)
    expect(summary.shaderpacksCount).toBe(1)
    expect(summary.versionReady).toBe(true)
  })

  it('toggles a mod and deletes a shader pack', async () => {
    await toggleContent(instance, 'mods', 'example.jar')
    let content = await listInstanceContent(instance)
    expect(content.mods[0].enabled).toBe(false)
    expect(content.mods[0].fileName).toBe('example.jar.disabled')
    await toggleContent(instance, 'mods', 'example.jar.disabled')
    content = await listInstanceContent(instance)
    expect(content.mods[0].enabled).toBe(true)

    await deleteContent(instance, 'shaderpacks', 'nice-shader.zip')
    content = await listInstanceContent(instance)
    expect(content.shaderpacks).toHaveLength(0)
    expect(await readdir(join(instance.gameDir, 'shaderpacks'))).toHaveLength(0)
  })

  it('rejects path traversal', async () => {
    await expect(toggleContent(instance, 'mods', '../secret.jar')).rejects.toThrow()
    await expect(deleteContent(instance, 'mods', '..')).rejects.toThrow()
  })
})

describe('Modrinth modpack index', () => {
  it('parses loader information and rejects zip path escapes in index data', async () => {
    const packPath = join(root, 'pack.mrpack')
    const zip = new AdmZip()
    zip.addFile(
      'modrinth.index.json',
      Buffer.from(
        JSON.stringify({
          formatVersion: 1,
          game: 'minecraft',
          versionId: '1.0.0',
          name: 'Test Pack',
          files: [],
          dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.15.11' }
        })
      )
    )
    zip.writeZip(packPath)
    const index = readMrpackIndex(packPath)
    expect(index.name).toBe('Test Pack')
    expect(loaderFromIndex(index)).toEqual({ mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11' })
  })

  it('recognizes NeoForge and Forge dependencies', () => {
    expect(
      loaderFromIndex({
        formatVersion: 1,
        game: 'minecraft',
        versionId: '1',
        name: 'Neo',
        files: [],
        dependencies: { minecraft: '1.21.1', neoforge: '21.1.80' }
      })
    ).toEqual({ mcVersion: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.80' })
    expect(
      loaderFromIndex({
        formatVersion: 1,
        game: 'minecraft',
        versionId: '1',
        name: 'Forge',
        files: [],
        dependencies: { minecraft: '1.20.1', forge: '47.2.0' }
      })
    ).toEqual({ mcVersion: '1.20.1', loader: 'forge', loaderVersion: '47.2.0' })
  })
})
