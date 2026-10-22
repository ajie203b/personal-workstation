import { describe, expect, it } from 'vitest'
import { placeCard } from './spotlightPlace'

const card = { width: 320, height: 180 }
const vp = { width: 390, height: 844 }

describe('placeCard', () => {
  it('无目标时屏幕居中、不画箭头', () => {
    const p = placeCard(null, card, vp)
    expect(p.side).toBeNull()
    expect(p.arrowX).toBeNull()
    expect(p.left).toBeCloseTo((390 - 320) / 2, 5)
    expect(p.top).toBeCloseTo((844 - 180) / 2, 5)
  })

  it('目标上方空间不够时放下面，箭头指向目标中心', () => {
    const target = { top: 100, left: 20, width: 100, height: 40 }
    const p = placeCard(target, card, vp, 'above')
    expect(p.side).toBe('below')
    expect(p.top).toBe(100 + 40 + 14)
    // 目标中心 70，卡片 left 50（320 宽居中后被夹到右边距内）
    expect(p.arrowX).toBeCloseTo(70 - p.left + 0, 5)
  })

  it('目标贴底部时放上面（FAB 场景）', () => {
    const target = { top: 760, left: 320, width: 56, height: 56 }
    const p = placeCard(target, card, vp, 'below')
    expect(p.side).toBe('above')
    expect(p.top).toBe(760 - 180 - 14)
  })

  it('小屏两侧都放不下时夹紧在屏幕内', () => {
    const tiny = { width: 390, height: 240 }
    const target = { top: 100, left: 10, width: 200, height: 40 }
    const p = placeCard(target, card, tiny)
    expect(p.top).toBeGreaterThanOrEqual(12)
    expect(p.top + 180).toBeLessThanOrEqual(240 - 12 + 0.01)
    expect(p.left).toBeGreaterThanOrEqual(12)
    expect(p.left + 320).toBeLessThanOrEqual(390 - 12 + 0.01)
  })

  it('目标水平贴边时卡片不越界，箭头被夹在卡内', () => {
    const target = { top: 300, left: 0, width: 30, height: 30 }
    const p = placeCard(target, card, vp)
    expect(p.left).toBe(12)
    expect(p.arrowX).toBeGreaterThanOrEqual(28)
    expect(p.arrowX).toBeLessThanOrEqual(320 - 28)
  })
})
