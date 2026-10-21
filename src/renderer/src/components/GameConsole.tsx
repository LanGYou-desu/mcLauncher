import { useEffect, useRef, useState } from 'react'
import { Clipboard, Square, TerminalSquare, X } from 'lucide-react'
import { useLauncher } from '../lib/launcher-context'
import { api } from '../lib/api'

const STATUS_LABEL: Record<string, string> = {
  starting: '启动中',
  running: '运行中',
  exited: '已退出',
  error: '异常退出'
}

export function GameConsole() {
  const {
    consoleOpen,
    consoleSessionId,
    sessions,
    gameLogs,
    closeConsole,
    openConsole,
    pushToast
  } = useLauncher()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const [fetchedLogs, setFetchedLogs] = useState<string[]>([])

  const session = sessions.find((item) => item.id === consoleSessionId) ?? null
  const sessionId = session?.id ?? consoleSessionId
  const logs = sessionId ? gameLogs[sessionId] ?? fetchedLogs : []

  useEffect(() => {
    if (!consoleOpen) return
    if (consoleSessionId) {
      void api.session.logs(consoleSessionId).then((lines) => setFetchedLogs(lines)).catch(() => {})
    }
    setFollow(true)
  }, [consoleOpen, consoleSessionId])

  useEffect(() => {
    if (!follow || !consoleOpen) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs.length, follow, consoleOpen])

  useEffect(() => {
    if (!consoleOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeConsole()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [consoleOpen, closeConsole])

  if (!consoleOpen) return null
  const running = session ? ['starting', 'running'].includes(session.status) : false
  const liveLogs = logs.length ? logs : session?.logTail ?? []

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(liveLogs.join('\n'))
      pushToast('日志已复制到剪贴板', 'success')
    } catch {
      pushToast('复制日志失败', 'error')
    }
  }

  return (
    <div className="console-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConsole() }}>
      <div className="console-drawer" role="dialog" aria-modal="true" aria-label="游戏控制台">
        <header className="console-header">
          <div className="console-heading">
            <span className="console-icon"><TerminalSquare size={19} /></span>
            <div>
              <strong>游戏控制台</strong>
              <span>{session?.instanceName ?? (consoleSessionId ? '正在连接实例…' : '实时输出')}</span>
            </div>
          </div>
          <div className="console-header-right">
            {running ? <span className="console-live"><span className="live-dot" /> 正在运行</span> : null}
            {session ? <span className={`console-status status-${session.status}`}>{STATUS_LABEL[session.status] ?? session.status}</span> : null}
            {running ? (
              <button
                className="console-kill"
                type="button"
                onClick={() => {
                  void api.session.kill(session!.id)
                  pushToast('正在结束游戏进程…', 'info')
                }}
              >
                <Square size={12} fill="currentColor" /> 结束进程
              </button>
            ) : null}
            <button className="icon-button" type="button" onClick={copyLogs} aria-label="复制日志">
              <Clipboard size={16} />
            </button>
            <button className="icon-button" type="button" onClick={closeConsole} aria-label="关闭控制台">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="console-meta">
          <span>PID {session?.pid ?? '—'}</span>
          <span>{session?.startedAt ? new Date(session.startedAt).toLocaleTimeString('zh-CN') + ' 启动' : '等待进程输出'}</span>
          <span>{liveLogs.length} 行</span>
        </div>
        <div
          className="console-logs"
          ref={scrollRef}
          onScroll={(event) => {
            const target = event.currentTarget
            const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 40
            setFollow(atBottom)
          }}
        >
          {liveLogs.length === 0 ? (
            <div className="console-empty">
              <TerminalSquare size={26} />
              <p>{consoleSessionId ? '等待游戏输出日志…' : '还没有运行中的游戏'}</p>
              <span>{consoleSessionId ? 'Minecraft 正在启动，日志会实时显示在这里。' : '从启动台选择实例并点击启动。'}</span>
              {!consoleSessionId && sessions[0] ? (
                <button className="button small ghost" type="button" onClick={() => openConsole(sessions[0].id)}>查看最近运行</button>
              ) : null}
            </div>
          ) : (
            liveLogs.map((line, index) => <ConsoleLine key={index} line={line} index={index} />)
          )}
        </div>
        <footer className="console-footer">
          <span>提示：Forge / NeoForge 首次启动可能需要较长时间。</span>
          {!follow ? <button type="button" onClick={() => setFollow(true)}>回到底部</button> : <span className="follow-state">● 实时滚动</span>}
        </footer>
      </div>
    </div>
  )
}

function ConsoleLine({ line, index }: { line: string; index: number }) {
  let className = 'console-line'
  if (/\b(ERROR|FATAL|Exception|Caused by)\b/i.test(line)) className += ' is-error'
  else if (/\b(WARN|WARNING)\b/i.test(line)) className += ' is-warn'
  else if (/\b(Done|Started|ready|success)\b/i.test(line)) className += ' is-success'
  else if (/MineHarbor/.test(line)) className += ' is-self'
  return (
    <div className={className}>
      <span className="console-line-number">{String(index + 1).padStart(3, '0')}</span>
      <span className="console-line-text">{line}</span>
    </div>
  )
}
