import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccountMode,
  AddMinecraftRootResult,
  AuthState,
  BootstrapData,
  ConfigPatch,
  ContentImportResult,
  ContentKind,
  DeviceLoginStart,
  DownloadSource,
  InstallContentRequest,
  InstallGameRequest,
  InstallModpackRequest,
  InstallSubmission,
  Instance,
  InstanceContent,
  InstanceSummary,
  JavaScanResult,
  JobState,
  LaunchResult,
  LaunchSession,
  LauncherConfig,
  LoaderCatalog,
  MinecraftBulkImportResult,
  MinecraftImportItem,
  MinecraftScanResult,
  ModrinthProject,
  ModrinthSearchRequest,
  ModrinthSearchResponse,
  ModrinthVersion,
  UpdateInstancePatch,
  VersionCatalog
} from '../shared/types'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  bootstrap: () => invoke<BootstrapData>('app:bootstrap'),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => invoke<boolean>('window:is-maximized')
  },
  config: {
    update: (patch: ConfigPatch) => invoke<LauncherConfig>('config:update', patch),
    chooseGameRoot: () => invoke<string | null>('config:choose-game-root'),
    revealGameRoot: () => invoke<void>('config:reveal-game-root'),
    revealInstance: (instanceId: string) => invoke<void>('config:reveal-instance', instanceId)
  },
  dialog: {
    chooseDirectory: (title?: string, defaultPath?: string) =>
      invoke<string | null>('dialog:choose-directory', title, defaultPath)
  },
  auth: {
    state: () => invoke<AuthState>('auth:state'),
    startMicrosoftLogin: () => invoke<DeviceLoginStart>('auth:start-microsoft'),
    cancelMicrosoftLogin: () => invoke<void>('auth:cancel-microsoft'),
    setMode: (mode: AccountMode) => invoke<AuthState>('auth:set-mode', mode),
    logoutMicrosoft: () => invoke<AuthState>('auth:logout-microsoft')
  },
  java: {
    scan: () => invoke<JavaScanResult>('java:scan'),
    add: () => invoke<JavaScanResult | null>('java:add'),
    removeCustom: (path: string) => invoke<JavaScanResult>('java:remove-custom', path),
    setDefault: (path: string) => invoke<LauncherConfig>('java:set-default', path)
  },
  minecraft: {
    scan: () => invoke<MinecraftScanResult>('minecraft:scan'),
    addRoot: () => invoke<AddMinecraftRootResult | null>('minecraft:add-root'),
    importVersion: (root: string, versionId: string) => invoke<Instance>('minecraft:import-version', root, versionId),
    importVersions: (items: MinecraftImportItem[]) =>
      invoke<MinecraftBulkImportResult>('minecraft:import-versions', items),
    removeRoot: (path: string) => invoke<MinecraftScanResult>('minecraft:remove-root', path)
  },
  versions: {
    list: () => invoke<InstanceSummary[]>('versions:list'),
    catalog: (force?: boolean) => invoke<VersionCatalog>('versions:catalog', force),
    loaders: (mcVersion: string, source?: DownloadSource) => invoke<LoaderCatalog>('versions:loaders', mcVersion, source),
    install: (request: InstallGameRequest) => invoke<InstallSubmission>('versions:install', request),
    launch: (instanceId: string) => invoke<LaunchResult>('versions:launch', instanceId),
    update: (instanceId: string, patch: UpdateInstancePatch) =>
      invoke<InstanceSummary[]>('versions:update', instanceId, patch),
    remove: (instanceId: string, deleteFiles?: boolean) =>
      invoke<InstanceSummary[]>('versions:remove', instanceId, deleteFiles),
    repair: (instanceId: string) => invoke<InstallSubmission>('versions:repair', instanceId),
    content: (instanceId: string) => invoke<InstanceContent>('versions:content', instanceId),
    toggleContent: (instanceId: string, kind: ContentKind, fileName: string) =>
      invoke<InstanceContent>('versions:toggle-content', instanceId, kind, fileName),
    deleteContent: (instanceId: string, kind: ContentKind, fileName: string) =>
      invoke<InstanceContent>('versions:delete-content', instanceId, kind, fileName),
    importContent: (instanceId: string, kind: ContentKind) =>
      invoke<ContentImportResult | null>('versions:import-content', instanceId, kind),
    revealContent: (instanceId: string, kind: ContentKind, fileName?: string) =>
      invoke<void>('versions:reveal-content', instanceId, kind, fileName)
  },
  modrinth: {
    search: (request: ModrinthSearchRequest) => invoke<ModrinthSearchResponse>('modrinth:search', request),
    project: (projectId: string) => invoke<ModrinthProject>('modrinth:project', projectId),
    versions: (projectId: string) => invoke<ModrinthVersion[]>('modrinth:versions', projectId),
    installContent: (request: InstallContentRequest) => invoke<InstallSubmission>('modrinth:install-content', request),
    installModpack: (request: InstallModpackRequest) => invoke<InstallSubmission>('modrinth:install-modpack', request),
    importModpack: () => invoke<InstallSubmission | null>('modrinth:import-modpack')
  },
  session: {
    list: () => invoke<LaunchSession[]>('session:list'),
    logs: (sessionId: string) => invoke<string[]>('session:logs', sessionId),
    kill: (sessionId: string) => invoke<void>('session:kill', sessionId),
    dismiss: (sessionId: string) => invoke<void>('session:dismiss', sessionId)
  },
  jobs: {
    list: () => invoke<JobState[]>('jobs:list'),
    dismiss: (jobId: string) => invoke<void>('jobs:dismiss', jobId)
  },
  shell: {
    openExternal: (url: string) => invoke<void>('shell:open-external', url)
  },
  events: {
    onJobUpdate: (callback: (job: JobState) => void) => subscribe('job:update', callback),
    onJavaUpdated: (callback: (result: JavaScanResult) => void) => subscribe('java:updated', callback),
    onGameState: (callback: (session: LaunchSession) => void) => subscribe('game:state', callback),
    onGameLog: (callback: (payload: { sessionId: string; line: string }) => void) => subscribe('game:log', callback),
    onConfigUpdated: (callback: (config: LauncherConfig) => void) => subscribe('config:updated', callback),
    onAuthUpdated: (callback: (state: AuthState) => void) => subscribe('auth:updated', callback)
  }
}

contextBridge.exposeInMainWorld('mineHarbor', api)

export type MineHarborPreloadApi = typeof api
