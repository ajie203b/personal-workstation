// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { expect, it, vi } from 'vitest'
import { usePdfFind } from './usePdfFind'

it('切换到命中数量相同的关键词时，直接跳到新命中页', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  const pdf = {
    numPages: 2,
    getPage: async (page: number) => ({
      getTextContent: async () => ({ items: [{ str: page === 1 ? 'alpha' : 'beta' }] }),
    }),
  } as PDFDocumentProxy
  const scroll = document.createElement('div')
  const scrollTo = vi.fn()
  scroll.scrollTo = scrollTo
  const props = {
    data: new Blob(),
    pdfProxyRef: { current: pdf },
    pageTextCacheRef: { current: new Map<number, Promise<string>>() },
    numPages: 2,
    hasPageRatios: true,
    lo: 1,
    hi: 2,
    dispW: 700,
    findActive: 0,
    scrollRef: { current: scroll },
    pageOffsets: [0, 1000],
    pageH: () => 984,
    setCenter: vi.fn(),
  }
  const Reader = ({ query }: { query: string }) => {
    usePdfFind({ ...props, findQuery: query })
    return null
  }

  try {
    await act(async () => root.render(createElement(Reader, { query: 'alpha' })))
    expect(props.setCenter).toHaveBeenCalledExactlyOnceWith(1)
    props.setCenter.mockClear()
    scrollTo.mockClear()

    await act(async () => root.render(createElement(Reader, { query: 'beta' })))
    expect(props.setCenter).toHaveBeenCalledExactlyOnceWith(2)
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 988, behavior: 'smooth' })
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
