// @vitest-environment jsdom
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocSettings } from '@/db/db'
import { parseFlowDoc } from './flowDoc'
import {
  buildPdfRows,
  canUsePdfSpread,
  computePdfDisplayWidth,
  computePdfFitWidth,
  computePdfLayout,
  computeTrimTransform,
  findRowAtY,
  PDF_TRIM_SCALE,
} from './pdf/pdfLayout'
import { ReaderSettingsPanel } from './reader/ReaderSettingsPanel'

const pageRenderSpy = vi.fn()
const mockPdfProxy = {
  numPages: 3,
  getPage: vi.fn(async () => ({
    getViewport: () => ({ width: 600, height: 800 }),
    getTextContent: async () => ({ items: [{ str: 'Sample page text', hasEOL: false }] }),
  })),
  getOutline: vi.fn(async () => null),
  getDestination: vi.fn(async () => null),
  getPageIndex: vi.fn(async () => 0),
}

vi.mock('@/db/docs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/db/docs')>()
  return {
    ...orig,
    getDocBlob: vi.fn(async () => new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' })),
    saveScrollAndProgress: vi.fn(async () => {}),
  }
})

vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
  Document: ({ children, onLoadSuccess }: { children: React.ReactNode; onLoadSuccess?: (pdf: unknown) => void }) => {
    const called = useRef(false)
    if (!called.current && onLoadSuccess) {
      called.current = true
      queueMicrotask(() => onLoadSuccess(mockPdfProxy))
    }
    return createElement('div', { 'data-testid': 'mock-pdf-document' }, children)
  },
  Page: ({ pageNumber, width, onRenderSuccess, onRenderTextLayerSuccess }: {
    pageNumber: number
    width: number
    onRenderSuccess?: () => void
    onRenderTextLayerSuccess?: () => void
  }) => {
    pageRenderSpy(pageNumber, width, onRenderTextLayerSuccess)
    queueMicrotask(() => onRenderSuccess?.())
    return createElement('div', { 'data-testid': `mock-page-${pageNumber}`, 'data-width': width })
  },
}))

describe('Office / WPS & Performance P1', () => {
  let host: HTMLDivElement
  let root: Root
  let originalMatchMedia: typeof window.matchMedia
  let originalResizeObserver: typeof ResizeObserver

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    pageRenderSpy.mockClear()

    originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia

    originalResizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) { this.cb = cb }
      observe(el: Element) { this.cb([{ target: el } as ResizeObserverEntry], this as unknown as ResizeObserver) }
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    window.matchMedia = originalMatchMedia
    globalThis.ResizeObserver = originalResizeObserver
    vi.useRealTimers()
  })

  it('computes single and two-page spread PDF layout metrics and binary-searches rows', () => {
    expect(canUsePdfSpread(true, 1100, false)).toBe(true)
    expect(canUsePdfSpread(true, 800, false)).toBe(false)
    expect(canUsePdfSpread(true, 1200, true)).toBe(false)
    expect(canUsePdfSpread(false, 1200, false)).toBe(false)

    expect(buildPdfRows(5, false)).toEqual([[1], [2], [3], [4], [5]])
    expect(buildPdfRows(5, true)).toEqual([[1, 2], [3, 4], [5]])

    const singleFit = computePdfFitWidth(1024, false, 90, false)
    const spreadFit = computePdfFitWidth(1024, false, 90, true)
    expect(spreadFit).toBeLessThan(singleFit)
    expect(computePdfDisplayWidth(singleFit, 1)).toBeGreaterThanOrEqual(180)
    expect(computePdfDisplayWidth(singleFit, 10)).toBe(2600)

    const metrics = computePdfLayout(5, [1.5, 1.5, 1.5, 1.5, 1.5], 400, true, 16)
    expect(metrics.rows).toHaveLength(3)
    expect(metrics.pageOffsets[0]).toBe(0)
    expect(metrics.pageOffsets[1]).toBe(0)
    expect(metrics.pageOffsets[2]).toBe(616)
    expect(metrics.pageOffsets[3]).toBe(616)
    expect(metrics.pageOffsets[4]).toBe(1232)
    expect(findRowAtY(metrics.rows, 620)).toBe(1)
    expect(findRowAtY(metrics.rows, 1400)).toBe(2)

    const tf = computeTrimTransform(true, 1.25)
    expect(tf.trimTransform).toBe(`scale(${PDF_TRIM_SCALE})`)
    expect(tf.previewTransform).toBe('scale(1.25)')
    expect(computeTrimTransform(false, 1).trimTransform).toBeUndefined()
    expect(computeTrimTransform(false, 1).previewTransform).toBeUndefined()
  })

  it('supports spread layout, trim scale, clickable page jump, and debounced rasterization in PdfReader', async () => {
    vi.useFakeTimers()
    const { PdfReader } = await import('./PdfReader')
    const scrollEl = { current: null as HTMLDivElement | null }
    const scrollToSpy = vi.fn()
    const baseSettings: DocSettings = {
      theme: 'day',
      fontSize: 17,
      leading: 1.85,
      widthPct: 90,
      zoom: 1,
      pdfSpread: true,
      pdfTrimMargins: true,
    }

    function Harness({ settings }: { settings: DocSettings }) {
      return createElement('div', { style: { width: '1100px', height: '700px' } }, createElement(PdfReader, {
        hash: 'pdf-hash-1',
        settings,
        annotations: [],
        jump: null,
        onSelection: vi.fn(),
        onProgress: vi.fn(),
        onRestored: vi.fn(),
        onLoaded: vi.fn(),
        scrollRef: scrollEl,
        initialTarget: null,
      }))
    }

    // 模拟桌面宽屏 clientWidth = 1100 & scrollTo
    const origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1100 })
    const origScrollTo = Element.prototype.scrollTo
    Element.prototype.scrollTo = scrollToSpy

    try {
      await act(async () => {
        root.render(createElement(Harness, { settings: baseSettings }))
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      // 3 页在双页模式下应排成 2 行：[1, 2] 和 [3]
      const page1Slot = host.querySelector<HTMLElement>('[data-page-slot="1"]')!
      const page2Slot = host.querySelector<HTMLElement>('[data-page-slot="2"]')!
      expect(page1Slot).not.toBeNull()
      expect(page2Slot).not.toBeNull()
      expect(page1Slot.parentElement!.parentElement).toBe(page2Slot.parentElement!.parentElement)

      // 白边裁切应对内层容器施加 scale(1.14)
      const trimBox = page1Slot.firstElementChild as HTMLElement
      expect(trimBox.style.transform).toBe(`scale(${PDF_TRIM_SCALE})`)

      // 测试页码直达跳转输入与翻页按钮
      const jumpInput = host.querySelector<HTMLInputElement>('input[aria-label="跳转页码"]')!
      expect(jumpInput.value).toBe('1')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      await act(async () => {
        jumpInput.focus()
        setter.call(jumpInput, '3')
        jumpInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        jumpInput.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      expect(scrollToSpy).toHaveBeenCalled()
      expect(host.querySelector<HTMLInputElement>('input[aria-label="跳转页码"]')!.value).toBe('3')

      await act(async () => {
        host.querySelector<HTMLButtonElement>('button[aria-label="上一页"]')!.click()
      })
      expect(host.querySelector<HTMLInputElement>('input[aria-label="跳转页码"]')!.value).toBe('2')

      // 测试平滑缩放预览 + 160ms 防抖重光栅化
      const page1El = host.querySelector<HTMLElement>('[data-page="1"]')!
      const initialW = Number(host.querySelector('[data-testid="mock-page-1"]')!.getAttribute('data-width'))
      const onTextLayerReady = pageRenderSpy.mock.calls.filter(([page]) => page === 1).at(-1)?.[2]
      expect(onTextLayerReady).toBeTypeOf('function')
      pageRenderSpy.mockClear()

      await act(async () => {
        onTextLayerReady()
        root.render(createElement(Harness, { settings: { ...baseSettings, zoom: 1.5 } }))
      })
      expect(pageRenderSpy.mock.calls.filter(([page]) => page === 1).at(-1)?.[2]).toBe(onTextLayerReady)
      // 防抖窗口内只用 CSS transform 预览，不立即触发高开销 canvas 重渲染
      expect(page1El.style.transform).toContain('scale(')
      expect(host.querySelector('[data-testid="mock-page-1"]')!.getAttribute('data-width')).toBe(String(initialW))

      await act(async () => {
        vi.advanceTimersByTime(170)
      })
      // 防抖结束后真正按新宽度重光栅化，预览 transform 归零
      const settledW = Number(host.querySelector('[data-testid="mock-page-1"]')!.getAttribute('data-width'))
      expect(settledW).toBeGreaterThan(initialW)
      expect(page1El.style.transform).toBe('')
    } finally {
      if (origClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origClientWidth)
      Element.prototype.scrollTo = origScrollTo
    }
  })

  it('exposes spread and trim margin toggles in ReaderSettingsPanel for PDFs', () => {
    const updateSettings = vi.fn()
    act(() => {
      root.render(createElement(ReaderSettingsPanel, {
        doc: { kind: 'pdf' },
        settings: { theme: 'day', fontSize: 17, leading: 1.85, widthPct: 90, zoom: 1 },
        updateSettings,
        onClose: vi.fn(),
        onResetLayout: vi.fn(),
      }))
    })
    const dialog = document.querySelector('[role="dialog"][aria-label="排版设置"]')!
    const spreadBtn = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '双页')!
    const trimBtn = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '裁切白边')!
    act(() => { spreadBtn.click() })
    expect(updateSettings).toHaveBeenCalledWith({ pdfSpread: true })
    act(() => { trimBtn.click() })
    expect(updateSettings).toHaveBeenCalledWith({ pdfTrimMargins: true })
  })

  it('deterministically revokes every EPUB blob objectURL on FlowDoc.dispose()', async () => {
    const created: string[] = []
    const revoked: string[] = []
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:epub-img-${created.length + 1}`
      created.push(url)
      return url
    })
    URL.revokeObjectURL = vi.fn((u: string) => { revoked.push(u) })

    try {
      const zip = new JSZip()
      zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
      zip.file('OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="pic" href="pic.png" media-type="image/png"/></manifest><spine><itemref idref="ch1"/></spine></package>')
      zip.file('OEBPS/ch1.xhtml', '<html><body><h1>图章</h1><img src="pic.png" alt="图" /></body></html>')
      zip.file('OEBPS/pic.png', new Uint8Array([137, 80, 78, 71]))
      const buf = await zip.generateAsync({ type: 'uint8array' })
      const blob = new Blob([buf.buffer as ArrayBuffer], { type: 'application/epub+zip' })
      const flow = await parseFlowDoc('epub', blob)
      const imgTag = flow.segments[0].html.match(/data-epub-src="([^"]+)"/)?.[1]
      expect(imgTag).toBeTruthy()
      const url = await flow.resolveImage?.(imgTag!)
      expect(url).toBe('blob:epub-img-1')
      expect(created).toEqual(['blob:epub-img-1'])
      flow.dispose?.()
      expect(revoked).toEqual(['blob:epub-img-1'])
    } finally {
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
    }
  })
})
