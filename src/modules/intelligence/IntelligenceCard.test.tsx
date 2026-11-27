// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { db } from '@/db/db'
import { IntelligenceCard } from './IntelligenceCard'

describe('IntelligenceCard 图表/列表双视图交互', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await db.delete()
    await db.open()
    await db.settings.put({
      key: 'intelData',
      value: {
        generatedAt: '2026-04-02T08:00:00Z',
        source: 'artificialanalysis.ai',
        models: [
          { name: 'GPT-5 (high)', score: 72.1 },
          { name: 'Gemini 2.5 Pro', score: 70.5 },
          { name: 'Claude 4.5 Sonnet', score: 68.4 },
          { name: 'DeepSeek R1', score: 66.0 },
        ],
      },
    })
    await db.settings.put({ key: 'intelFetchedAt', value: Date.now() })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ generatedAt: '2026-04-02T08:00:00Z' }), { status: 200 })),
    )
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

  afterEach(async () => {
    await act(async () => { root.unmount() })
    vi.unstubAllGlobals()
    host.remove()
  })

  it('默认展示官方原图，支持切换列表视图、搜索与厂商筛选', async () => {
    await act(async () => {
      root.render(<IntelligenceCard />)
      await new Promise((r) => setTimeout(r, 0))
    })

    const chartBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="榜单视图切换"] button')).find(
      (b) => b.textContent === '图表',
    )!
    const listBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="榜单视图切换"] button')).find(
      (b) => b.textContent === '列表',
    )!
    expect(chartBtn.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('img[alt*="官方原图"]')).not.toBeNull()

    // 切换到「列表」视图
    await act(async () => {
      listBtn.click()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(listBtn.getAttribute('aria-pressed')).toBe('true')
    const items = host.querySelectorAll('ol[aria-label="AI 模型智能排行榜列表"] li')
    expect(items).toHaveLength(4)
    expect(items[0].textContent).toContain('GPT-5 (high)')

    // 点击厂商筛选「Anthropic」，保留原始排名 #3
    const anthropicChip = Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="按厂商筛选模型"] button')).find(
      (b) => b.textContent === 'Anthropic',
    )!
    await act(async () => { anthropicChip.click() })
    const filteredByVendor = host.querySelectorAll('ol[aria-label="AI 模型智能排行榜列表"] li')
    expect(filteredByVendor).toHaveLength(1)
    expect(filteredByVendor[0].textContent).toContain('3')
    expect(filteredByVendor[0].textContent).toContain('Claude 4.5 Sonnet')

    // 重置为全部并按关键词搜索
    const allChip = Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="按厂商筛选模型"] button')).find(
      (b) => b.textContent === '全部',
    )!
    await act(async () => { allChip.click() })
    const input = host.querySelector<HTMLInputElement>('input[aria-label="搜索模型或厂商"]')!
    const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setVal.call(input, 'deepseek')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const filteredBySearch = host.querySelectorAll('ol[aria-label="AI 模型智能排行榜列表"] li')
    expect(filteredBySearch).toHaveLength(1)
    expect(filteredBySearch[0].textContent).toContain('DeepSeek R1')
  })
})
