// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DatePicker } from './DatePicker'

let root: Root
let node: HTMLDivElement
let onChange = vi.fn<(date: string) => void>()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  onChange = vi.fn<(date: string) => void>()
  act(() => root.render(createElement(DatePicker, { value: '2028-01-31', onChange, ariaLabel: '截止日期' })))
})
afterEach(() => { act(() => root.unmount()); node.remove() })
const click = (label: string) => act(() => {
  const button = Array.from(node.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === label || b.textContent === label)
  expect(button, `找不到按钮 ${label}`).toBeTruthy()
  button!.click()
})

it('自绘日历支持月末、闰日，选择后关闭并恢复焦点', () => {
  click('截止日期')
  click('下个月')
  click('2028年2月29日')
  expect(onChange).toHaveBeenCalledWith('2028-02-29')
  expect(node.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('截止日期')
})
it('可跳选年、月，并清空日期', () => {
  click('截止日期')
  click('2028年')
  click('2030年')
  click('12月')
  click('2030年12月25日')
  expect(onChange).toHaveBeenCalledWith('2030-12-25')
  click('截止日期')
  click('清除')
  expect(onChange).toHaveBeenLastCalledWith('')
})
it('Escape 仅关闭日期面板，不提交默认日期', () => {
  click('截止日期')
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(node.querySelector('[role="dialog"]')).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
})
