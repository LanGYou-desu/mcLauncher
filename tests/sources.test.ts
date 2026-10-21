import { describe, expect, it } from 'vitest'
import {
  assetsIndexUrls,
  forgeVersionsForMinecraft,
  libraryDownloadUrls,
  neoforgeVersionToMinecraft,
  neoforgeVersionsForMinecraft,
  parseLoaderFromVersion,
  parseMavenVersions,
  sourceOrder,
  toBmclUrl
} from '../src/main/services/sources'
import { compareVersion, normalizeLoaderList } from '../src/main/services/catalog'

describe('mirror URL rewriting', () => {
  it('maps the major Mojang and loader hosts to BMCLAPI', () => {
    expect(toBmclUrl('https://piston-meta.mojang.com/v1/packages/abc/1.20.1.json')).toBe(
      'https://bmclapi2.bangbang93.com/v1/packages/abc/1.20.1.json'
    )
    expect(toBmclUrl('https://libraries.minecraft.net/org/ow2/asm/asm/9.5/asm-9.5.jar')).toBe(
      'https://bmclapi2.bangbang93.com/maven/org/ow2/asm/asm/9.5/asm-9.5.jar'
    )
    expect(toBmclUrl('https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1/forge.jar')).toBe(
      'https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/1.20.1/forge.jar'
    )
    expect(toBmclUrl('https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.80/neoforge.jar')).toBe(
      'https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/21.1.80/neoforge.jar'
    )
    expect(toBmclUrl('https://meta.fabricmc.net/v2/versions/loader')).toBe(
      'https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader'
    )
    expect(toBmclUrl('https://resources.download.minecraft.net/aa/abcdef')).toBe(
      'https://bmclapi2.bangbang93.com/assets/aa/abcdef'
    )
    expect(toBmclUrl('https://api.modrinth.com/v2/search')).toBe('https://api.modrinth.com/v2/search')
  })

  it('prefers the selected source while preserving fallbacks', () => {
    expect(sourceOrder('auto')).toEqual(['bmclapi', 'official'])
    expect(sourceOrder('bmclapi')[0]).toBe('bmclapi')
    expect(sourceOrder('official')[0]).toBe('official')
    const urls = libraryDownloadUrls('org.ow2.asm:asm:9.5', 'org/ow2/asm/asm/9.5/asm-9.5.jar', undefined, 'bmclapi')
    expect(urls[0]).toContain('bmclapi2.bangbang93.com/maven/org/ow2/asm')
    expect(urls).toContain('https://libraries.minecraft.net/org/ow2/asm/asm/9.5/asm-9.5.jar')
  })

  it('builds asset index URLs from the hash, not only the logical id', () => {
    const urls = assetsIndexUrls(
      'https://piston-meta.mojang.com/v1/packages/hash/5.json',
      'hash',
      '5',
      'bmclapi'
    )
    expect(urls[0]).toBe('https://bmclapi2.bangbang93.com/v1/packages/hash/5.json')
  })
})

describe('loader metadata helpers', () => {
  it('parses Maven versions and filters Forge game versions', () => {
    const xml = '<versions><version>1.20.1-47.2.0</version><version>1.21.1-52.0.1</version><version>1.20.1-47.3.0</version></versions>'
    const versions = parseMavenVersions(xml)
    expect(versions).toEqual(['1.20.1-47.2.0', '1.21.1-52.0.1', '1.20.1-47.3.0'])
    expect(forgeVersionsForMinecraft(versions, '1.20.1')).toEqual(['47.2.0', '47.3.0'])
  })

  it('maps NeoForge version numbers to Minecraft versions', () => {
    expect(neoforgeVersionToMinecraft('20.4.237')).toBe('1.20.4')
    expect(neoforgeVersionToMinecraft('21.0.167')).toBe('1.21')
    expect(neoforgeVersionToMinecraft('21.1.80')).toBe('1.21.1')
    expect(neoforgeVersionToMinecraft('21.1.80-beta')).toBe('1.21.1')
    expect(neoforgeVersionsForMinecraft(['21.1.80', '21.4.100', '20.4.1'], '1.21.1')).toEqual(['21.1.80'])
  })

  it('detects loader type from version ids and inheritance', () => {
    expect(parseLoaderFromVersion('1.20.1')).toMatchObject({ loader: 'vanilla', mcVersion: '1.20.1' })
    expect(parseLoaderFromVersion('fabric-loader-0.15.11-1.20.1')).toMatchObject({
      loader: 'fabric',
      mcVersion: '1.20.1',
      loaderVersion: '0.15.11'
    })
    expect(parseLoaderFromVersion('1.20.1-forge-47.2.0')).toMatchObject({
      loader: 'forge',
      mcVersion: '1.20.1',
      loaderVersion: '47.2.0'
    })
    expect(parseLoaderFromVersion('neoforge-21.1.80')).toMatchObject({
      loader: 'neoforge',
      mcVersion: '1.21.1',
      loaderVersion: '21.1.80'
    })
    expect(parseLoaderFromVersion('custom', '1.20.1', 'net.fabricmc.loader.impl.launch.knot.KnotClient')).toMatchObject({
      loader: 'fabric',
      mcVersion: '1.20.1'
    })
  })

  it('sorts loader versions newest first and recommends a stable one', () => {
    const normalized = normalizeLoaderList([
      { version: '0.15.0', stable: true, recommended: false },
      { version: '0.16.0', stable: false, recommended: false },
      { version: '0.14.0', stable: true, recommended: false }
    ])
    expect(normalized.map((item) => item.version)).toEqual(['0.16.0', '0.15.0', '0.14.0'])
    expect(normalized.find((item) => item.recommended)?.version).toBe('0.15.0')
    expect(compareVersion('47.4.10', '47.4.9')).toBeLessThan(0)
  })
})
