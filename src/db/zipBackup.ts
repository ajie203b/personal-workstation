import { exportSnapshotParts, importSnapshotObject, type BackupScope, type ImportMode, type ImportResult } from './tasks'
import { validateSnapshot } from './snapshotSchema'

/**
 * 流式 ZIP 备份格式（`.kairos.zip`）：
 * - `manifest.json`：紧凑 JSON 元数据（不含内联 Base64 文档本体，避免 33% 膨胀与巨型字符串峰值内存）
 * - `blobs/<hash>`：原始二进制文档本体（PDF/EPUB/DOCX/图片等已压缩格式用 STORE 零 CPU 打包，纯文本/MD 用 DEFLATE）
 *
 * 导入同时兼容 `.kairos.zip` 与旧版 `.json` 备份，支持恢复前预览计数、合并/覆盖模式与分模块选择性恢复。
 */

const MANIFEST_FILE = 'manifest.json'
const ALREADY_COMPRESSED_RE = /^(?:application\/(?:pdf|zip|epub\+zip|vnd\.openxmlformats-)|image\/(?:jpeg|png|webp|avif|gif)|audio\/|video\/)/i

export interface BackupPreview {
  format: 'zip' | 'json'
  exportedAt?: string
  counts: {
    tasks: number
    docs: number
    blobs: number
    annotations: number
    focusSessions: number
    mathNotes: number
    settings: number
  }
  warnings: string[]
}

async function isZipBlob(blob: Blob): Promise<boolean> {
  if (blob.size < 4) return false
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
  // ZIP local file header magic: PK\x03\x04
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
}

/** 导出 `.kairos.zip` 紧凑二进制备份 */
export async function exportBackupZip(): Promise<Blob> {
  const [{ default: JSZip }, { json, blobs }] = await Promise.all([
    import('jszip'),
    exportSnapshotParts(),
  ])
  // exportSnapshotParts 输出带缩进 JSON，压缩前转为紧凑 JSON 进一步瘦身
  const compactManifest = JSON.stringify(JSON.parse(json))
  const zip = new JSZip()
  zip.file(MANIFEST_FILE, compactManifest, { compression: 'DEFLATE', compressionOptions: { level: 6 } })
  for (const item of blobs) {
    const store = ALREADY_COMPRESSED_RE.test(item.type)
    zip.file(`blobs/${item.hash}`, item.blob, { compression: store ? 'STORE' : 'DEFLATE' })
  }
  return zip.generateAsync({ type: 'blob' })
}

async function parseBackupBlob(blob: Blob): Promise<{ format: 'zip' | 'json'; raw: Record<string, unknown> }> {
  if (await isZipBlob(blob)) {
    const JSZip = (await import('jszip')).default
    let zip: InstanceType<typeof JSZip>
    try {
      zip = await JSZip.loadAsync(await blob.arrayBuffer())
    } catch {
      throw new Error('ZIP 备份文件已损坏或无法解压')
    }
    const manifestEntry = zip.file(MANIFEST_FILE)
    if (!manifestEntry) throw new Error('ZIP 中缺少 manifest.json，不是有效的 Kairos 备份')
    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(await manifestEntry.async('string')) as Record<string, unknown>
    } catch {
      throw new Error('备份里的 manifest.json 格式损坏')
    }
    const metaList = Array.isArray(manifest.blobMeta)
      ? (manifest.blobMeta as { hash?: string; type?: string }[])
      : []
    const blobRows: { hash: string; type: string; blob: Blob }[] = []
    for (const meta of metaList) {
      if (!meta || typeof meta.hash !== 'string' || !meta.hash) continue
      const entry = zip.file(`blobs/${meta.hash}`)
      if (!entry) continue
      const bytes = await entry.async('uint8array')
      const type = typeof meta.type === 'string' && meta.type ? meta.type : 'application/octet-stream'
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      blobRows.push({ hash: meta.hash, type, blob: new Blob([copy], { type }) })
    }
    return {
      format: 'zip',
      raw: { ...manifest, blobRows },
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await blob.text())
  } catch {
    throw new Error('文件不是合法的 Kairos ZIP 或 JSON 备份')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('备份文件结构无效')
  }
  return { format: 'json', raw: parsed as Record<string, unknown> }
}

/** 预览备份文件（不写库）：供设置页恢复弹窗展示内容统计与校验提示 */
export async function inspectBackupFile(blob: Blob): Promise<BackupPreview> {
  const { format, raw } = await parseBackupBlob(blob)
  const { data, warnings } = validateSnapshot(raw)
  const len = (k: string) => (Array.isArray(data[k]) ? (data[k] as unknown[]).length : 0)
  return {
    format,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : undefined,
    counts: {
      tasks: len('tasks'),
      docs: len('docs'),
      blobs: len('blobRows'),
      annotations: len('annotations'),
      focusSessions: len('focusSessions'),
      mathNotes: len('mathNotes'),
      settings: len('settings'),
    },
    warnings,
  }
}

/** 导入 `.kairos.zip` 或 `.json` 备份，支持合并/覆盖与分模块选择性恢复 */
export async function importBackupFile(
  blob: Blob,
  opts: { mode?: ImportMode; scopes?: readonly BackupScope[] } = {},
): Promise<ImportResult> {
  const { raw } = await parseBackupBlob(blob)
  return importSnapshotObject(raw, opts.mode ?? 'merge', opts.scopes)
}
