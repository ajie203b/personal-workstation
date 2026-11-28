import { db } from '@/db/db'
import { deleteModel, inspectCachedModelEntries } from './modelCache'

/**
 * 统一「本地 AI 模型中心」与「存储空间诊断/清理」（Phase 3）：
 * - 汇总 3 套本地 AI 模型（PP-OCRv4 / MODNet 证件照 / Pix2Text 手写公式）的缓存状态、大小与单项清理
 * - 分模块统计 IndexedDB 空间占用（文档本体、回收站、孤儿附件、全文索引、番茄书架、手写笔记、旧 AI 残表）
 * - 提供事务安全的清理工具（孤儿附件清理、彻底清空回收站、清理历史 AI 残表）
 */

export type ModelSuiteId = 'ocr' | 'idphoto' | 'mathnotes'

export interface ModelSuiteSpec {
  id: ModelSuiteId
  name: string
  desc: string
  approxMb: number
  route: string
  files: readonly { id: string; version: string }[]
}

export const MODEL_SUITES: readonly ModelSuiteSpec[] = [
  {
    id: 'ocr',
    name: '本地 OCR（PP-OCRv4 Mobile）',
    desc: '拍照/截图文字识别与 PDF 区域识图共用模型',
    approxMb: 16,
    route: '/tools/ocr',
    files: [
      { id: 'ppocr-v4-det-mobile', version: '2025.06.01' },
      { id: 'ppocr-v4-rec-mobile', version: '2025.06.01' },
      { id: 'ppocr-keys-v1', version: 'release/2.7' },
    ],
  },
  {
    id: 'idphoto',
    name: '证件照人像抠图（MODNet）',
    desc: '发丝级本地人像抠图与换底色模型',
    approxMb: 25,
    route: '/tools/idphoto',
    files: [
      { id: 'modnet-portrait-matting', version: '2025-05-16' },
    ],
  },
  {
    id: 'mathnotes',
    name: '手写公式识别（Pix2Text MFR 1.5）',
    desc: '手写算式与 LaTeX 识别引擎（编码器 + 解码器）',
    approxMb: 120,
    route: '/tools/math-notes',
    files: [
      { id: 'pix2text-mfr-1.5/encoder_model.onnx', version: '1cef9f0bdcd6a4c63df7de1311fb0894593340cc' },
      { id: 'pix2text-mfr-1.5/decoder_model.onnx', version: '1cef9f0bdcd6a4c63df7de1311fb0894593340cc' },
      { id: 'pix2text-mfr-1.5/tokenizer.json', version: '1cef9f0bdcd6a4c63df7de1311fb0894593340cc' },
    ],
  },
] as const

export interface ModelSuiteStatus extends ModelSuiteSpec {
  cachedCount: number
  totalCount: number
  bytes: number
  state: 'ready' | 'partial' | 'empty'
}

export async function inspectModelSuites(): Promise<ModelSuiteStatus[]> {
  return Promise.all(
    MODEL_SUITES.map(async (suite) => {
      const info = await inspectCachedModelEntries(suite.files)
      const state: ModelSuiteStatus['state'] =
        info.cachedCount === 0 ? 'empty' : info.cachedCount >= info.totalCount ? 'ready' : 'partial'
      return { ...suite, ...info, state }
    }),
  )
}

export async function clearModelSuite(suiteId: ModelSuiteId): Promise<void> {
  const suite = MODEL_SUITES.find((s) => s.id === suiteId)
  if (!suite) return
  for (const f of suite.files) {
    await deleteModel(f.id, f.version)
  }
}

export interface StorageBreakdown {
  activeDocCount: number
  activeBlobBytes: number
  trashDocCount: number
  trashBlobBytes: number
  orphanBlobCount: number
  orphanBlobBytes: number
  docTextCount: number
  docTextBytes: number
  fanqieBookCount: number
  fanqieChapterCount: number
  fanqieBytes: number
  mathNoteCount: number
  mathNoteBytes: number
  legacyAiCount: number
  totalBytes: number
}

function approxJsonBytes(v: unknown): number {
  try {
    return JSON.stringify(v).length * 2
  } catch {
    return 0
  }
}

export async function scanStorageBreakdown(): Promise<StorageBreakdown> {
  return db.transaction(
    'r',
    [
      db.docs,
      db.blobs,
      db.docText,
      db.fanqieBooks,
      db.fanqieChapters,
      db.mathNotes,
      db.aiProviders,
      db.aiSessions,
      db.aiMessages,
      db.aiUsage,
    ],
    async () => {
      const [
        docs,
        blobs,
        docTexts,
        fanqieBooks,
        fanqieChapters,
        mathNotes,
        aiProvidersCount,
        aiSessionsCount,
        aiMessagesCount,
        aiUsageCount,
      ] = await Promise.all([
        db.docs.toArray(),
        db.blobs.toArray(),
        db.docText.toArray(),
        db.fanqieBooks.toArray(),
        db.fanqieChapters.toArray(),
        db.mathNotes.toArray(),
        db.aiProviders.count(),
        db.aiSessions.count(),
        db.aiMessages.count(),
        db.aiUsage.count(),
      ])

      const activeHashes = new Set<string>()
      const trashHashes = new Set<string>()
      let activeDocCount = 0
      let trashDocCount = 0
      for (const d of docs) {
        if (d.deletedAt) {
          trashDocCount += 1
          trashHashes.add(d.hash)
        } else {
          activeDocCount += 1
          activeHashes.add(d.hash)
        }
      }

      let activeBlobBytes = 0
      let trashBlobBytes = 0
      let orphanBlobCount = 0
      let orphanBlobBytes = 0
      for (const b of blobs) {
        const size = b.blob?.size ?? 0
        if (activeHashes.has(b.hash)) {
          activeBlobBytes += size
        } else if (trashHashes.has(b.hash)) {
          trashBlobBytes += size
        } else {
          orphanBlobCount += 1
          orphanBlobBytes += size
        }
      }

      let docTextBytes = 0
      for (const row of docTexts) {
        docTextBytes += (row.text?.length ?? 0) * 2
        if (row.segments) {
          for (const seg of row.segments) docTextBytes += seg.length * 2
        }
      }

      let fanqieBytes = 0
      for (const b of fanqieBooks) fanqieBytes += approxJsonBytes(b)
      for (const c of fanqieChapters) fanqieBytes += (c.content?.length ?? 0) * 2 + (c.title?.length ?? 0) * 2

      let mathNoteBytes = 0
      for (const n of mathNotes) mathNoteBytes += approxJsonBytes(n)

      const legacyAiCount = aiProvidersCount + aiSessionsCount + aiMessagesCount + aiUsageCount
      const totalBytes =
        activeBlobBytes + trashBlobBytes + orphanBlobBytes + docTextBytes + fanqieBytes + mathNoteBytes

      return {
        activeDocCount,
        activeBlobBytes,
        trashDocCount,
        trashBlobBytes,
        orphanBlobCount,
        orphanBlobBytes,
        docTextCount: docTexts.length,
        docTextBytes,
        fanqieBookCount: fanqieBooks.length,
        fanqieChapterCount: fanqieChapters.length,
        fanqieBytes,
        mathNoteCount: mathNotes.length,
        mathNoteBytes,
        legacyAiCount,
        totalBytes,
      }
    },
  )
}

/** 清理未被任何文档（含回收站）引用的孤儿附件 Blob 与孤儿全文索引 */
export async function cleanOrphanBlobs(): Promise<{ count: number; bytes: number }> {
  return db.transaction('rw', [db.docs, db.blobs, db.docText], async () => {
    const docs = await db.docs.toArray()
    const referenced = new Set(docs.map((d) => d.hash))
    const blobs = await db.blobs.toArray()
    const orphanHashes: string[] = []
    let bytes = 0
    for (const b of blobs) {
      if (!referenced.has(b.hash)) {
        orphanHashes.push(b.hash)
        bytes += b.blob?.size ?? 0
      }
    }
    if (orphanHashes.length) {
      await db.blobs.bulkDelete(orphanHashes)
    }
    const textKeys = (await db.docText.toCollection().primaryKeys()) as string[]
    const orphanTextKeys = textKeys.filter((h) => !referenced.has(h))
    if (orphanTextKeys.length) {
      await db.docText.bulkDelete(orphanTextKeys)
    }
    return { count: orphanHashes.length, bytes }
  })
}

/** 彻底清空文档回收站，释放不再被引用的附件本体并写同步墓碑 */
export async function purgeDocTrash(): Promise<{ count: number; bytes: number }> {
  const now = Date.now()
  return db.transaction(
    'rw',
    [db.docs, db.blobs, db.positions, db.annotations, db.bookmarks, db.docText, db.tombstones],
    async () => {
      const docs = await db.docs.toArray()
      const trashed = docs.filter((d) => Boolean(d.deletedAt))
      if (!trashed.length) return { count: 0, bytes: 0 }

      const activeHashes = new Set(docs.filter((d) => !d.deletedAt).map((d) => d.hash))
      const trashIds = trashed.map((d) => d.id)
      const unsharedHashes = Array.from(new Set(trashed.map((d) => d.hash).filter((h) => !activeHashes.has(h))))

      let bytes = 0
      for (const h of unsharedHashes) {
        const b = await db.blobs.get(h)
        if (b?.blob) bytes += b.blob.size
      }

      await db.docs.bulkDelete(trashIds)
      await db.tombstones.bulkPut(trashIds.map((id) => ({ id, ts: now })))

      if (unsharedHashes.length) {
        await db.blobs.bulkDelete(unsharedHashes)
        await db.docText.bulkDelete(unsharedHashes)
        await db.positions.bulkDelete(unsharedHashes)
        await db.tombstones.bulkPut(unsharedHashes.map((id) => ({ id, ts: now })))
        for (const h of unsharedHashes) {
          const anns = await db.annotations.where('docHash').equals(h).toArray()
          if (anns.length) {
            await db.annotations.bulkDelete(anns.map((a) => a.id))
            await db.tombstones.bulkPut(anns.map((a) => ({ id: a.id, ts: now })))
          }
          const bms = await db.bookmarks.where('docHash').equals(h).toArray()
          if (bms.length) {
            await db.bookmarks.bulkDelete(bms.map((b) => b.id))
            await db.tombstones.bulkPut(bms.map((b) => ({ id: b.id, ts: now })))
          }
        }
      }

      return { count: trashed.length, bytes }
    },
  )
}

/** 清空历史已下线的旧 AI 残表 */
export async function cleanLegacyAiTables(): Promise<number> {
  return db.transaction('rw', [db.aiProviders, db.aiSessions, db.aiMessages, db.aiUsage], async () => {
    const counts = await Promise.all([
      db.aiProviders.count(),
      db.aiSessions.count(),
      db.aiMessages.count(),
      db.aiUsage.count(),
    ])
    const total = counts.reduce((sum, n) => sum + n, 0)
    if (total > 0) {
      await Promise.all([
        db.aiProviders.clear(),
        db.aiSessions.clear(),
        db.aiMessages.clear(),
        db.aiUsage.clear(),
      ])
    }
    return total
  })
}
