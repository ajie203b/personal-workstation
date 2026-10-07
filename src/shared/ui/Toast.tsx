import { useUi } from '@/stores/ui'
import { X } from 'lucide-react'

/** 轻提示：底部居中（手机）/ 右下角（桌面），支持「撤销」动作按钮 */
export function ToastHost() {
  const { toasts, dismissToast } = useUi()
  if (!toasts.length) return null
  return (
    <div className="fixed z-[60] bottom-[calc(3.5rem+env(safe-area-inset-bottom)+12px)] md:bottom-6 inset-x-0 px-4 flex flex-col items-center gap-2 md:items-end md:right-5 md:left-auto pointer-events-none md:max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-[16px] shadow-lg max-w-full md:max-w-sm"
          style={{ background: 'var(--surface)', color: 'var(--on-surface)', border: '1px solid var(--outline)', boxShadow: 'var(--shadow-pop)', animation: 'fade-up var(--dur-2) var(--ease-spring)' }}
        >
          <span className="text-[13px]">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="text-[13px] font-semibold px-2 py-1 rounded-lg hover:bg-white/10 shrink-0"
              style={{ color: 'var(--primary)', fontWeight: 600 }}
              onClick={() => {
                t.action!.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="关闭提示"
            className="opacity-50 hover:opacity-100 p-1.5 rounded-lg"
            onClick={() => dismissToast(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
