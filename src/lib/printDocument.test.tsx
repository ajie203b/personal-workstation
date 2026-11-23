// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { cleanPrintTitle, useDocumentPrintTitle } from './printDocument'

function Harness({ title }: { title?: string | null }) {
  useDocumentPrintTitle(title)
  return null
}

describe('printDocument', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    document.title = 'Kairos'
    window.history.replaceState(null, '', '/#/local-markdown?file=D%3A%5C%E5%AE%9E%E9%AA%8C%E6%8A%A5%E5%91%8A.md')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
    document.title = 'Kairos'
  })

  it('strips common document extensions for default PDF filename', () => {
    expect(cleanPrintTitle('实验报告.md')).toBe('实验报告')
    expect(cleanPrintTitle('论文终稿.PDF')).toBe('论文终稿')
    expect(cleanPrintTitle('notes.v2.docx')).toBe('notes.v2')
    expect(cleanPrintTitle('   ')).toBe('Kairos')
    expect(cleanPrintTitle(undefined)).toBe('Kairos')
  })

  it('sets document.title to original filename and masks/restores encoded URL on print', () => {
    act(() => { root.render(<Harness title="实验报告.md" />) })
    expect(document.title).toBe('实验报告')

    act(() => { window.dispatchEvent(new Event('beforeprint')) })
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')

    act(() => { window.dispatchEvent(new Event('afterprint')) })
    expect(window.location.hash).toBe('#/local-markdown?file=D%3A%5C%E5%AE%9E%E9%AA%8C%E6%8A%A5%E5%91%8A.md')

    act(() => { root.unmount() })
    expect(document.title).toBe('Kairos')
  })
})
