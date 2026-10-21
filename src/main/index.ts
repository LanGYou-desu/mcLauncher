import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { dirname, join } from 'node:path'
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import type {
  AddMinecraftRootResult,
  AccountMode,
  AuthState,
  BootstrapData,
  ConfigPatch,
  ContentKind,
  DownloadSource,
  InstallContentRequest,
  InstallGameRequest,
  InstallModpackRequest,
  JavaScanResult,
  LoaderType,
  MinecraftBulkImportResult,
  MinecraftImportFailure,
  MinecraftImportItem,
  SystemInfo,
  UpdateInstancePatch
} from '../shared/types'
import { ConfigStore } from './services/config'
import { AuthService, DEFAULT_MICROSOFT_CLIENT_ID } from './services/auth'
import { JobManager } from './services/jobs'
import { GameService } from './services/game'
import { ContentInstaller } from './services/contentInstaller'
import { ModrinthClient } from './services/modrinth'
import { inspectJava, resolveJavaExecutable, scanJavaInstallations } from './services/java'
import {
  buildImportedInstance,
  normalizeMinecraftRoot,
  scanMinecraft,
  validateVersionJson
} from './services/minecraft'
import {
  contentDirectory,
  deleteContent,
  importContentFiles,
  listInstanceContent,
  toggleContent
} from './services/content'
import { getLoaderCatalog, getVersionCatalog } from './services/catalog'

const isDev = !app.isPackaged
app.setName('MineHarbor')

function ensureWritableDirectory(path: string): boolean {
  try {
    mkdirSync(path, { recursive: true })
    accessSync(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

const explicitUserData = process.env.MINEHARBOR_USER_DATA?.trim()
const portableBase = process.env.PORTABLE_EXECUTABLE_DIR?.trim() || (app.isPackaged ? dirname(process.execPath) : '')
let userDataDir = explicitUserData || join(app.getPath('appData'), 'MineHarbor')
let defaultGameRoot = join(userDataDir, 'minecraft')
if (!explicitUserData && app.isPackaged && portableBase) {
  // Match the familiar portable launcher layout:
  //   MineHarbor.exe
  //   .minecraft/       (versions, libraries, assets, instances)
  //   MineHarborData/   (config, cache, encrypted account session)
  const layoutGameRoot = join(portableBase, '.minecraft')
  const layoutDataRoot = join(portableBase, 'MineHarborData')
  if (ensureWritableDirectory(layoutDataRoot) && ensureWritableDirectory(layoutGameRoot)) {
    userDataDir = layoutDataRoot
    defaultGameRoot = layoutGameRoot
  }
}
app.setPath('userData', userDataDir)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

let mainWindow: BrowserWindow | null = null
let config: ConfigStore
let auth: AuthService
let jobs: JobManager
let game: GameService
let contentInstaller: ContentInstaller
let modrinth: ModrinthClient
let javaCache: JavaScanResult | null = null
let javaScanning: Promise<JavaScanResult> | null = null
let javaCachePath = ''

function systemInfo(): SystemInfo {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    osVersion: os.type() + ' ' + os.release(),
    hostname: os.hostname(),
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    cpuModel: os.cpus()[0]?.model ?? '未知处理器',
    appDataPath: app.getPath('userData'),
    gameRoot: config.get().gameRoot
  }
}

async function initializeServices(): Promise<void> {
  const userData = app.getPath('userData')
  const cacheDir = join(userData, 'cache')
  await mkdir(cacheDir, { recursive: true })
  config = await ConfigStore.load({
    userDataPath: userData,
    appDataPath: app.getPath('appData'),
    homePath: app.getPath('home'),
    defaultPlayerName: os.userInfo().username || 'Steve',
    defaultGameRoot,
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024)
  })
  auth = new AuthService({
    userDataPath: userData,
    encryption: {
      available: safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (encrypted) => safeStorage.decryptString(encrypted)
    },
    getClientId: () => config.get().microsoftClientId
  })
  await auth.load()
  if (config.get().accountMode === 'microsoft' && !auth.hasSession()) {
    await config.adjust({ accountMode: 'offline' })
  }
  jobs = new JobManager()
  modrinth = new ModrinthClient()
  game = new GameService({
    config,
    jobs,
    getJava: () => scanJavaCached(false).then((result) => result.java),
    getMicrosoftProfile: () => auth.getLaunchProfile()
  })
  contentInstaller = new ContentInstaller({ config, jobs, game, cacheDir, modrinth })
  javaCachePath = join(userData, 'java-cache.json')

  try {
    const raw = JSON.parse(await readFile(javaCachePath, 'utf8')) as JavaScanResult
    if (Array.isArray(raw.java) && raw.java.length) javaCache = raw
  } catch {
    // no cache yet
  }

  jobs.on('update', (job) => broadcast('job:update', job))
  game.on('game-state', (session) => broadcast('game:state', session))
  game.on('game-log', (payload) => broadcast('game:log', payload))
  auth.on('update', () => broadcastAuth())
  auth.on('authenticated', () => {
    void (async () => {
      await config.adjust({ accountMode: 'microsoft' })
      broadcastConfig()
      broadcastAuth()
    })().catch((error) => console.error('Failed to persist account mode', error))
  })
  auth.on('invalidated', (reason: string) => {
    void (async () => {
      if (config.get().accountMode === 'microsoft') await config.adjust({ accountMode: 'offline' })
      if (typeof reason === 'string') console.warn('Microsoft session invalidated:', reason)
      broadcastConfig()
      broadcastAuth()
    })().catch((error) => console.error('Failed to reset account mode', error))
  })

  void scanJavaCached(true).catch(() => {})
}

async function scanJavaCached(force: boolean): Promise<JavaScanResult> {
  const fresh = javaCache && Date.now() - javaCache.scannedAt < 5 * 60_000
  if (!force && fresh) return javaCache as JavaScanResult
  if (javaScanning) return javaScanning
  javaScanning = (async () => {
    const state = config.get()
    const result = await scanJavaInstallations({
      customJavaPaths: state.customJavaPaths,
      extraRoots: [join(state.gameRoot, 'runtime')]
    })
    javaCache = result
    await writeFile(javaCachePath, JSON.stringify(result, null, 2), 'utf8').catch(() => {})
    broadcast('java:updated', result)
    return result
  })().finally(() => {
    javaScanning = null
  })
  return javaScanning
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function broadcastConfig(): void {
  if (config) broadcast('config:updated', config.get())
}

function authState(): AuthState {
  const accountMode = config.get().accountMode
  return {
    mode: accountMode,
    microsoft: auth.getSessionInfo(),
    hasSession: auth.hasSession(),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    clientId: auth.getEffectiveClientId(),
    defaultClientId: DEFAULT_MICROSOFT_CLIENT_ID,
    lastError: auth.getLastError(),
    deviceFlow: auth.getDeviceFlow()
  }
}

function broadcastAuth(): void {
  if (auth) broadcast('auth:updated', authState())
}

async function bootstrapData(): Promise<BootstrapData> {
  const summaries = await config.summaries()
  return {
    config: config.get(),
    system: systemInfo(),
    instances: summaries,
    java: javaCache?.java ?? [],
    javaScannedAt: javaCache?.scannedAt ?? 0,
    activeJobs: jobs.list(),
    sessions: game.listSessions(),
    auth: authState()
  }
}

function instanceOrThrow(id: string) {
  if (!id || typeof id !== 'string') throw new Error('无效的实例 ID')
  const instance = config.getInstance(id)
  if (!instance) throw new Error('找不到该实例')
  return instance
}

function validateContentKind(kind: string): asserts kind is ContentKind {
  if (!['mods', 'shaderpacks', 'resourcepacks', 'saves'].includes(kind)) throw new Error('未知的内容类型')
}

function validateSource(source: unknown): DownloadSource | undefined {
  if (source === undefined) return undefined
  if (!['auto', 'official', 'bmclapi'].includes(String(source))) throw new Error('未知的下载源')
  return source as DownloadSource
}

function validateLoader(loader: unknown): LoaderType {
  if (!['vanilla', 'fabric', 'forge', 'neoforge'].includes(String(loader))) throw new Error('未知的加载器')
  return loader as LoaderType
}

async function registerIpc(): Promise<void> {
  ipcMain.handle('app:bootstrap', () => bootstrapData())

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle('config:update', async (_event, patch: ConfigPatch) => {
    if (!patch || typeof patch !== 'object') throw new Error('配置参数无效')
    if (patch.accountMode === 'microsoft' && !auth.hasSession()) {
      throw new Error('请先使用 Microsoft 账户登录')
    }
    const updated = await config.adjust(patch)
    broadcast('config:updated', updated)
    broadcastAuth()
    return updated
  })
  ipcMain.handle('dialog:choose-directory', async (_event, title?: string, defaultPath?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : '选择文件夹',
      defaultPath: typeof defaultPath === 'string' && defaultPath.trim() ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })
  ipcMain.handle('config:choose-game-root', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择默认版本目录（PCL2、.minecraft 或 versions）',
      defaultPath: config.get().gameRoot,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const updated = await config.adjust({ gameRoot: normalizeMinecraftRoot(result.filePaths[0]) })
    broadcast('config:updated', updated)
    return updated.gameRoot
  })
  ipcMain.handle('config:reveal-game-root', async () => {
    await shell.openPath(config.get().gameRoot)
  })
  ipcMain.handle('auth:state', () => authState())
  ipcMain.handle('auth:start-microsoft', async () => {
    const start = await auth.startDeviceLogin()
    try {
      const target = new URL(start.verificationUri)
      if (target.protocol !== 'https:' || !(target.hostname === 'microsoft.com' || target.hostname.endsWith('.microsoft.com'))) {
        throw new Error('Microsoft 登录地址无效')
      }
      await shell.openExternal(start.verificationUri)
    } catch {
      // The user can copy the URL from the account dialog if auto-open failed.
    }
    return start
  })
  ipcMain.handle('auth:cancel-microsoft', () => {
    auth.cancelDeviceLogin()
  })
  ipcMain.handle('auth:set-mode', async (_event, mode: AccountMode) => {
    if (mode !== 'offline' && mode !== 'microsoft') throw new Error('未知的账户模式')
    if (mode === 'microsoft' && !auth.hasSession()) throw new Error('请先使用 Microsoft 账户登录')
    const updated = await config.adjust({ accountMode: mode })
    broadcast('config:updated', updated)
    broadcastAuth()
    return authState()
  })
  ipcMain.handle('auth:logout-microsoft', async () => {
    await auth.logout()
    const updated = await config.adjust({ accountMode: 'offline' })
    broadcast('config:updated', updated)
    broadcastAuth()
    return authState()
  })
  ipcMain.handle('config:reveal-instance', async (_event, id: string) => {
    const instance = instanceOrThrow(id)
    await shell.openPath(instance.gameDir)
  })

  ipcMain.handle('java:scan', () => scanJavaCached(true))
  ipcMain.handle('java:add', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择 java.exe / javaw.exe',
      properties: ['openFile'],
      filters: [
        { name: 'Java 可执行文件', extensions: ['exe'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const resolved = resolveJavaExecutable(result.filePaths[0])
    if (!resolved) throw new Error('所选文件不是有效的 Java 可执行文件')
    const info = await inspectJava(resolved)
    if (!info) throw new Error('无法读取该 Java 的版本信息')
    const state = config.get()
    const paths = [...new Set([...state.customJavaPaths, info.path])]
    await config.adjust({ customJavaPaths: paths })
    javaCache = null
    const scanned = await scanJavaCached(true)
    broadcastConfig()
    return scanned
  })
  ipcMain.handle('java:remove-custom', async (_event, javaPath: string) => {
    const state = config.get()
    await config.adjust({ customJavaPaths: state.customJavaPaths.filter((path) => path !== javaPath) })
    javaCache = null
    const scanned = await scanJavaCached(true)
    broadcastConfig()
    return scanned
  })
  ipcMain.handle('java:set-default', async (_event, javaPath: string) => {
    if (javaPath && typeof javaPath !== 'string') throw new Error('无效的 Java 路径')
    const updated = await config.adjust({ globalJavaPath: javaPath || null })
    broadcast('config:updated', updated)
    return updated
  })

  ipcMain.handle('minecraft:scan', async () => {
    const state = config.get()
    return scanMinecraft({ gameRoot: state.gameRoot, knownRoots: state.knownMinecraftRoots, instances: state.instances })
  })
  ipcMain.handle('minecraft:add-root', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '指定版本目录（PCL2、.minecraft 或 versions）',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const root = normalizeMinecraftRoot(result.filePaths[0])
    if (!existsSync(join(root, 'versions'))) throw new Error('该目录下没有 versions 文件夹，不像是 Minecraft 游戏目录')
    const state = config.get()
    const roots = [...new Set([...state.knownMinecraftRoots, root])]
    await config.adjust({ knownMinecraftRoots: roots })
    broadcastConfig()
    const scan = await scanMinecraft({ gameRoot: config.get().gameRoot, knownRoots: roots, instances: config.getInstances() })
    return { ...scan, root } as AddMinecraftRootResult
  })
  ipcMain.handle('minecraft:remove-root', async (_event, root: string) => {
    const state = config.get()
    const roots = state.knownMinecraftRoots.filter((entry) => entry.toLowerCase() !== String(root).toLowerCase())
    await config.adjust({ knownMinecraftRoots: roots })
    broadcastConfig()
    return scanMinecraft({ gameRoot: config.get().gameRoot, knownRoots: roots, instances: config.getInstances() })
  })
  ipcMain.handle('minecraft:import-version', async (_event, root: string, versionId: string) => {
    if (typeof root !== 'string' || typeof versionId !== 'string') throw new Error('导入参数无效')
    const state = config.get()
    const scan = await scanMinecraft({ gameRoot: state.gameRoot, knownRoots: state.knownMinecraftRoots, instances: state.instances })
    const foundRoot = scan.roots.some((entry) => entry.path.toLowerCase() === root.toLowerCase())
    if (!foundRoot) throw new Error('该目录尚未加入扫描列表')
    await validateVersionJson(root, versionId)
    const found = scan.versions.find(
      (version) => version.root.toLowerCase() === root.toLowerCase() && version.versionId === versionId
    )
    if (!found) throw new Error('扫描列表中找不到该版本')
    const instance = buildImportedInstance(found, config.getInstances(), state.gameRoot)
    await config.addInstance(instance)
    broadcastConfig()
    return instance
  })

  ipcMain.handle('minecraft:import-versions', async (_event, items: MinecraftImportItem[]) => {
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
      throw new Error('请选择 1–100 个要导入的版本')
    }
    const uniqueItems = new Map<string, MinecraftImportItem>()
    for (const item of items) {
      const root = typeof item?.root === 'string' ? item.root.trim() : ''
      const versionId = typeof item?.versionId === 'string' ? item.versionId.trim() : ''
      if (!root || !versionId) throw new Error('批量导入参数无效')
      uniqueItems.set(root.toLowerCase() + '|' + versionId, { root, versionId })
    }

    const state = config.get()
    const scan = await scanMinecraft({
      gameRoot: state.gameRoot,
      knownRoots: state.knownMinecraftRoots,
      instances: state.instances
    })
    const currentInstances = [...state.instances]
    const imported: Awaited<ReturnType<typeof config.addInstances>> = []
    const failed: MinecraftImportFailure[] = []

    for (const item of uniqueItems.values()) {
      try {
        const found = scan.versions.find(
          (version) =>
            version.root.toLowerCase() === item.root.toLowerCase() && version.versionId === item.versionId
        )
        if (!found) throw new Error('扫描列表中找不到该版本')
        if (found.imported) {
          throw new Error('该版本已经导入' + (found.instanceName ? '为「' + found.instanceName + '」' : ''))
        }
        await validateVersionJson(found.root, found.versionId)
        const instance = buildImportedInstance(found, currentInstances, state.gameRoot)
        currentInstances.push(instance)
        imported.push(instance)
      } catch (error) {
        failed.push({
          ...item,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (imported.length) {
      await config.addInstances(imported)
      broadcastConfig()
    }
    const result: MinecraftBulkImportResult = { instances: imported, failed }
    return result
  })

  ipcMain.handle('versions:list', () => config.summaries())
  ipcMain.handle('versions:catalog', async (_event, force?: boolean) => getVersionCatalog(config.get().downloadSource, Boolean(force)))
  ipcMain.handle('versions:loaders', async (_event, mcVersion: string, source?: DownloadSource) => {
    if (!/^[A-Za-z0-9._+-]{1,64}$/.test(String(mcVersion))) throw new Error('无效的 Minecraft 版本')
    return getLoaderCatalog(String(mcVersion), validateSource(source) ?? config.get().downloadSource)
  })
  ipcMain.handle('versions:install', async (_event, request: InstallGameRequest) => {
    if (!request || typeof request !== 'object') throw new Error('安装参数无效')
    request.loader = validateLoader(request.loader)
    request.source = validateSource(request.source)
    return game.install(request)
  })
  ipcMain.handle('versions:launch', async (_event, id: string) => game.launch(id))
  ipcMain.handle('versions:update', async (_event, id: string, patch: UpdateInstancePatch) => {
    const result = await game.updateInstance(id, patch)
    broadcastConfig()
    return result
  })
  ipcMain.handle('versions:remove', async (_event, id: string, deleteFiles?: boolean) => {
    const result = await game.removeInstance(id, Boolean(deleteFiles))
    broadcastConfig()
    return result
  })
  ipcMain.handle('versions:repair', async (_event, id: string) => game.repair(id))

  ipcMain.handle('versions:content', async (_event, id: string) => listInstanceContent(instanceOrThrow(id)))
  ipcMain.handle('versions:toggle-content', async (_event, id: string, kind: ContentKind, fileName: string) => {
    validateContentKind(kind)
    const instance = instanceOrThrow(id)
    await toggleContent(instance, kind, fileName)
    return listInstanceContent(instance)
  })
  ipcMain.handle('versions:delete-content', async (_event, id: string, kind: ContentKind, fileName: string) => {
    validateContentKind(kind)
    const instance = instanceOrThrow(id)
    await deleteContent(instance, kind, fileName)
    return listInstanceContent(instance)
  })
  ipcMain.handle('versions:import-content', async (_event, id: string, kind: ContentKind) => {
    validateContentKind(kind)
    const instance = instanceOrThrow(id)
    const filters =
      kind === 'mods'
        ? [{ name: '模组文件', extensions: ['jar', 'zip'] }]
        : kind === 'resourcepacks' || kind === 'shaderpacks'
          ? [{ name: '资源包 / 光影包', extensions: ['zip'] }]
          : []
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: kind === 'mods' ? '导入模组' : kind === 'shaderpacks' ? '导入光影包' : kind === 'resourcepacks' ? '导入资源包' : '导入存档',
      defaultPath: instance.gameDir,
      properties: kind === 'saves' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
      filters: filters.length ? filters : undefined
    })
    if (result.canceled || !result.filePaths.length) return null
    const imported = await importContentFiles(instance, kind, result.filePaths)
    return { ...imported, content: await listInstanceContent(instance) }
  })
  ipcMain.handle('versions:reveal-content', async (_event, id: string, kind: ContentKind, fileName?: string) => {
    validateContentKind(kind)
    const instance = instanceOrThrow(id)
    if (fileName) {
      const dir = contentDirectory(instance, kind)
      if (!/^[^\\/:*?"<>|]+$/.test(fileName)) throw new Error('无效的文件名')
      shell.showItemInFolder(join(dir, fileName))
    } else {
      await shell.openPath(contentDirectory(instance, kind))
    }
  })

  ipcMain.handle('modrinth:search', async (_event, request) => {
    if (!request || typeof request !== 'object') throw new Error('搜索参数无效')
    if (request.mcVersion && !/^[A-Za-z0-9._+-]{1,64}$/.test(String(request.mcVersion))) throw new Error('无效的 Minecraft 版本')
    request.loader = request.loader ? validateLoader(request.loader) : undefined
    return modrinth.search(request)
  })
  ipcMain.handle('modrinth:project', async (_event, projectId: string) => modrinth.project(projectId))
  ipcMain.handle('modrinth:versions', async (_event, projectId: string) => modrinth.versions(projectId))
  ipcMain.handle('modrinth:install-content', async (_event, request: InstallContentRequest) => {
    if (!request || typeof request !== 'object') throw new Error('安装参数无效')
    return contentInstaller.installContent(request)
  })
  ipcMain.handle('modrinth:install-modpack', async (_event, request: InstallModpackRequest) => {
    if (!request || typeof request !== 'object') throw new Error('安装参数无效')
    return contentInstaller.installModpack(request)
  })
  ipcMain.handle('modrinth:import-modpack', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '导入 Modrinth 整合包',
      properties: ['openFile'],
      filters: [{ name: 'Modrinth 整合包', extensions: ['mrpack', 'zip'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return contentInstaller.importModpack(result.filePaths[0])
  })

  ipcMain.handle('session:list', () => game.listSessions())
  ipcMain.handle('session:logs', async (_event, id: string) => game.getLogs(id))
  ipcMain.handle('session:kill', async (_event, id: string) => game.kill(id))
  ipcMain.handle('session:dismiss', async (_event, id: string) => game.dismiss(id))
  ipcMain.handle('jobs:list', () => jobs.list())
  ipcMain.handle('jobs:dismiss', async (_event, id: string) => jobs.dismiss(id))
  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('仅支持打开网页链接')
    await shell.openExternal(url)
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#090b11',
    title: '矿港 · MineHarbor',
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  mainWindow.setMenu(null)
  mainWindow.webContents.setBackgroundThrottling(false)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  if (process.env.MINEHARBOR_LOG_RENDERER) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log('[renderer:' + level + '] ' + message + ' (' + sourceId + ':' + line + ')')
    })
  }
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (process.env.MINEHARBOR_SCREENSHOT) {
    void captureSmokeScreenshots(mainWindow).catch((error) => {
      console.error('screenshot mode failed:', error)
      app.exit(2)
    })
  }
}

async function captureSmokeScreenshots(window: BrowserWindow): Promise<void> {
  const base = process.env.MINEHARBOR_SCREENSHOT!
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const click = (selector: string) =>
    window.webContents
      .executeJavaScript(
        "(() => { const el = document.querySelector(" +
          JSON.stringify(selector) +
          "); if (!el) return false; el.click(); return true; })()",
        true
      )
      .catch(() => false)
  const waitFor = (selector: string, timeout = 10_000) =>
    window.webContents
      .executeJavaScript(
        "new Promise((resolve) => { const end = Date.now() + " +
          timeout +
          "; const check = () => { const el = document.querySelector(" +
          JSON.stringify(selector) +
          "); if (el) resolve(true); else if (Date.now() > end) resolve(false); else setTimeout(check, 100); }; check(); })",
        true
      )
      .catch(() => false)
  const capture = async (name: string) => {
    const image = await window.webContents.capturePage()
    await writeFile(base + '-' + name + '.png', image.toPNG())
    console.log('captured ' + name)
  }

  await wait(1700)
  try {
    await window.webContents.executeJavaScript(
      "new Promise((resolve) => { const check = () => document.querySelector('[data-app-ready=\"true\"]') ? resolve(true) : setTimeout(check, 150); check(); })",
      true
    )
  } catch {
    // Continue and capture whatever is rendered.
  }

  for (const page of ['home', 'versions', 'downloads', 'java', 'settings']) {
    await click('[data-nav="' + page + '"]')
    await waitFor('.' + page + '-page')
    await wait(page === 'downloads' ? 2500 : 400)
    await capture(page)
    if (page === 'settings') {
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('.settings-card')[3]?.scrollIntoView({ block: 'center' })",
        true
      )
      await wait(450)
      await capture('settings-memory')
    }
  }

  // Modrinth browser and version picker
  await click('[data-nav="downloads"]')
  await waitFor('.downloads-page')
  await wait(250)
  await click('[data-download-tab="modpack"]')
  await waitFor('.browser-card:not(.skeleton), .browser-empty, .browser-error')
  await wait(650)
  await capture('modpacks')
  await click('.browser-card:not(.skeleton) .card-install-button')
  await waitFor('.project-modal')
  await waitFor('.project-modal .version-list-item, .project-modal .project-error')
  await wait(700)
  await capture('modpack-detail')
  await click('.modal-close')
  await wait(300)

  // Game install modal
  await click('[data-download-tab="game"]')
  await waitFor('[data-open-install]')
  await click('[data-open-install]')
  await waitFor('.install-modal')
  await wait(1800)
  await capture('install')
  await click('.modal-close')
  await wait(300)

  // Modrinth mods browser with a selected instance
  await click('[data-download-tab="mod"]')
  await waitFor('.browser-card, .browser-empty, .browser-error')
  await wait(500)
  await capture('mods')

  // Local Minecraft scan modal
  await click('[data-nav="versions"]')
  await waitFor('.versions-page')
  await click('[data-version-action="scan"]')
  await waitFor('.scan-modal')
  await wait(500)
  await capture('scan')
  await click('.modal-close')
  await wait(300)

  // Instance content manager when test data has an instance
  const hasInstance = await window.webContents
    .executeJavaScript("Boolean(document.querySelector('.instance-card-footer .text-button'))", true)
    .catch(() => false)
  if (hasInstance) {
    await click('.instance-card-footer .text-button')
    await waitFor('.content-modal')
    await wait(600)
    await capture('content')
    await click('.modal-close')
  }

  // Instance settings surface when an instance exists.
  if (hasInstance) {
    await click('[data-nav="versions"]')
    await waitFor('.versions-page')
    await click('.instance-card .cover-icon-button')
    await wait(250)
    await click('.instance-card .card-menu button')
    await waitFor('.instance-settings-modal')
    await wait(350)
    await capture('instance-settings')
    await click('[data-memory-mode="custom"]')
    await wait(300)
    await capture('instance-settings-memory')
    await click('.modal-close')
  }

  // Account and Microsoft verification surface.
  await click('.titlebar-profile')
  await waitFor('.account-modal')
  await wait(500)
  await capture('account')
  await click('.modal-close')

  if (!process.env.MINEHARBOR_SMOKE_KEEP) app.quit()
}

let initialized = false
async function createMainWindow(): Promise<void> {
  if (!initialized) {
    await initializeServices()
    await registerIpc()
    initialized = true
  }
  nativeTheme.themeSource = 'dark'
  createWindow()
}

process.on('uncaughtException', (error) => {
  console.error('uncaughtException', error)
})
process.on('unhandledRejection', (error) => {
  console.error('unhandledRejection', error)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app
    .whenReady()
    .then(createMainWindow)
    .catch((error) => {
      console.error('Failed to start MineHarbor', error)
      app.exit(1)
    })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    game?.dispose()
  })
}