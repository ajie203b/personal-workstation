import { useEffect } from 'react'
import { useUi, togglePalette } from '@/stores/ui'
import { consumeUndo } from '@/lib/undo'

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

/**
 * 全局键盘流（M1 验收：全键盘完成录入-勾选-归档循环）：
 * - Ctrl/Cmd+K → 命令面板
 * - Ctrl/Cmd+Z → 撤销最近一次可撤销操作（macOS 肌肉记忆）
 * - n /  → 聚焦快速添加（通过自定义事件解耦页面）
 * - ?    → 快捷键帮助
 */
export function GlobalHotkeys() {
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen)
  const toast = useUi((s) => s.toast)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd+K 全局呼出命令面板（输入框内也响应）
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        togglePalette()
        return
      }
      // Ctrl/Cmd+Z 撤销（不拦截输入框内的文本撤销）
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        if (isTyping(e.target) || e.isComposing) return
        const undo = consumeUndo()
        if (undo) {
          e.preventDefault()
          undo.run()
          toast(`已撤销：${undo.label}`)
        }
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target) || e.isComposing) return
      if (e.key === 'n' || e.key === '/') {
        e.preventDefault()
        // 有输入框的页面（任务清单）优先聚焦它；否则直接开全局添加抽屉
        const input = document.getElementById('quick-add-input') as HTMLInputElement | null
        if (input && input.offsetParent !== null) {
          window.dispatchEvent(new CustomEvent('ws:focus-quickadd'))
          input.focus()
        } else {
          useUi.getState().openAddSheet()
        }
      } else if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setShortcutsOpen, toast])
  return null
}
