export type DownloadSource = 'auto' | 'official' | 'bmclapi'
export type LoaderType = 'vanilla' | 'fabric' | 'forge' | 'neoforge'
export type AccountMode = 'offline' | 'microsoft'
export type ContentKind = 'mods' | 'shaderpacks' | 'resourcepacks' | 'saves'
export type ModrinthProjectType = 'modpack' | 'mod' | 'shader' | 'resourcepack'

export interface LauncherConfig {
  schemaVersion: number
  gameRoot: string
  downloadSource: DownloadSource
  playerName: string
  accountMode: AccountMode
  microsoftClientId: string
  globalJavaPath: string | null
  customJavaPaths: string[]
  knownMinecraftRoots: string[]
  memoryMb: number
  minMemoryMb: number
  downloadConcurrency: number
  jvmArgs: string
  gameArgs: string
  language: 'zh-CN'
  instances: Instance[]
  lastInstanceId: string | null
  onboarded: boolean
}

export interface Instance {
  id: string
  name: string
  mcVersion: string
  loader: LoaderType
  loaderVersion?: string
  versionId: string
  /** Root containing versions/, libraries/ and assets/ */
  minecraftRoot: string
  /** Directory used as the game working directory (mods, saves, options.txt) */
  gameDir: string
  external: boolean
  source: 'launcher' | 'import' | 'modpack'
  javaPath?: string
  memoryMb?: number
  createdAt: number
  lastPlayedAt?: number
  playTimeMs?: number
  modpack?: {
    projectId?: string
    versionId?: string
    name: string
    iconUrl?: string
  }
}

export interface InstanceSummary extends Instance {
  modsCount: number
  shaderpacksCount: number
  resourcepacksCount: number
  savesCount: number
  installedSize: number
  versionReady: boolean
}

export interface JavaInfo {
  path: string
  version: string
  major: number
  vendor: string
  arch: string
  source: 'JAVA_HOME' | 'PATH' | 'common' | 'minecraft' | 'manual' | 'custom'
  addedAt: number
}

export interface JavaScanResult {
  java: JavaInfo[]
  scannedAt: number
  warnings: string[]
}

export interface SystemInfo {
  appVersion: string
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
  platform: string
  arch: string
  osVersion: string
  hostname: string
  totalMemoryMb: number
  cpuModel: string
  appDataPath: string
  gameRoot: string
}

export interface MinecraftVersionSummary {
  id: string
  type: string
  releaseTime: string
  url: string
}

export interface VersionCatalog {
  latest: { release: string; snapshot: string }
  versions: MinecraftVersionSummary[]
  sourceUsed: Exclude<DownloadSource, 'auto'> | DownloadSource
  fetchedAt: number
}

export interface LoaderVersion {
  version: string
  stable: boolean
  recommended: boolean
}

export interface LoaderCatalog {
  fabric: LoaderVersion[]
  forge: LoaderVersion[]
  neoforge: LoaderVersion[]
  warnings: string[]
  fetchedAt: number
}

export interface DiscoveredMinecraftVersion {
  root: string
  versionId: string
  mcVersion: string
  loader: LoaderType
  loaderVersion?: string
  name: string
  path: string
  jarExists: boolean
  lastModified: number
  imported: boolean
  /** Name of the existing launcher instance when this version was imported. */
  instanceName?: string
}

export interface MinecraftRootInfo {
  path: string
  label: string
  versionCount: number
}

export interface MinecraftImportItem {
  root: string
  versionId: string
}

export interface MinecraftImportFailure extends MinecraftImportItem {
  error: string
}

export interface MinecraftBulkImportResult {
  instances: Instance[]
  failed: MinecraftImportFailure[]
}

export interface MinecraftScanResult {
  roots: MinecraftRootInfo[]
  versions: DiscoveredMinecraftVersion[]
  scannedAt: number
  warnings: string[]
}

export interface ContentItem {
  fileName: string
  displayName: string
  version?: string
  author?: string
  description?: string
  enabled: boolean
  size: number
  modified: number
  kind: ContentKind
  isDirectory: boolean
  iconDataUrl?: string
}

export interface InstanceContent {
  mods: ContentItem[]
  shaderpacks: ContentItem[]
  resourcepacks: ContentItem[]
  saves: ContentItem[]
}

export interface InstallGameRequest {
  mcVersion: string
  loader: LoaderType
  loaderVersion?: string
  name?: string
  source?: DownloadSource
  javaPath?: string
  /** Optional per-instance memory limit. Defaults to the global setting. */
  memoryMb?: number
  /** Optional Minecraft root for this installation. Defaults to the global game root. */
  targetRoot?: string
  /** Used internally by modpack installs. */
  modpack?: Instance['modpack']
}

export interface InstallSubmission {
  jobId: string
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error'

export interface JobState {
  id: string
  kind: 'game' | 'modpack' | 'content' | 'repair'
  title: string
  detail: string
  status: JobStatus
  progress: number
  stage: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
  meta?: {
    mcVersion?: string
    loader?: LoaderType
    loaderVersion?: string
    instanceName?: string
  }
}

export interface LaunchSession {
  id: string
  instanceId: string
  instanceName: string
  pid?: number
  status: 'starting' | 'running' | 'exited' | 'error'
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  error?: string
  logTail: string[]
}

export interface LaunchResult {
  sessionId: string
  pid: number
}

export interface MicrosoftAccountInfo {
  uuid: string
  name: string
  skinUrl?: string
  capeUrl?: string
}

export interface DeviceFlowState {
  sessionId: string
  userCode: string
  verificationUri: string
  expiresAt: number
  intervalSeconds: number
  status: 'waiting' | 'success' | 'error' | 'cancelled'
  error?: string
}

export interface AuthState {
  mode: AccountMode
  microsoft: MicrosoftAccountInfo | null
  hasSession: boolean
  encryptionAvailable: boolean
  clientId: string
  defaultClientId: string
  lastError?: string
  deviceFlow: DeviceFlowState | null
}

export interface DeviceLoginStart {
  sessionId: string
  userCode: string
  verificationUri: string
  expiresAt: number
  intervalSeconds: number
}

export interface BootstrapData {
  config: LauncherConfig
  system: SystemInfo
  instances: InstanceSummary[]
  java: JavaInfo[]
  javaScannedAt: number
  activeJobs: JobState[]
  sessions: LaunchSession[]
  auth: AuthState
  cachedCatalog?: VersionCatalog
}

export type ConfigPatch = Partial<Pick<
  LauncherConfig,
  | 'gameRoot'
  | 'downloadSource'
  | 'playerName'
  | 'globalJavaPath'
  | 'customJavaPaths'
  | 'knownMinecraftRoots'
  | 'memoryMb'
  | 'minMemoryMb'
  | 'downloadConcurrency'
  | 'jvmArgs'
  | 'gameArgs'
  | 'language'
  | 'onboarded'
  | 'lastInstanceId'
  | 'accountMode'
  | 'microsoftClientId'
>>

export interface UpdateInstancePatch {
  name?: string
  javaPath?: string | null
  memoryMb?: number | null
}

export interface ModrinthSearchRequest {
  query: string
  type: ModrinthProjectType
  mcVersion?: string
  loader?: LoaderType
  sort?: 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'
  offset?: number
  limit?: number
}

export interface ModrinthSearchHit {
  project_id: string
  project_type: string
  slug: string
  title: string
  description: string
  categories: string[]
  display_categories?: string[]
  downloads: number
  follows: number
  icon_url: string | null
  date_modified: string
  latest_version?: string
  author?: string
  versions?: string[]
  license?: string
  client_side?: string
  server_side?: string
}

export interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[]
  offset: number
  limit: number
  total_hits: number
}

export interface ModrinthFile {
  hashes: { sha1?: string; sha512?: string }
  url: string
  filename: string
  primary: boolean
  size: number
}

export interface ModrinthDependency {
  version_id: string | null
  project_id: string | null
  file_name: string | null
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

export interface ModrinthVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  dependencies: ModrinthDependency[]
  files: ModrinthFile[]
  date_published: string
  downloads: number
  featured?: boolean
  changelog?: string
  version_type?: 'release' | 'beta' | 'alpha'
}

export interface ModrinthProject {
  id: string
  slug: string
  title: string
  description: string
  body?: string
  categories: string[]
  project_type: string
  downloads: number
  followers: number
  icon_url: string | null
  issues_url?: string | null
  source_url?: string | null
  wiki_url?: string | null
  discord_url?: string | null
  game_versions: string[]
  loaders: string[]
  published: string
  updated: string
  license?: { id: string; name: string; url?: string | null }
}

export interface InstallModpackRequest {
  projectId: string
  versionId: string
  name?: string
}

export interface InstallContentRequest {
  instanceId: string
  projectId: string
  versionId: string
  kind: 'mod' | 'shader' | 'resourcepack'
  installDependencies?: boolean
}

export interface AddMinecraftRootResult extends MinecraftScanResult {
  root: string
}

export interface ContentImportResult {
  imported: number
  skipped: number
  content: InstanceContent
}

export interface MineHarborApi {
  bootstrap(): Promise<BootstrapData>
  window: {
    minimize(): void
    maximize(): void
    close(): void
    isMaximized(): Promise<boolean>
  }
  config: {
    update(patch: ConfigPatch): Promise<LauncherConfig>
    chooseGameRoot(): Promise<string | null>
    revealGameRoot(): Promise<void>
    revealInstance(instanceId: string): Promise<void>
  }
  dialog: {
    chooseDirectory(title?: string, defaultPath?: string): Promise<string | null>
  }
  auth: {
    state(): Promise<AuthState>
    startMicrosoftLogin(): Promise<DeviceLoginStart>
    cancelMicrosoftLogin(): Promise<void>
    setMode(mode: AccountMode): Promise<AuthState>
    logoutMicrosoft(): Promise<AuthState>
  }
  java: {
    scan(): Promise<JavaScanResult>
    add(): Promise<JavaScanResult | null>
    removeCustom(path: string): Promise<JavaScanResult>
    setDefault(path: string): Promise<LauncherConfig>
  }
  minecraft: {
    scan(): Promise<MinecraftScanResult>
    addRoot(): Promise<AddMinecraftRootResult | null>
    importVersion(root: string, versionId: string): Promise<Instance>
    importVersions(items: MinecraftImportItem[]): Promise<MinecraftBulkImportResult>
    removeRoot(path: string): Promise<MinecraftScanResult>
  }
  versions: {
    list(): Promise<InstanceSummary[]>
    catalog(force?: boolean): Promise<VersionCatalog>
    loaders(mcVersion: string, source?: DownloadSource): Promise<LoaderCatalog>
    install(request: InstallGameRequest): Promise<InstallSubmission>
    launch(instanceId: string): Promise<LaunchResult>
    update(instanceId: string, patch: UpdateInstancePatch): Promise<InstanceSummary[]>
    remove(instanceId: string, deleteFiles?: boolean): Promise<InstanceSummary[]>
    repair(instanceId: string): Promise<InstallSubmission>
    content(instanceId: string): Promise<InstanceContent>
    toggleContent(instanceId: string, kind: ContentKind, fileName: string): Promise<InstanceContent>
    deleteContent(instanceId: string, kind: ContentKind, fileName: string): Promise<InstanceContent>
    importContent(instanceId: string, kind: ContentKind): Promise<ContentImportResult | null>
    revealContent(instanceId: string, kind: ContentKind, fileName?: string): Promise<void>
  }
  modrinth: {
    search(request: ModrinthSearchRequest): Promise<ModrinthSearchResponse>
    project(projectId: string): Promise<ModrinthProject>
    versions(projectId: string): Promise<ModrinthVersion[]>
    installContent(request: InstallContentRequest): Promise<InstallSubmission>
    installModpack(request: InstallModpackRequest): Promise<InstallSubmission>
    importModpack(): Promise<InstallSubmission | null>
  }
  session: {
    list(): Promise<LaunchSession[]>
    logs(sessionId: string): Promise<string[]>
    kill(sessionId: string): Promise<void>
    dismiss(sessionId: string): Promise<void>
  }
  jobs: {
    list(): Promise<JobState[]>
    dismiss(jobId: string): Promise<void>
  }
  shell: {
    openExternal(url: string): Promise<void>
  }
  events: {
    onJobUpdate(callback: (job: JobState) => void): () => void
    onJavaUpdated(callback: (result: JavaScanResult) => void): () => void
    onGameState(callback: (session: LaunchSession) => void): () => void
    onGameLog(callback: (payload: { sessionId: string; line: string }) => void): () => void
    onConfigUpdated(callback: (config: LauncherConfig) => void): () => void
    onAuthUpdated(callback: (state: AuthState) => void): () => void
  }
}

export const LOADER_LABELS: Record<LoaderType, string> = {
  vanilla: '原版',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge'
}