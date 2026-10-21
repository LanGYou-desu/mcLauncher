import { useEffect } from 'react'
import { LauncherProvider, useLauncher } from './lib/launcher-context'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './pages/HomePage'
import { VersionsPage } from './pages/VersionsPage'
import { DownloadsPage } from './pages/DownloadsPage'
import { JavaPage } from './pages/JavaPage'
import { SettingsPage } from './pages/SettingsPage'
import { ContentManager } from './components/ContentManager'
import { GameConsole } from './components/GameConsole'
import { AccountModal } from './components/AccountModal'
import { JobsDock } from './components/JobsDock'
import { ToastRail } from './components/ToastRail'
import { ErrorBoundary } from './components/ErrorBoundary'

function AppShell() {
  const { page } = useLauncher()

  useEffect(() => {
    document.querySelector('.page-scroll')?.scrollTo({ top: 0 })
  }, [page])

  return (
    <div className="app" data-app-ready="true">
      <div className="app-noise" />
      <div className="ambient ambient-violet" />
      <div className="ambient ambient-teal" />
      <TitleBar />
      <div className="app-shell">
        <Sidebar />
        <main className="page-scroll">
          <div className="page-wrap" key={page}>
            <ErrorBoundary>
              {page === 'home' ? <HomePage /> : null}
              {page === 'versions' ? <VersionsPage /> : null}
              {page === 'downloads' ? <DownloadsPage /> : null}
              {page === 'java' ? <JavaPage /> : null}
              {page === 'settings' ? <SettingsPage /> : null}
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <ContentManager />
      <GameConsole />
      <AccountModal />
      <JobsDock />
      <ToastRail />
    </div>
  )
}

export default function App() {
  return (
    <LauncherProvider>
      <AppShell />
    </LauncherProvider>
  )
}
