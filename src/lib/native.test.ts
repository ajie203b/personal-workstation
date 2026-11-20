// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initAndroidBackButton } from './native'

const { listen, exitApp } = vi.hoisted(() => ({
  listen: vi.fn<(name: string, listener: (event: { canGoBack: boolean }) => void) => void>(),
  exitApp: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: listen, exitApp } }))

beforeEach(async () => {
  vi.clearAllMocks()
  // jsdom 无布局引擎；这里的面板均已挂载且可见。
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 320, 200)] as unknown as DOMRectList)
  await initAndroidBackButton()
})
afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const pressBack = () => listen.mock.calls[0][1]({ canGoBack: false })

it('先将返回交给嵌套日期面板，再关闭外层表单', () => {
  document.body.innerHTML = '<div role="dialog"><button aria-label="关闭"></button><div role="dialog" id="date"></div></div>'
  const closeForm = vi.fn()
  document.querySelector('button')!.addEventListener('click', closeForm)
  const date = document.getElementById('date')!
  date.addEventListener('keydown', event => { if (event.key === 'Escape') date.remove() })
  pressBack()
  expect(date.isConnected).toBe(false)
  expect(closeForm).not.toHaveBeenCalled()
  pressBack()
  expect(closeForm).toHaveBeenCalledOnce()
  expect(exitApp).not.toHaveBeenCalled()
})

it('独立下拉菜单消费一次返回，菜单关掉后继续原有导航', () => {
  document.body.innerHTML = '<div role="menu" data-state="open"></div>'
  const menu = document.body.firstElementChild!
  menu.addEventListener('keydown', () => menu.remove())
  pressBack()
  expect(menu.isConnected).toBe(false)
  expect(exitApp).not.toHaveBeenCalled()
  pressBack()
  expect(exitApp).toHaveBeenCalledOnce()
})
