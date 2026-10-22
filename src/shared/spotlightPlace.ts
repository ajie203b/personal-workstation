/**
 * 新手引导卡片的定位计算（纯函数，便于单测）。
 *
 * 原实现用固定卡片高度估算 + 简单翻转，在小屏 / 目标贴边 / 卡片偏高时
 * 会把卡片顶出屏幕或离目标很远（「从这儿」指不到「这儿」的根源之一）。
 * 这里改成：以目标为锚点水平居中、上下就近放置、四边夹紧，箭头恒指向目标。
 */

export interface RectLike {
  top: number
  left: number
  width: number
  height: number
}

export interface ViewportLike {
  width: number
  height: number
}

export interface Placement {
  top: number
  left: number
  /** 卡片相对目标在哪一侧；null = 无目标（居中展示） */
  side: 'above' | 'below' | null
  /** 箭头在卡片内的水平位置（距左边）；null = 不画箭头 */
  arrowX: number | null
}

const MARGIN = 12
const GAP = 14
/** 箭头距卡片边缘的最小距离，别让它贴角 */
const ARROW_EDGE = 28

export function placeCard(
  target: RectLike | null,
  card: { width: number; height: number },
  viewport: ViewportLike,
  prefer: 'above' | 'below' = 'below',
): Placement {
  // 无目标：屏幕居中（老行为）
  if (!target || target.width <= 0 || target.height <= 0) {
    return {
      top: Math.max(MARGIN, (viewport.height - card.height) / 2),
      left: Math.max(MARGIN, (viewport.width - card.width) / 2),
      side: null,
      arrowX: null,
    }
  }

  const maxLeft = Math.max(MARGIN, viewport.width - card.width - MARGIN)
  const left = Math.min(Math.max(MARGIN, target.left + target.width / 2 - card.width / 2), maxLeft)

  const belowTop = target.top + target.height + GAP
  const aboveTop = target.top - card.height - GAP
  const belowFits = belowTop + card.height <= viewport.height - MARGIN
  const aboveFits = aboveTop >= MARGIN

  let side: 'above' | 'below'
  let top: number
  if (prefer === 'below' ? belowFits || !aboveFits : !aboveFits && belowFits) {
    side = 'below'
    top = belowTop
  } else if (aboveFits || !belowFits) {
    side = 'above'
    top = aboveTop
  } else {
    // 两侧都放不下：贴目标垂直居中并夹进屏幕
    side = prefer
    top = target.top + target.height / 2 - card.height / 2
  }
  top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, viewport.height - card.height - MARGIN))

  const arrowX = Math.min(
    Math.max(ARROW_EDGE, target.left + target.width / 2 - left),
    Math.max(ARROW_EDGE, card.width - ARROW_EDGE),
  )

  return { top, left, side, arrowX }
}
