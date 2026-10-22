// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Sheet'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('共用弹窗的退出入口', () => {
  it('即使内容没有取消按钮，也能通过有名称的关闭按钮退出', () => {
    const onOpenChange = vi.fn()
    act(() => root.render(createElement(Dialog, {
      open: true,
      onOpenChange,
      title: '添加任务',
      children: createElement('input', { 'aria-label': '任务名称' }),
    })))
    const close = document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="关闭"]')
    expect(close).not.toBeNull()
    act(() => close!.click())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
