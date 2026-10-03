import { useEffect } from 'react'
import { useUi, togglePalette } from '@/stores/ui'

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

/**
 * 全局键盘流（M1 验收：全键盘完成录入-勾选-归档循环）：
 * - Ctrl/Cmd+K → 命令面板
 * - n /  → 聚焦快速添加（通过自定义事件解耦页面）
 * - ?    → 快捷键帮助
 */
export function GlobalHotkeys() {
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd+K 全局呼出命令面板（输入框内也响应）
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        togglePalette()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target) || e.isComposing) return
      if (e.key === 'n' || e.key === '/') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('ws:focus-quickadd'))
      } else if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setShortcutsOpen])
  return null
}
