// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { ToolsPage } from './ToolsPage'
import { TOOL_CATALOG } from './toolCatalog'

describe('ToolsPage 排行榜置顶硬性规则', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // jsdom 无 ResizeObserver，给 Segmented 补最小桩实现
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
  })

  it('排行榜不属于 TOOL_CATALOG，且始终置顶于「小工具」目录之前', () => {
    expect(TOOL_CATALOG.some((t) => t.title.includes('排行') || t.to.includes('intel'))).toBe(false)

    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/tools']}>
          <ToolsPage />
        </MemoryRouter>,
      )
    })

    const leaderboard = host.querySelector<HTMLElement>('[data-pinned-leaderboard="true"]')
    const directory = host.querySelector<HTMLElement>('[data-tool-directory="true"]')
    expect(leaderboard).not.toBeNull()
    expect(directory).not.toBeNull()

    // 排行榜必须在 DOM 顺序上严格位于「小工具」之前，且不被包含在「小工具」目录中
    expect(directory!.contains(leaderboard!)).toBe(false)
    expect(leaderboard!.compareDocumentPosition(directory!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(leaderboard!.hasAttribute('data-sortable')).toBe(false)

    // 切换分类筛选（如「效率」）只筛选小工具，置顶排行榜始终留在顶部
    const utilityTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((b) => b.textContent?.includes('效率'))
    expect(utilityTab).toBeDefined()
    act(() => { utilityTab!.click() })

    const leaderboardAfter = host.querySelector<HTMLElement>('[data-pinned-leaderboard="true"]')
    const directoryAfter = host.querySelector<HTMLElement>('[data-tool-directory="true"]')
    expect(leaderboardAfter).not.toBeNull()
    expect(directoryAfter!.contains(leaderboardAfter!)).toBe(false)
    expect(leaderboardAfter!.compareDocumentPosition(directoryAfter!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
