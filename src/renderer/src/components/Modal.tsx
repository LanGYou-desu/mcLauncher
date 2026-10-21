import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  closeOnBackdrop?: boolean
}

export function Modal({ open, onClose, children, className = '', closeOnBackdrop = true }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <div className={`modal-card ${className}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  )
}

export function ModalClose({ onClose }: { onClose: () => void }) {
  return (
    <button className="icon-button modal-close" onClick={onClose} aria-label="关闭" type="button">
      <X size={18} />
    </button>
  )
}

export function ModalHeader({
  eyebrow,
  title,
  description,
  onClose
}: {
  eyebrow?: string
  title: string
  description?: string
  onClose: () => void
}) {
  return (
    <div className="modal-header">
      <div>
        {eyebrow ? <div className="eyebrow small">{eyebrow}</div> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <ModalClose onClose={onClose} />
    </div>
  )
}
