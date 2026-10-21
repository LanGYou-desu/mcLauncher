import { Logo } from './Logo'

export function BootScreen({ error }: { error?: string | null }) {
  return (
    <div className="boot-screen">
      <div className="boot-grid" />
      <div className="boot-glow" />
      <div className="boot-content">
        <div className="boot-logo">
          <Logo size={74} />
        </div>
        <div className="boot-wordmark">矿港</div>
        <div className="boot-sub">MINEHARBOR · MINECRAFT LAUNCHER</div>
        {error ? (
          <>
            <div className="boot-error">{error}</div>
            <button className="button primary" onClick={() => window.location.reload()} type="button">
              重新准备
            </button>
          </>
        ) : (
          <div className="boot-loader">
            <span />
            <span />
            <span />
          </div>
        )}
        <div className="boot-footer">正在连接方块世界</div>
      </div>
    </div>
  )
}
