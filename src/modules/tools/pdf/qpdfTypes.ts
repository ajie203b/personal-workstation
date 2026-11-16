export type CompressionPreset = 'lossless' | 'balanced' | 'small'

export type PdfJob =
  | { kind: 'compress'; preset: CompressionPreset; password?: string }
  | { kind: 'encrypt'; password: string; ownerPassword: string; inputPassword?: string; allowPrint: boolean; allowCopy: boolean; allowModify: boolean }
  | { kind: 'decrypt'; password: string }

export interface PdfJobResult {
  bytes: Uint8Array
  originalSize: number
  outputSize: number
  usedOriginal: boolean
  warnings: boolean
}

export interface PdfProgress { percent: number; label: string }

const CHUNK_SIZE = 512 * 1024
const CHUNK_OVERLAP = 16 * 1024
const ENCRYPT_TRAILER_RE = /trailer\s*<<(?:(?!startxref)[\s\S]){0,8192}?\/Encrypt(?=\s*(?:\d+\s+\d+\s+R\b|<<))/
const ENCRYPT_XREF_BEFORE_RE = /\/Type\s*\/XRef(?:(?!endobj|\bstream\b)[\s\S]){0,4096}?\/Encrypt(?=\s*(?:\d+\s+\d+\s+R\b|<<))/
const ENCRYPT_XREF_AFTER_RE = /\/Encrypt(?=\s*(?:\d+\s+\d+\s+R\b|<<))(?:(?!endobj|\bstream\b)[\s\S]){0,4096}?\/Type\s*\/XRef/
const ENCRYPT_ANY_RE = /\/Encrypt(?=\s*(?:\d+\s+\d+\s+R\b|<<))/

function scanPdfLatin1(bytes: Uint8Array, predicate: (chunk: string) => boolean): boolean {
  const decoder = new TextDecoder('latin1')
  if (bytes.length <= CHUNK_SIZE) return predicate(decoder.decode(bytes))
  if (predicate(decoder.decode(bytes.subarray(bytes.length - CHUNK_SIZE)))) return true
  const step = CHUNK_SIZE - CHUNK_OVERLAP
  for (let offset = 0; offset < bytes.length - CHUNK_SIZE; offset += step) {
    const end = Math.min(bytes.length, offset + CHUNK_SIZE)
    if (predicate(decoder.decode(bytes.subarray(offset, end)))) return true
  }
  return false
}

/** 扫描 trailer / XRef 字典中的 `/Encrypt` 引用，先于 pdf-lib 解析识别加密 PDF（含 `/ObjStm`）。 */
export function hasPdfEncryptMarker(bytes: Uint8Array): boolean {
  return scanPdfLatin1(
    bytes,
    chunk => ENCRYPT_TRAILER_RE.test(chunk) || ENCRYPT_XREF_BEFORE_RE.test(chunk) || ENCRYPT_XREF_AFTER_RE.test(chunk),
  )
}

/** 当 pdf-lib 解析异常时兜底检测原始字节是否含 `/Encrypt` 字典条目。 */
export function hasEncryptEntry(bytes: Uint8Array): boolean {
  return scanPdfLatin1(bytes, chunk => ENCRYPT_ANY_RE.test(chunk))
}

export function validatePdfBytes(bytes: Uint8Array): void {
  if (!bytes.length) throw new Error('文件为空，请重新选择 PDF')
  if (!new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('文件内容不是 PDF，请检查格式')
}

export function validatePdfPassword(password: string): void {
  if (!password.length) throw new Error('请输入密码')
  if (password.includes('\0')) throw new Error('密码不能包含空字符')
  if (new TextEncoder().encode(password).length > 127) throw new Error('密码过长，请控制在 127 个 UTF-8 字节以内')
}

/** 参数仅传给 WASM 内的 qpdf，不拼接 shell。密码始终作为带前缀的参数，避免 @file 被解释。 */
export function qpdfArguments(job: PdfJob): string[] {
  const args = ['/input.pdf', '--warning-exit-0', '--progress']
  if (job.kind === 'encrypt') {
    if (job.password.length) validatePdfPassword(job.password)
    validatePdfPassword(job.ownerPassword)
    if (job.password === job.ownerPassword) throw new Error('管理密码应与打开密码不同')
    if (job.inputPassword !== undefined) args.push(`--password=${job.inputPassword}`)
    args.push('--encrypt', `--user-password=${job.password}`, `--owner-password=${job.ownerPassword}`, '--bits=256',
      `--print=${job.allowPrint ? 'full' : 'none'}`, `--extract=${job.allowCopy ? 'y' : 'n'}`, `--modify=${job.allowModify ? 'all' : 'none'}`, '--')
  } else if (job.kind === 'decrypt') {
    if (job.password.length) validatePdfPassword(job.password)
    args.push(`--password=${job.password}`, '--decrypt')
  } else {
    if (!['lossless', 'balanced', 'small'].includes(job.preset)) throw new Error('压缩模式无效')
    if (job.password !== undefined) args.push(`--password=${job.password}`)
    args.push('--object-streams=generate', '--compress-streams=y', '--decode-level=generalized', '--recompress-flate', '--compression-level=9')
    if (job.preset !== 'lossless') args.push('--optimize-images', `--jpeg-quality=${job.preset === 'balanced' ? 82 : 55}`)
  }
  args.push('/output.pdf')
  return args
}

export function qpdfErrorMessage(logs: string): string {
  if (/invalid password|incorrect password/i.test(logs)) return '密码不正确，请重新输入'
  if (/out of memory|memory access|cannot enlarge|allocation/i.test(logs)) return '设备内存不足，请减少文件大小或分段处理'
  return '无法处理这份 PDF，请确认文件完整且密码正确'
}
