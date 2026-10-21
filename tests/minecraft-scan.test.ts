import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildImportedInstance, normalizeMinecraftRoot, scanMinecraft } from '../src/main/services/minecraft'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mineharbor-scan-'))
  const versions = join(root, 'versions')
  await mkdir(join(versions, '1.20.1'), { recursive: true })
  await writeFile(join(versions, '1.20.1', '1.20.1.json'), JSON.stringify({ id: '1.20.1' }))
  await writeFile(join(versions, '1.20.1', '1.20.1.jar'), 'fake jar')
  await mkdir(join(versions, 'fabric-loader-0.15.11-1.20.1'), { recursive: true })
  await writeFile(
    join(versions, 'fabric-loader-0.15.11-1.20.1', 'fabric-loader-0.15.11-1.20.1.json'),
    JSON.stringify({
      id: 'fabric-loader-0.15.11-1.20.1',
      inheritsFrom: '1.20.1',
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient'
    })
  )
})

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

describe('local Minecraft discovery', () => {
  it('finds versions and resolves loader metadata', async () => {
    const scan = await scanMinecraft({ gameRoot: root, knownRoots: [root], instances: [] })
    expect(scan.roots.find((entry) => entry.path === root)?.versionCount).toBeGreaterThanOrEqual(2)
    const vanilla = scan.versions.find((version) => version.versionId === '1.20.1')
    const fabric = scan.versions.find((version) => version.versionId === 'fabric-loader-0.15.11-1.20.1')
    expect(vanilla).toMatchObject({ mcVersion: '1.20.1', loader: 'vanilla', jarExists: true, imported: false })
    expect(fabric).toMatchObject({ mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11' })
  })

  it('understands PCL2 portable roots and isolated version game directories', async () => {
    const pclRoot = join(root, 'PCL2-Portable')
    const pclMc = join(pclRoot, '.minecraft')
    const isolated = join(pclMc, 'versions', 'PCLIsolated')
    await mkdir(isolated, { recursive: true })
    await mkdir(join(pclRoot, 'PCL'), { recursive: true })
    await writeFile(join(isolated, 'PCLIsolated.json'), JSON.stringify({ id: 'PCLIsolated' }))
    await writeFile(join(isolated, 'PCLIsolated.jar'), 'fake jar')
    await mkdir(join(isolated, 'mods'), { recursive: true })
    await mkdir(join(isolated, 'PCL'), { recursive: true })
    await writeFile(join(isolated, 'PCL', 'Setup.ini'), 'VersionArgumentIndieV2:True')

    expect(normalizeMinecraftRoot(pclRoot)).toBe(pclMc)
    expect(normalizeMinecraftRoot(join(pclMc, 'versions'))).toBe(pclMc)

    const scan = await scanMinecraft({ gameRoot: join(root, 'unused-game-root'), knownRoots: [pclMc], instances: [] })
    expect(scan.roots.find((entry) => entry.path === pclMc)?.label).toBe('PCL2 目录')
    const version = scan.versions.find((entry) => entry.versionId === 'PCLIsolated')
    expect(version).toBeTruthy()
    const imported = buildImportedInstance(version!, [], join(root, 'unused-game-root'))
    expect(imported.name).toBe('PCLIsolated')
    expect(imported.external).toBe(true)
    expect(imported.gameDir).toBe(isolated)
  })

  it('marks already imported versions and builds sane instances', async () => {
    const imported = {
      id: 'existing',
      name: 'Imported',
      mcVersion: '1.20.1',
      loader: 'vanilla' as const,
      versionId: '1.20.1',
      minecraftRoot: root,
      gameDir: root,
      external: true,
      source: 'import' as const,
      createdAt: 1
    }
    const scan = await scanMinecraft({ gameRoot: join(root, 'app'), knownRoots: [root], instances: [imported] })
    const version = scan.versions.find((entry) => entry.versionId === '1.20.1')
    expect(version?.imported).toBe(true)
    expect(version?.instanceName).toBe('Imported')
    expect(() => buildImportedInstance(version!, [imported], join(root, 'app'))).toThrow()
  })
})
