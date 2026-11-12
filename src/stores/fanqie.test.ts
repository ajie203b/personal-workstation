import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FanqieBookInfo, FanqieChapterMeta } from '@/lib/fanqie'
import { FqwebError, fetchFanqieChapterContent } from '@/lib/fanqieFqweb'
import { useFanqie } from './fanqie'

const { saved } = vi.hoisted(() => ({ saved: new Set<string>() }))
vi.mock('@/lib/native', () => ({ isNative: () => false, isTauri: () => true }))
vi.mock('@/lib/fanqieFqweb', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/fanqieFqweb')>(),
  fetchFanqieChapterContent: vi.fn(),
}))
vi.mock('@/db/fanqie', () => ({
  countFanqieChapters: async () => saved.size,
  getDownloadedItemIds: async () => new Set(saved),
  saveFanqieBook: async (book: FanqieBookInfo) => ({ id: book.bookId, title: book.title }),
  saveFanqieChapter: async (_bookId: string, chapter: FanqieChapterMeta) => { saved.add(chapter.itemId) },
  updateFanqieProgress: async () => undefined,
}))
vi.mock('./ui', () => ({ useUi: { getState: () => ({ toast: vi.fn() }) } }))

const fetchChapter = vi.mocked(fetchFanqieChapterContent)
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const chapterContent = { title: '测试章节', content: '这是用于测试章节下载的文本。'.repeat(6), unknownGlyphs: false }

function bookWithChapters(count: number): FanqieBookInfo {
  return {
    bookId: '101', title: '测试书', author: '作者', abstract: '', status: '连载中', statusKind: 'serial',
    chapterCount: count, tags: [], fetchedAt: 0, fontChanged: false,
    chapters: Array.from({ length: count }, (_, index) => ({
      itemId: String(index + 1), title: `第 ${index + 1} 章`, index: index + 1, locked: false, paid: false,
    })),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  fetchChapter.mockReset()
  saved.clear()
  useFanqie.getState().clear()
})

afterEach(() => {
  vi.useRealTimers()
})

it.each([
  { latency: 40, maximumTime: 4_000, expectedPeak: 1 },
  { latency: 800, maximumTime: 5_600, expectedPeak: 4 },
])('Windows downloads 24 chapters within $maximumTime ms at $latency ms latency', async ({ latency, maximumTime, expectedPeak }) => {
  let inFlight = 0
  let peak = 0
  const starts: number[] = []
  fetchChapter.mockImplementation(async () => {
    starts.push(Date.now())
    peak = Math.max(peak, ++inFlight)
    await wait(latency)
    inFlight--
    return chapterContent
  })
  const book = bookWithChapters(24)
  const finishedAt = useFanqie.getState().start(book, book.chapters).then(() => Date.now())
  await vi.runAllTimersAsync()

  expect(await finishedAt).toBeLessThan(maximumTime)
  expect(peak).toBe(expectedPeak)
  expect(starts.every((time, index) => index === 0 || time - starts[index - 1] >= 160)).toBe(true)
  expect(saved).toEqual(new Set(book.chapters.map(({ itemId }) => itemId)))
  expect(useFanqie.getState().job).toMatchObject({ phase: 'done', done: 24 })
})

it('cancels queued requests when the source returns a rate limit', async () => {
  fetchChapter.mockImplementation(async () => {
    await wait(60)
    throw new FqwebError('RATE_LIMITED', '测试限流')
  })
  const book = bookWithChapters(6)
  const run = useFanqie.getState().start(book, book.chapters)
  await vi.runAllTimersAsync()
  await run

  expect(fetchChapter).toHaveBeenCalledTimes(1)
  expect(useFanqie.getState().job).toMatchObject({ phase: 'error' })
})

it('resumes rate-limited downloads without requesting the chapters already saved', async () => {
  fetchChapter.mockResolvedValueOnce(chapterContent).mockRejectedValueOnce(new FqwebError('RATE_LIMITED', '测试限流'))
  const book = bookWithChapters(6)
  const run = useFanqie.getState().start(book, book.chapters)
  await vi.runAllTimersAsync()
  await run
  expect(saved).toEqual(new Set(['1']))

  fetchChapter.mockClear().mockResolvedValue(chapterContent)
  const resumed = useFanqie.getState().resume()
  await vi.runAllTimersAsync()
  await resumed
  expect(fetchChapter.mock.calls.map(([itemId]) => itemId)).toEqual(['2', '3', '4', '5', '6'])
  expect(useFanqie.getState().job).toMatchObject({ phase: 'done', done: 5 })
})
