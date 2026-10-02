import { Component, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'

interface Props { children: ReactNode }
interface State { error: Error | null }

/** 全局错误边界：渲染异常时给出可恢复界面，而不是整页白屏 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error(error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full grid place-items-center bg-surface text-on-surface px-6">
          <div className="text-center max-w-[420px]">
            <div className="grid place-items-center w-14 h-14 rounded-full bg-danger/10 text-danger mx-auto mb-4">
              <RotateCcw size={24} />
            </div>
            <p className="text-[16px] font-semibold mb-1.5">页面出了点问题</p>
            <p className="text-[12.5px] text-on-surface-2 leading-relaxed mb-4 break-all">
              {this.state.error.message || '未知错误'}（你的数据都在本地，刷新即可恢复）
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload() }}
              className="h-10 px-5 rounded-[10px] bg-primary text-on-primary text-[14px] font-medium cursor-pointer"
            >
              重新加载
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
