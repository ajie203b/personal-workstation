import { create } from 'zustand'
import type { FanqieBook } from '@/db/db'
import type { FanqieBookInfo, FanqieChapterMeta } from '@/lib/fanqie'
import { fetchFanqieChapterContent } from '@/lib/fanqieFqweb'
import {
  countFanqieChapters,
  getDownloadedItemIds,
  saveFanqieBook,
  saveFanqieChapter,
  updateFanqieProgress,
} from '@/db/fanqie'
import { useUi } from './ui'

const CONCURRENCY = 2
const DELAY_MIN = 260
const DELAY_MAX = 520
const SAVE_EVERY = 5
/** 正文接口连续失败这么多次就停，避免对公共节点死循环重试 */
const MAX_FAILURE_STREAK = 8

export type FanqiePhase = 'idle' | 'running' | 'paused' | 'done' | 'error'

export interface FanqieJob {
  bookId: string
  title: string
  phase: FanqiePhase
  total: number
  done: number
  failed: number
  skipped: number
  current: string
  error?: string
  unknownGlyphs: number
}

interface FanqieState {
  job: FanqieJob | null
  start: (info: FanqieBookInfo, chapters: FanqieChapterMeta[]) => Promise<void>
  pause: () => void
  resume: () => Promise<void>
  clear: () => void
}

let activeBook: FanqieBook | null = null
let activeChapters: FanqieChapterMeta[] = []
let activeRun: Promise<void> | null = null
let paused = false
let runToken = 0

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

function patchJob(patch: Partial<FanqieJob>) {
  useFanqie.setState((s) => (s.job ? { job: { ...s.job, ...patch } } : s))
}

async function runPool(token: number): Promise<void> {
  const book = activeBook
  if (!book) return
  const downloaded = await getDownloadedItemIds(book.id)
  const pending = activeChapters.filter((ch) => !downloaded.has(ch.itemId))
  let savedThisRun = 0
  let done = 0
  let failed = 0
  let skipped = 0
  let unknownGlyphs = 0
  let failureStreak = 0
  let cursor = 0
  let fatal = ''
  let lastError = ''

  useFanqie.setState((s) => ({
    job: s.job
      ? {
          ...s.job,
          phase: 'running',
          total: pending.length,
          done: 0,
          failed: 0,
          skipped: 0,
          current: '',
          error: undefined,
          unknownGlyphs: 0,
        }
      : s.job,
  }))

  const flush = async (err = lastError) => {
    try {
      // 以章节表实际条数为准：暂停/续传/并发写入时不会把旧计数盖回去
      const actual = await countFanqieChapters(book.id)
      await updateFanqieProgress(book.id, actual, err || undefined)
    } catch {
      /* 进度写不进去不影响下载 */
    }
  }

  const worker = async () => {
    while (cursor < pending.length) {
      if (paused || token !== runToken || fatal) return
      const meta = pending[cursor++]
      patchJob({ current: meta.title })

      let content: string | null = null
      let lastErr: unknown = null
      for (let attempt = 0; attempt < 3; attempt++) {
        if (paused || token !== runToken || fatal) return
        try {
          const data = await fetchFanqieChapterContent(meta.itemId)
          const visible = data.content.replace(/\s/g, '').length
          // 目录里给了字数就核对一下，防止接口改回试读片段还当好正文入库
          if (visible < 30 || (meta.wordCount && meta.wordCount > 100 && visible < meta.wordCount * 0.45)) {
            skipped++
            patchJob({ skipped })
            content = null
            lastErr = null
            failureStreak = 0
            break
          }
          content = data.content
          if (data.unknownGlyphs) unknownGlyphs++
          failureStreak = 0
          break
        } catch (e) {
          lastErr = e
          failureStreak++
          if (failureStreak >= MAX_FAILURE_STREAK) {
            fatal = '正文接口连续失败，已停止；稍后重试即可续传'
            return
          }
          if (attempt < 2) await sleep(1_500 * (attempt + 1))
        }
      }

      if (paused || token !== runToken) return
      if (!content) {
        if (lastErr) {
          failed++
          lastError = lastErr instanceof Error ? lastErr.message : '章节下载失败'
          patchJob({ failed, error: lastError })
        }
        continue
      }

      try {
        await saveFanqieChapter(book.id, meta, content)
        savedThisRun++
        done++
        patchJob({ done, current: meta.title, unknownGlyphs })
        if (savedThisRun % SAVE_EVERY === 0) await flush()
      } catch (e) {
        failed++
        lastError = e instanceof Error ? e.message : '写入本地书架失败'
        patchJob({ failed, error: lastError })
      }
      await sleep(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN))
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  const current = token === runToken
  // 即使这一轮已被暂停/替换，也把实际章节数落一次；错误只在当前轮写
  await flush(current ? (fatal || lastError) : '')
  if (!current) return

  if (fatal) {
    runToken++
    useFanqie.setState((s) => ({ job: s.job ? { ...s.job, phase: 'error', error: fatal } : s.job }))
    useUi.getState().toast(fatal)
    return
  }
  if (paused) {
    useFanqie.setState((s) => ({ job: s.job ? { ...s.job, phase: 'paused', current: '' } : s.job }))
    return
  }

  useFanqie.setState((s) => ({
    job: s.job ? { ...s.job, phase: 'done', current: '', unknownGlyphs } : s.job,
  }))
  const tail = [
    failed ? `${failed} 章失败` : '',
    skipped ? `${skipped} 章内容异常已跳过` : '',
    unknownGlyphs ? `${unknownGlyphs} 章有未识别字形` : '',
  ].filter(Boolean)
  useUi.getState().toast(
    `《${book.title}》下载完成：${done} 章${tail.length ? ` · ${tail.join(' · ')}` : ''}`,
  )
}

export const useFanqie = create<FanqieState>((set, get) => ({
  job: null,

  start: async (info, chapters) => {
    paused = true
    runToken += 2
    const token = runToken
    let book: FanqieBook
    try {
      book = await saveFanqieBook(info)
    } catch (e) {
      paused = false
      set({ job: null })
      throw e
    }
    activeBook = book
    activeChapters = chapters
    paused = false
    set({
      job: {
        bookId: book.id,
        title: book.title,
        phase: 'running',
        total: chapters.length,
        done: 0,
        failed: 0,
        skipped: 0,
        current: '',
        unknownGlyphs: 0,
      },
    })
    activeRun = runPool(token).catch((e) => {
      if (token === runToken) {
        paused = false
        runToken++
        const message = e instanceof Error ? e.message : '下载任务启动失败'
        useFanqie.setState((s) => (s.job ? { job: { ...s.job, phase: 'error', error: message } } : s))
      }
      throw e
    })
    await activeRun
  },

  pause: () => {
    if (get().job?.phase !== 'running') return
    paused = true
    runToken++
    set((s) => (s.job ? { job: { ...s.job, phase: 'paused', current: '' } } : s))
  },

  resume: async () => {
    if (!activeBook || !activeChapters.length) return
    if (get().job?.phase === 'running') return
    paused = false
    const token = ++runToken
    set((s) => (s.job ? { job: { ...s.job, phase: 'running', error: undefined } } : s))
    activeRun = runPool(token).catch((e) => {
      if (token === runToken) {
        paused = false
        runToken++
        const message = e instanceof Error ? e.message : '继续下载失败'
        useFanqie.setState((s) => (s.job ? { job: { ...s.job, phase: 'error', error: message } } : s))
      }
      throw e
    })
    await activeRun
  },

  clear: () => {
    if (get().job?.phase === 'running') return
    activeBook = null
    activeChapters = []
    activeRun = null
    set({ job: null })
  },
}))

/** 供书架页判断是否有章节写入（避免把 total 0 当成已完成） */
export async function refreshDownloadedCount(bookId: string): Promise<number> {
  return countFanqieChapters(bookId)
}
