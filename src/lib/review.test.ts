import { describe, expect, it } from 'vitest'
import type { Annotation, ReviewState } from '@/db/db'
import { dueCards, dueOf, previewInterval, reviewNext } from './review'

const TODAY = '2026-10-20'

function ann(id: string, patch: Partial<Annotation> = {}): Annotation {
  return {
    id, docHash: 'h', text: `摘录 ${id}`, color: 'yellow', createdAt: new Date(2026, 9, 20, 9).getTime(),
    ...patch,
  }
}

const state = (patch: Partial<ReviewState> = {}): ReviewState => ({
  due: TODAY, interval: 10, ease: 2.5, reps: 3, ...patch,
})

describe('reviewNext', () => {
  it('新卡选「一般」→ 明天', () => {
    const r = reviewNext(undefined, 'good', TODAY)
    expect(r).toMatchObject({ due: '2026-10-21', interval: 1, reps: 1, ease: 2.5 })
  })

  it('新卡选「简单」→ 3 天后，ease 上调', () => {
    const r = reviewNext(undefined, 'easy', TODAY)
    expect(r).toMatchObject({ due: '2026-10-23', interval: 3, ease: 2.65 })
  })

  it('新卡选「困难」→ 1 天后，ease 下调', () => {
    const r = reviewNext(undefined, 'hard', TODAY)
    expect(r).toMatchObject({ due: '2026-10-21', interval: 1, ease: 2.35 })
  })

  it('「忘了」当天重来，reps 归零', () => {
    const r = reviewNext(state({ reps: 5 }), 'again', TODAY)
    expect(r).toMatchObject({ due: TODAY, interval: 0, reps: 0, ease: 2.3 })
  })

  it('成熟卡「一般」按 ease 放大间隔', () => {
    const r = reviewNext(state(), 'good', TODAY)
    expect(r).toMatchObject({ interval: 25, reps: 4, due: '2026-11-14' })
  })

  it('成熟卡「困难」只小幅推进', () => {
    const r = reviewNext(state(), 'hard', TODAY)
    expect(r).toMatchObject({ interval: 12, reps: 4 })
  })

  it('成熟卡「简单」乘 1.3', () => {
    const r = reviewNext(state(), 'easy', TODAY)
    expect(r).toMatchObject({ interval: 34, ease: 2.65 })
  })

  it('ease 下限 1.3', () => {
    const r = reviewNext(state({ ease: 1.35 }), 'again', TODAY)
    expect(r.ease).toBe(1.3)
  })

  it('间隔上限 365 天', () => {
    const r = reviewNext(state({ interval: 300, reps: 6 }), 'easy', TODAY)
    expect(r.interval).toBe(365)
  })

  it('按钮文案', () => {
    expect(previewInterval(undefined, 'good', TODAY)).toBe('1 天后')
    expect(previewInterval(undefined, 'again', TODAY)).toBe('今天再来')
  })
})

describe('dueOf / dueCards', () => {
  it('没有复习状态的旧高亮按创建次日到期', () => {
    expect(dueOf(ann('a'))).toBe('2026-10-21')
  })

  it('只收文字高亮：截图与空文本不进队列', () => {
    const cards = dueCards([
      ann('a', { review: { due: '2026-10-19', interval: 1, ease: 2.5, reps: 1 } }),
      ann('b', { kind: 'shot' }),
      ann('c', { text: '   ' }),
      ann('d', { review: { due: '2026-10-25', interval: 0, ease: 2.5, reps: 0 } }),
    ], TODAY)
    expect(cards.map((x) => x.id)).toEqual(['a'])
  })

  it('按到期日排序，同日按创建时间', () => {
    const cards = dueCards([
      ann('late', { review: { due: '2026-10-20', interval: 1, ease: 2.5, reps: 1 }, createdAt: 2 }),
      ann('early', { review: { due: '2026-10-01', interval: 1, ease: 2.5, reps: 1 } }),
      ann('same', { review: { due: '2026-10-20', interval: 1, ease: 2.5, reps: 1 }, createdAt: 1 }),
    ], TODAY)
    expect(cards.map((x) => x.id)).toEqual(['early', 'same', 'late'])
  })
})
