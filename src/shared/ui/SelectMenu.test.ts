// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SelectMenu, type SelectMenuOption } from './SelectMenu'

// Radix 浮层（popper）依赖 ResizeObserver / PointerEvent，jsdom 里没有，垫一层
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function firePointerDown(el: Element) {
  // Radix Trigger 判定 event.button === 0 且 ctrlKey === false，字段要给全
  const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ctrlKey: false })
  Object.assign(ev, { pointerId: 1, pointerType: 'touch' })
  el.dispatchEvent(ev)
}

const options: SelectMenuOption[] = [
  { value: 'today', label: '今日（1）' },
  { value: 'upcoming', label: '近期（1）' },
  { value: 'logbook', label: '日志（8）' },
]

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

function renderSelect(onChange = vi.fn()) {
  act(() =>
    root.render(
      createElement(SelectMenu, {
        value: 'today',
        onChange,
        options,
        ariaLabel: '切换清单',
        title: '切换清单',
      }),
    ),
  )
  return onChange
}

describe('SelectMenu', () => {
  it('触发按钮显示当前选项，不渲染原生 select', () => {
    renderSelect()
    expect(container.querySelector('select')).toBeNull()
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="切换清单"]')
    expect(trigger?.textContent).toContain('今日（1）')
  })

  it('展开后列出全部选项，当前项是选中态', () => {
    renderSelect()
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="切换清单"]')!
    act(() => firePointerDown(trigger))
    const items = document.querySelectorAll('[role="menuitemradio"]')
    expect(items.length).toBe(3)
    expect(items[0].getAttribute('data-state')).toBe('checked')
    expect(items[1].getAttribute('data-state')).toBe('unchecked')
  })

  it('点选一项回调 onChange 并带上该项的值', () => {
    const onChange = renderSelect()
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="切换清单"]')!
    act(() => firePointerDown(trigger))
    const target = document.querySelectorAll('[role="menuitemradio"]')[2]
    act(() => (target as HTMLElement).click())
    expect(onChange).toHaveBeenCalledWith('logbook')
  })
})
