// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useUi } from '@/stores/ui'

function LocationProbe() {
  const { pathname } = useLocation()
  return <span data-testid="loc">{pathname}</span>
}

describe('Sidebar & TopBar 品牌展示与全局搜索交互', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useUi.setState({ sidebarCollapsed: false, paletteOpen: false })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
  })

  it('左上角仅显示 Kairos 品牌词且不再出现 Workstation，点击品牌整体回到今日', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/docs']}>
          <Sidebar todayCount={3} />
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      )
    })

    expect(host.textContent).toContain('Kairos')
    expect(host.textContent).not.toContain('Workstation')

    const brandBtn = host.querySelector<HTMLButtonElement>('button[aria-label="回到今日"]')
    expect(brandBtn).not.toBeNull()
    expect(brandBtn!.textContent).toContain('Kairos')

    act(() => { brandBtn!.click() })
    expect(host.querySelector('[data-testid="loc"]')?.textContent).toBe('/today')
  })

  it('侧边栏在展开与折叠态下均提供全局搜索入口，并保留今日待办角标', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/tasks']}>
          <Sidebar todayCount={5} />
        </MemoryRouter>,
      )
    })

    const searchBtn = host.querySelector<HTMLButtonElement>('button[aria-label="搜索与快速跳转"]')
    expect(searchBtn).not.toBeNull()
    act(() => { searchBtn!.click() })
    expect(useUi.getState().paletteOpen).toBe(true)

    act(() => { useUi.setState({ sidebarCollapsed: true, paletteOpen: false }) })
    const tasksLink = host.querySelector<HTMLAnchorElement>('a[aria-label="任务清单"]')
    expect(tasksLink?.textContent).toContain('5')
  })

  it('手机端 TopBar 提供全局搜索入口并保持标题渲染', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/docs']}>
          <TopBar title="文档工作站" />
        </MemoryRouter>,
      )
    })

    expect(host.textContent).toContain('文档工作站')
    const searchBtn = host.querySelector<HTMLButtonElement>('button[aria-label="搜索与快速跳转"]')
    expect(searchBtn).not.toBeNull()
    act(() => { searchBtn!.click() })
    expect(useUi.getState().paletteOpen).toBe(true)
  })
})
