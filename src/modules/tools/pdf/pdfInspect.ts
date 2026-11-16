import { PDFDocument } from 'pdf-lib'
import { hasEncryptEntry, hasPdfEncryptMarker, validatePdfBytes } from './qpdfTypes'

export interface PdfInspection {
  encrypted: boolean
  /** 仅在未加密且解析成功时提供，避免在未解锁的 `/ObjStm` 加密文档上调用 `getPageCount()` 报错。 */
  doc?: PDFDocument
}

/**
 * 稳健检测 PDF 是否加密：
 * 1) 先扫描 trailer / XRef 字典的 `/Encrypt` 标记，防止 `pdf-lib` 解析加密 `/ObjStm` 时抛出 `Expected instance of ...`；
 * 2) 再以 `ignoreEncryption: true` 加载并检查 `doc.isEncrypted` 或异常特征；
 * 3) 对确认加密的文档绝不调用 `getPageCount()`。
 */
export async function inspectPdfEncryption(bytes: Uint8Array): Promise<PdfInspection> {
  validatePdfBytes(bytes)
  if (hasPdfEncryptMarker(bytes)) {
    return { encrypted: true }
  }
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    if (doc.isEncrypted) return { encrypted: true }
    return { encrypted: false, doc }
  } catch (error) {
    if ((error instanceof Error && /encrypted/i.test(error.message)) || hasEncryptEntry(bytes)) {
      return { encrypted: true }
    }
    throw error
  }
}
