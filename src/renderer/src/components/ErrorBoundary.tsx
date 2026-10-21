import { Component, type ErrorInfo, type ReactNode } from 'react'
import { CircleAlert, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error boundary', error, info)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="render-error">
          <div className="render-error-card">
            <span><CircleAlert size={26} /></span>
            <h2>页面暂时迷路了</h2>
            <p>{this.state.error.message}</p>
            <button className="button primary" type="button" onClick={() => this.setState({ error: null })}>
              <RefreshCw size={15} /> 重新加载界面
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
