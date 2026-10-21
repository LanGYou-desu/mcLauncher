import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useLauncher } from '../lib/launcher-context'

export function ToastRail() {
  const { toasts, removeToast } = useLauncher()
  if (!toasts.length) return null
  return (
    <div className="toast-rail" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? AlertCircle : Info
        return (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <span className="toast-icon"><Icon size={17} /></span>
            <span className="toast-message">{toast.message}</span>
            <button type="button" aria-label="关闭提示" onClick={() => removeToast(toast.id)}>
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
