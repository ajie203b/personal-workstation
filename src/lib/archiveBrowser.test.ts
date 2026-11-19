// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

const { invoke, nativeSaveToLocal, nativeFile } = vi.hoisted(() => ({
  invoke: vi.fn(),
  nativeSaveToLocal: vi.fn(),
  nativeFile: vi.fn(),
}))

let tauriMode = true

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { convertFileSrc: (uri: string) => uri },
  registerPlugin: () => ({
    open: vi.fn(),
    list: vi.fn(),
    file: nativeFile,
    saveToLocal: nativeSaveToLocal,
    remove: vi.fn(),
  }),
}))
vi.mock('./native', () => ({ isTauri: () => tauriMode }))

import {
  archiveFileExt,
  canImportArchiveBook,
  readArchiveDownload,
  saveArchiveDownloadToLocal,
} from './archiveBrowser'

describe('archiveBrowser helpers', () => {
  it('extracts lowercase extensions and classifies Kairos-importable formats', () => {
    expect(archiveFileExt('知乎 5000 斩!!【卷三】.mobi')).toBe('mobi')
    expect(archiveFileExt('Book.AZW3')).toBe('azw3')
    expect(archiveFileExt('文档.EPUB')).toBe('epub')
    expect(archiveFileExt('论文.pdf')).toBe('pdf')
    expect(archiveFileExt('无扩展名')).toBe('')

    for (const name of ['a.epub', 'b.pdf', 'c.txt', 'd.md', 'e.markdown', 'f.docx', 'g.pptx']) {
      expect(canImportArchiveBook(name)).toBe(true)
    }
    for (const name of ['a.mobi', 'b.azw3', 'c.djvu', 'd.fb2', 'e.zip', 'f.cbr', 'g.cbz']) {
      expect(canImportArchiveBook(name)).toBe(false)
    }
  })

  it('reads and validates multiple importable formats while rejecting HTML error pages', async () => {
    tauriMode = true
    const pdfBytes = new TextEncoder().encode('%PDF-1.7\nbody')
    invoke.mockResolvedValueOnce(pdfBytes.buffer)
    const pdfFile = await readArchiveDownload({ id: '1', name: 'demo.pdf', size: pdfBytes.byteLength })
    expect(pdfFile.type).toBe('application/pdf')

    const txtBytes = new TextEncoder().encode('第一章 开篇')
    invoke.mockResolvedValueOnce(txtBytes.buffer)
    const txtFile = await readArchiveDownload({ id: '2', name: 'novel.txt', size: txtBytes.byteLength })
    expect(txtFile.type).toContain('text/plain')

    const htmlBytes = new TextEncoder().encode('<!DOCTYPE html><html><body>blocked</body></html>')
    invoke.mockResolvedValueOnce(htmlBytes.buffer)
    await expect(readArchiveDownload({ id: '3', name: 'bad.txt', size: htmlBytes.byteLength })).rejects.toThrow('下载内容与文件格式不符')
  })

  it('routes saveArchiveDownloadToLocal to Tauri or Android plugin', async () => {
    tauriMode = true
    invoke.mockResolvedValueOnce('C:\\Users\\demo\\Downloads\\book.mobi')
    await expect(saveArchiveDownloadToLocal({ id: '10', name: 'book.mobi', size: 123 })).resolves.toBe('C:\\Users\\demo\\Downloads\\book.mobi')
    expect(invoke).toHaveBeenCalledWith('archive_download_save_local', { id: '10' })

    tauriMode = false
    nativeSaveToLocal.mockResolvedValueOnce({ path: 'Download/个人工作站/book.mobi' })
    await expect(saveArchiveDownloadToLocal({ id: '11', name: 'book.mobi', size: 123 })).resolves.toBe('Download/个人工作站/book.mobi')
    expect(nativeSaveToLocal).toHaveBeenCalledWith({ id: '11' })
  })
})
