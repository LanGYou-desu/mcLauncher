import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  AuthState,
  InstanceSummary,
  JavaInfo,
  JobState,
  LaunchSession,
  LauncherConfig,
  SystemInfo
} from '../../../shared/types'
import { api, friendlyError } from './api'
import { BootScreen } from '../components/BootScreen'

export type Page = 'home' | 'versions' | 'downloads' | 'java' | 'settings'
export type DownloadTab = 'game' | 'modpack' | 'mod' | 'shader'
export type ToastKind = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: number
  kind: ToastKind
  message: string
}

export interface LauncherContextValue {
  config: LauncherConfig
  auth: AuthState
  activeAccountName: string
  activeSkinUrl?: string
  system: SystemInfo
  instances: InstanceSummary[]
  java: JavaInfo[]
  jobs: JobState[]
  sessions: LaunchSession[]
  selectedInstance: InstanceSummary | null
  selectedInstanceId: string | null
  page: Page
  downloadTab: DownloadTab
  launchingInstanceId: string | null
  consoleOpen: boolean
  consoleSessionId: string | null
  contentInstance: InstanceSummary | null
  contentRefreshToken: number
  accountOpen: boolean
  toasts: ToastMessage[]
  gameLogs: Record<string, string[]>
  navigate: (page: Page, options?: { tab?: DownloadTab }) => void
  selectInstance: (id: string) => void
  refreshInstances: () => Promise<void>
  updateConfig: (patch: Partial<LauncherConfig>) => Promise<void>
  launchInstance: (id: string) => Promise<void>
  openContent: (id: string) => void
  closeContent: () => void
  openConsole: (sessionId?: string) => void
  closeConsole: () => void
  setAccountOpen: (open: boolean) => void
  pushToast: (message: string, kind?: ToastKind) => void
  removeToast: (id: number) => void
  dismissJob: (id: string) => void
  refreshContent: () => void
}

const LauncherContext = createContext<LauncherContextValue | null>(null)

export function useLauncher(): LauncherContextValue {
  const context = useContext(LauncherContext)
  if (!context) throw new Error('useLauncher must be used inside LauncherProvider')
  return context
}

export function LauncherProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [config, setConfig] = useState<LauncherConfig | null>(null)
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [system, setSystem] = useState<SystemInfo | null>(null)
  const [instances, setInstances] = useState<InstanceSummary[]>([])
  const [java, setJava] = useState<JavaInfo[]>([])
  const [jobs, setJobs] = useState<JobState[]>([])
  const [sessions, setSessions] = useState<LaunchSession[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('home')
  const [downloadTab, setDownloadTab] = useState<DownloadTab>('game')
  const [launchingInstanceId, setLaunchingInstanceId] = useState<string | null>(null)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [consoleSessionId, setConsoleSessionId] = useState<string | null>(null)
  const [contentInstanceId, setContentInstanceId] = useState<string | null>(null)
  const [contentRefreshToken, setContentRefreshToken] = useState(0)
  const [accountOpen, setAccountOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [gameLogs, setGameLogs] = useState<Record<string, string[]>>({})
  const toastCounter = useRef(0)
  const processedJobs = useRef(new Set<string>())
  const processedSessions = useRef(new Set<string>())
  const sessionsRef = useRef<LaunchSession[]>([])
  const paged = useRef(false)

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  const refreshContent = useCallback(() => setContentRefreshToken((value) => value + 1), [])

  const pushToast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++toastCounter.current
    setToasts((prev) => [...prev.slice(-4), { id, kind, message }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, kind === 'error' ? 6500 : 4200)
  }, [])

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const refreshInstances = useCallback(async () => {
    const list = await api.versions.list()
    setInstances(list)
    setSelectedInstanceId((prev) => {
      if (prev && list.some((instance) => instance.id === prev)) return prev
      return list[0]?.id ?? null
    })
    setContentInstanceId((prev) => (prev && list.some((instance) => instance.id === prev) ? prev : null))
  }, [])

  useEffect(() => {
    let disposed = false
    const cleanups: Array<() => void> = []

    const handleJob = (job: JobState) => {
      setJobs((prev) => {
        const next = prev.filter((item) => item.id !== job.id)
        next.unshift(job)
        return next.slice(0, 40)
      })
      if (job.status === 'done' || job.status === 'error') {
        const key = job.id + ':' + job.status
        if (processedJobs.current.has(key)) return
        processedJobs.current.add(key)
        if (job.status === 'done') {
          pushToast(job.title + ' 已完成', 'success')
          if (job.kind === 'content') refreshContent()
        } else {
          pushToast(job.title + ' 失败：' + (job.error || job.detail || '未知错误'), 'error')
        }
        void refreshInstances().catch(() => {})
      }
    }

    const handleSession = (session: LaunchSession) => {
      setSessions((prev) => {
        const next = prev.filter((item) => item.id !== session.id)
        next.unshift(session)
        return next.slice(0, 12)
      })
      setGameLogs((prev) => {
        if (prev[session.id]?.length) return prev
        return { ...prev, [session.id]: [...(session.logTail ?? [])] }
      })
      if (session.status === 'error') {
        const key = session.id + ':error'
        if (!processedSessions.current.has(key)) {
          processedSessions.current.add(key)
          pushToast('游戏异常退出：' + (session.error || '请查看控制台日志'), 'error')
        }
      }
      if (session.status === 'exited' || session.status === 'error') {
        void refreshInstances().catch(() => {})
      }
    }

    cleanups.push(
      api.events.onJobUpdate(handleJob),
      api.events.onJavaUpdated((result) => setJava(result.java)),
      api.events.onConfigUpdated((next) => {
        setConfig(next)
        setInstances((prev) =>
          prev.map((instance) => {
            const updated = next.instances.find((item) => item.id === instance.id)
            return updated ? { ...instance, ...updated } : instance
          })
        )
        setSelectedInstanceId((prev) => {
          if (prev && next.instances.some((item) => item.id === prev)) return prev
          return next.lastInstanceId ?? next.instances[0]?.id ?? null
        })
      }),
      api.events.onGameState(handleSession),
      api.events.onAuthUpdated((next) => setAuthState(next)),
      api.events.onGameLog(({ sessionId, line }) => {
        setGameLogs((prev) => {
          const current = prev[sessionId] ?? []
          const next = [...current, line]
          if (next.length > 1400) next.splice(0, next.length - 1400)
          return { ...prev, [sessionId]: next }
        })
      })
    )

    api
      .bootstrap()
      .then((data) => {
        if (disposed) return
        setConfig(data.config)
        setAuthState(data.auth)
        setSystem(data.system)
        setInstances(data.instances)
        setJava(data.java)
        setJobs(data.activeJobs)
        setSessions(data.sessions)
        const logs: Record<string, string[]> = {}
        for (const session of data.sessions) logs[session.id] = [...(session.logTail ?? [])]
        setGameLogs(logs)
        const initialId =
          data.config.lastInstanceId && data.instances.some((item) => item.id === data.config.lastInstanceId)
            ? data.config.lastInstanceId
            : data.instances[0]?.id ?? null
        setSelectedInstanceId(initialId)
        setReady(true)
      })
      .catch((error) => {
        if (!disposed) setBootError(friendlyError(error))
      })

    return () => {
      disposed = true
      for (const cleanup of cleanups) cleanup()
    }
  }, [pushToast, refreshContent, refreshInstances])

  const navigate = useCallback((nextPage: Page, options?: { tab?: DownloadTab }) => {
    setPage(nextPage)
    if (options?.tab) setDownloadTab(options.tab)
    requestAnimationFrame(() => {
      document.querySelector('.page-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }, [])

  const selectInstance = useCallback((id: string) => {
    setSelectedInstanceId(id)
    const target = instances.find((instance) => instance.id === id)
    if (target) {
      void api.config
        .update({ lastInstanceId: id })
        .then(setConfig)
        .catch(() => {})
    }
  }, [instances])

  const updateConfig = useCallback(async (patch: Partial<LauncherConfig>) => {
    const next = await api.config.update(patch)
    setConfig(next)
    setSystem((prev) => (prev ? { ...prev, gameRoot: next.gameRoot } : prev))
  }, [])

  const launchInstance = useCallback(
    async (id: string) => {
      if (launchingInstanceId) return
      const target = instances.find((instance) => instance.id === id)
      setSelectedInstanceId(id)
      setLaunchingInstanceId(id)
      if (target) {
        void api.config.update({ lastInstanceId: id }).then(setConfig).catch(() => {})
      }
      try {
        const result = await api.versions.launch(id)
        setConsoleSessionId(result.sessionId)
        setConsoleOpen(true)
        // The main process has already persisted lastPlayedAt before returning.
        // Update the sidebar immediately, then rescan summaries in the background.
        const playedAt = Date.now()
        setInstances((prev) =>
          prev.map((instance) => (instance.id === id ? { ...instance, lastPlayedAt: playedAt } : instance))
        )
        pushToast('正在打开 Minecraft，请稍候…', 'info')
        void refreshInstances().catch(() => {})
      } catch (error) {
        pushToast(friendlyError(error), 'error')
      } finally {
        setLaunchingInstanceId(null)
      }
    },
    [instances, launchingInstanceId, pushToast, refreshInstances]
  )

  const openContent = useCallback((id: string) => {
    setContentInstanceId(id)
    setContentRefreshToken((value) => value + 1)
  }, [])

  const closeContent = useCallback(() => setContentInstanceId(null), [])

  const openConsole = useCallback((sessionId?: string) => {
    const active = sessionsRef.current.find((session) => ['starting', 'running'].includes(session.status))
    setConsoleSessionId(sessionId ?? active?.id ?? sessionsRef.current[0]?.id ?? null)
    setConsoleOpen(true)
  }, [])

  const closeConsole = useCallback(() => setConsoleOpen(false), [])

  const dismissJob = useCallback(
    (id: string) => {
      setJobs((prev) => prev.filter((job) => job.id !== id || (job.status !== 'done' && job.status !== 'error')))
      void api.jobs.dismiss(id).catch(() => {})
    },
    []
  )

  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId]
  )

  const contentInstance = useMemo(
    () => instances.find((instance) => instance.id === contentInstanceId) ?? null,
    [instances, contentInstanceId]
  )

  useEffect(() => {
    if (!ready || paged.current) return
    paged.current = true
    document.documentElement.dataset.appReady = 'true'
  }, [ready])

  if (!ready || !config || !system || !authState) {
    return <BootScreen error={bootError} />
  }

  const activeAccountName =
    authState.mode === 'microsoft' && authState.microsoft ? authState.microsoft.name : config.playerName
  const activeSkinUrl = authState.mode === 'microsoft' ? authState.microsoft?.skinUrl : undefined

  const value: LauncherContextValue = {
    config,
    auth: authState,
    activeAccountName,
    activeSkinUrl,
    system,
    instances,
    java,
    jobs,
    sessions,
    selectedInstance,
    selectedInstanceId,
    page,
    downloadTab,
    launchingInstanceId,
    consoleOpen,
    consoleSessionId,
    contentInstance,
    contentRefreshToken,
    accountOpen,
    toasts,
    gameLogs,
    navigate,
    selectInstance,
    refreshInstances,
    updateConfig,
    launchInstance,
    openContent,
    closeContent,
    openConsole,
    closeConsole,
    setAccountOpen,
    pushToast,
    removeToast,
    dismissJob,
    refreshContent
  }

  return <LauncherContext.Provider value={value}>{children}</LauncherContext.Provider>
}

export { LauncherContext }
