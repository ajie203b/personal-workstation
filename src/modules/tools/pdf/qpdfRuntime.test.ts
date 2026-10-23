import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib'
import { executeQpdf } from './qpdfRuntime'
import { qpdfArguments, validatePdfPassword, type PdfJob } from './qpdfTypes'
import createModule from '@neslinesli93/qpdf-wasm'

const require = createRequire(import.meta.url)
let diagnostics = ''
beforeEach(() => {
  diagnostics = ''
  vi.spyOn(console, 'log').mockImplementation((...args) => { diagnostics += args.join(' ') })
  vi.spyOn(console, 'error').mockImplementation((...args) => { diagnostics += args.join(' ') })
})
afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0 })

async function run(bytes: Uint8Array, job: PdfJob) {
  diagnostics = ''
  return executeQpdf(bytes, job, {
    wasmUrl: require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm'),
    diagnostics: () => diagnostics,
  })
}
async function source() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([300, 400]).drawText('PDF toolkit round trip', { x: 20, y: 200, font })
  doc.addPage([400, 300])
  doc.getForm().createTextField('name').setText('Alice')
  return doc.save({ useObjectStreams: false })
}
const encryptJob: PdfJob = { kind: 'encrypt', password: '测试 secret! @-123', ownerPassword: 'owner-unique-987', allowCopy: false, allowPrint: true, allowModify: false }

describe('真实 qpdf WASM', () => {
  it('只有权限限制、无需打开密码的 PDF 可用空密码解锁', async () => {
    const engine = await createModule({ locateFile: () => require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm') })
    const fs = engine.FS as typeof engine.FS & { writeFile: (path: string, bytes: Uint8Array) => void }
    fs.writeFile('/in.pdf', await source())
    expect(engine.callMain(['/in.pdf', '--encrypt', '--user-password=', '--owner-password=owner-private', '--bits=256', '--print=none', '--', '/out.pdf'])).toBe(0)
    const result = await run(fs.readFile('/out.pdf').slice(), { kind: 'decrypt', password: '' })
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(2)
  })
  it('AES-256 加密、错误密码拒绝、正确密码解密后保留页面及表单', async () => {
    const input = await source()
    const encrypted = await run(input, encryptJob)
    const protectedDoc = await PDFDocument.load(encrypted.bytes, { ignoreEncryption: true })
    const dict = protectedDoc.context.lookup(protectedDoc.context.trailerInfo.Encrypt, PDFDict)
    expect(dict.lookup(PDFName.of('Length'), PDFNumber).asNumber()).toBe(256)
    expect(dict.lookup(PDFName.of('R'), PDFNumber).asNumber()).toBe(6)
    await expect(PDFDocument.load(encrypted.bytes)).rejects.toThrow(/encrypted/i)
    await expect(run(encrypted.bytes, { kind: 'decrypt', password: 'wrong' })).rejects.toThrow('密码不正确')
    const unlocked = await run(encrypted.bytes, { kind: 'decrypt', password: encryptJob.password })
    const doc = await PDFDocument.load(unlocked.bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPages().map(p => p.getSize())).toEqual([{ width: 300, height: 400 }, { width: 400, height: 300 }])
    expect(doc.getForm().getTextField('name').getText()).toBe('Alice')
  })
  it.each(['lossless', 'balanced', 'small'] as const)('%s 压缩保持页数、可读且不会输出更大的文件', async preset => {
    const input = await source()
    const result = await run(input, { kind: 'compress', preset })
    expect(result.outputSize).toBeLessThanOrEqual(input.length)
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(2)
    const again = await run(result.bytes, { kind: 'compress', preset })
    expect(again.outputSize).toBeLessThanOrEqual(result.outputSize)
  })
  it('损坏与伪 PDF 不生成假成功结果', async () => {
    await expect(run(new Uint8Array(), { kind: 'compress', preset: 'lossless' })).rejects.toThrow('文件为空')
    await expect(run(new TextEncoder().encode('not pdf'), { kind: 'compress', preset: 'lossless' })).rejects.toThrow('不是 PDF')
    await expect(run(new TextEncoder().encode('%PDF-1.7\ncorrupted'), { kind: 'decrypt', password: 'test' })).rejects.toThrow('无法处理')
  })
})

it('密码校验与参数边界，包含 @ 前缀和特殊字符仍是一个参数', () => {
  expect(() => validatePdfPassword('')).toThrow('请输入密码')
  expect(() => validatePdfPassword('x\0y')).toThrow('空字符')
  expect(() => validatePdfPassword('中'.repeat(43))).toThrow('密码过长')
  expect(qpdfArguments({ ...encryptJob, password: '@--test=中文' })).toContain('--user-password=@--test=中文')
})
