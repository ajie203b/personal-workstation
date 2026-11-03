// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TimePicker } from './TimePicker'

it('Escape 只关闭时间选择器，不触发外层弹窗关闭，并恢复焦点', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  const outerEscape = vi.fn()
  document.addEventListener('keydown', outerEscape, true)
  try {
    act(() => root.render(createElement(TimePicker, { onChange: vi.fn() })))
    const trigger = node.querySelector('button')!
    act(() => trigger.click())
    expect(node.querySelector('[role="dialog"]')).not.toBeNull()
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(node.querySelector('[role="dialog"]')).toBeNull()
    expect(outerEscape).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  } finally {
    document.removeEventListener('keydown', outerEscape, true)
    act(() => root.unmount())
    node.remove()
  }
})
