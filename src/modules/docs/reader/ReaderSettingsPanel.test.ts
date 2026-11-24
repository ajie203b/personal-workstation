// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ReaderSettingsPanel } from './ReaderSettingsPanel'

it('opens settings outside the clipped header and provides an explicit close control', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  const header = document.createElement('header')
  header.style.overflow = 'hidden'
  document.body.appendChild(header)
  const root = createRoot(header)
  const onClose = vi.fn()
  try {
    act(() => root.render(createElement(ReaderSettingsPanel, {
      doc: { kind: 'docx' },
      settings: { theme: 'day', fontSize: 17, leading: 1.85, widthPct: 72 },
      updateSettings: vi.fn(), onClose, onResetLayout: vi.fn(),
    })))
    const panel = document.querySelector('[role="dialog"][aria-label="排版设置"]')
    expect(panel).not.toBeNull()
    expect(header.contains(panel)).toBe(false)
    const close = panel?.querySelector<HTMLButtonElement>('button[aria-label="关闭排版设置"]')
    expect(close).not.toBeNull()
    act(() => close!.click())
    expect(onClose).toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
    header.remove()
    vi.unstubAllGlobals()
  }
})

it('applies one-click width presets including full 100% width', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const updateSettings = vi.fn()
  try {
    act(() => root.render(createElement(ReaderSettingsPanel, {
      doc: { kind: 'docx' },
      settings: { theme: 'day', fontSize: 17, leading: 1.85, widthPct: 80 },
      updateSettings, onClose: vi.fn(), onResetLayout: vi.fn(),
    })))
    const group = document.querySelector('[role="group"][aria-label="正文宽度预设"]')!
    expect(group).not.toBeNull()
    const fullBtn = Array.from(group.querySelectorAll('button')).find((b) => b.textContent === '铺满')!
    const focusBtn = Array.from(group.querySelectorAll('button')).find((b) => b.textContent === '专注')!
    act(() => fullBtn.click())
    expect(updateSettings).toHaveBeenCalledWith({ widthPct: 100 }, true)
    act(() => focusBtn.click())
    expect(updateSettings).toHaveBeenCalledWith({ widthPct: 62 }, true)
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})
