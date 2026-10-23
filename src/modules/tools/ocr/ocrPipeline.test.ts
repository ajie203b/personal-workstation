import { describe, expect, it } from 'vitest'
import {
  boxesFromProbMap,
  computeDetSize,
  ctcGreedyDecode,
  parseCharset,
  recStripSize,
  warpQuadRgba,
  planDetTiles,
  dedupeQuads,
  DET_TILE_MAX,
  REC_IMG_MAX_WIDTH,
  sortByReadingOrder,
  type Point,
  type Quad,
} from './ocrPipeline'

/** 由左上角 + 宽高构造轴对齐四边形（左上、右上、右下、左下） */
function axisQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

/** 矩形面积（用于断言扩框确实变大） */
function quadArea(quad: Quad): number {
  // 鞋带公式
  let s = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

/** 四点的中心 */
function quadCenter(quad: Quad): Point {
  return {
    x: quad.reduce((s, p) => s + p.x, 0) / 4,
    y: quad.reduce((s, p) => s + p.y, 0) / 4,
  }
}

/**
 * 合成概率图：背景低概率，指定矩形区域高概率，模拟 DB 网络输出。
 */
function syntheticProbMap(width: number, height: number, rects: { x: number; y: number; w: number; h: number; value: number }[]): Float32Array {
  const prob = new Float32Array(width * height)
  prob.fill(0.05)
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        prob[y * width + x] = r.value
      }
    }
  }
  return prob
}

describe('computeDetSize（预处理尺寸计算）', () => {
  it('最长边缩到约 960，宽高都是 32 的倍数，保持比例', () => {
    const r = computeDetSize(4000, 2000) // 2:1 横图
    expect(r.width).toBe(960)
    expect(r.height).toBe(480)
    expect(r.width % 32).toBe(0)
    expect(r.height % 32).toBe(0)
    // 比例保持在 2:1 附近（32 取整允许的误差）
    expect(r.width / r.height).toBeCloseTo(2, 1)
  })

  it('竖图按高度缩，且比例保持', () => {
    const r = computeDetSize(1080, 2400)
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(960)
    expect(r.width % 32).toBe(0)
    expect(r.height % 32).toBe(0)
    // 32 取整在窄边上的相对误差更大，容差放宽到 0.2
    expect(r.height / r.width).toBeCloseTo(2400 / 1080, 0)
  })

  it('小图不放大，但最小 32', () => {
    const r = computeDetSize(20, 10)
    expect(r.width).toBeGreaterThanOrEqual(32)
    expect(r.height).toBeGreaterThanOrEqual(32)
    expect(r.width % 32).toBe(0)
    expect(r.height % 32).toBe(0)
  })

  it('已是 32 倍数且不超过 960 的图基本不变', () => {
    const r = computeDetSize(640, 320)
    expect(r.width).toBe(640)
    expect(r.height).toBe(320)
  })
})

describe('boxesFromProbMap（DB 后处理：合成概率图 → 框）', () => {
  it('单个高概率矩形得到一个框，中心对准、面积略大于原矩形（unclip 扩框）', () => {
    const w = 320
    const h = 240
    const prob = syntheticProbMap(w, h, [{ x: 40, y: 60, w: 120, h: 30, value: 0.95 }])
    const boxes = boxesFromProbMap(prob, w, h)
    expect(boxes.length).toBe(1)
    const c = quadCenter(boxes[0])
    // 像素下标中心是 99.5/74.5（整数像素坐标），容差 1px 即可
    expect(Math.abs(c.x - 100)).toBeLessThan(1) // 40 + 120/2
    expect(Math.abs(c.y - 75)).toBeLessThan(1) // 60 + 30/2
    // 扩框后面积应大于原矩形（120×30 = 3600）
    expect(quadArea(boxes[0])).toBeGreaterThan(3600)
    // distance = area*ratio/perimeter ≈ 18px，面积约为原 2.5 倍；上限 4 倍防回归
    expect(quadArea(boxes[0])).toBeLessThan(3600 * 4)
  })

  it('两个分离的高概率区域得到两个框', () => {
    const w = 400
    const h = 300
    const prob = syntheticProbMap(w, h, [
      { x: 20, y: 20, w: 100, h: 25, value: 0.9 },
      { x: 200, y: 150, w: 150, h: 35, value: 0.9 },
    ])
    const boxes = boxesFromProbMap(prob, w, h)
    expect(boxes.length).toBe(2)
  })

  it('低置信度区域被 boxThresh 过滤', () => {
    const w = 320
    const h = 240
    // 概率 0.4 > binThresh 0.3（会被二值化）但 < boxThresh 0.6（应被丢弃）
    const prob = syntheticProbMap(w, h, [{ x: 40, y: 60, w: 120, h: 30, value: 0.4 }])
    const boxes = boxesFromProbMap(prob, w, h)
    expect(boxes.length).toBe(0)
  })

  it('噪点（面积过小）被丢弃', () => {
    const w = 320
    const h = 240
    const prob = syntheticProbMap(w, h, [{ x: 40, y: 60, w: 2, h: 2, value: 0.95 }])
    const boxes = boxesFromProbMap(prob, w, h)
    expect(boxes.length).toBe(0)
  })

  it('全低概率图返回空数组', () => {
    const prob = syntheticProbMap(64, 64, [])
    expect(boxesFromProbMap(prob, 64, 64)).toEqual([])
  })
})

describe('sortByReadingOrder（行排序：交错框的阅读顺序）', () => {
  it('同一行内按 x 排序，行间按 y 排序', () => {
    // 构造交错输入：第二行的左框、第一行的右框、第一行的左框、第二行的右框
    const row1Left = axisQuad(50, 10, 100, 30)
    const row1Right = axisQuad(200, 12, 100, 28)
    const row2Left = axisQuad(30, 100, 100, 30)
    const row2Right = axisQuad(220, 105, 100, 26)
    const sorted = sortByReadingOrder([row2Right, row1Right, row2Left, row1Left])
    expect(sorted[0]).toBe(row1Left)
    expect(sorted[1]).toBe(row1Right)
    expect(sorted[2]).toBe(row2Left)
    expect(sorted[3]).toBe(row2Right)
  })

  it('垂直中心相近的框归同一行（倾斜/抖动的行）', () => {
    const a = axisQuad(10, 20, 80, 24) // cy = 32
    const b = axisQuad(150, 24, 80, 24) // cy = 36，与 a 相差 4 < 0.7*24
    const c = axisQuad(10, 200, 80, 24) // cy = 212，另一行
    const sorted = sortByReadingOrder([c, b, a])
    expect(sorted[0]).toBe(a)
    expect(sorted[1]).toBe(b)
    expect(sorted[2]).toBe(c)
  })

  it('空输入返回空数组', () => {
    expect(sortByReadingOrder([])).toEqual([])
  })
})

describe('ctcGreedyDecode（CTC 贪心解码，mock 字典）', () => {
  // mock 字典：下标 0 是 blank，1..3 对应 a/b/c，4 对应空格
  const charset = parseCharset('a\nb\nc')
  // charset = ['a','b','c',' ']，classes = charset.length + 1 = 5
  const classes = charset.length + 1

  /** 按指定下标序列造 one-hot-ish 概率（每步给目标类 0.9，其余均分） */
  function probsFromIndices(indices: number[]): Float32Array {
    const out = new Float32Array(indices.length * classes)
    for (let t = 0; t < indices.length; t++) {
      for (let c = 0; c < classes; c++) out[t * classes + c] = 0.1 / classes
      out[t * classes + indices[t]] = 0.9
    }
    return out
  }

  it('基本解码：blank 去掉、连续重复折叠', () => {
    // blank(0), a, a, blank, b, c → 'abc'
    const probs = probsFromIndices([0, 1, 1, 0, 2, 3])
    const r = ctcGreedyDecode(probs, 6, classes, charset)
    expect(r.text).toBe('abc')
    expect(r.confidence).toBeGreaterThan(0.8)
  })

  it('被 blank 隔开的重复字符保留两个', () => {
    // a, blank, a → 'aa'
    const probs = probsFromIndices([1, 0, 1])
    expect(ctcGreedyDecode(probs, 3, classes, charset).text).toBe('aa')
  })

  it('空格字符照常输出', () => {
    // a, 空格(4), b → 'a b'
    const probs = probsFromIndices([1, 4, 2])
    expect(ctcGreedyDecode(probs, 3, classes, charset).text).toBe('a b')
  })

  it('全 blank 返回空文本、置信度 0', () => {
    const probs = probsFromIndices([0, 0, 0])
    const r = ctcGreedyDecode(probs, 3, classes, charset)
    expect(r.text).toBe('')
    expect(r.confidence).toBe(0)
  })

  it('置信度取贡献步的平均概率', () => {
    // 手工构造两步：a 的概率 0.8，b 的概率 0.6
    const probs = new Float32Array(2 * classes)
    probs[1] = 0.8
    probs[classes + 2] = 0.6
    const r = ctcGreedyDecode(probs, 2, classes, charset)
    expect(r.text).toBe('ab')
    expect(r.confidence).toBeCloseTo(0.7, 5)
  })
})

describe('recStripSize（识别输入尺寸）', () => {
  it('高度固定 48，宽度按框宽高比，不再硬卡 320', () => {
    const wide = recStripSize(axisQuad(0, 0, 320, 32))
    expect(wide.height).toBe(48)
    expect(wide.width).toBe(480)

    const square = recStripSize(axisQuad(0, 0, 60, 60))
    expect(square.height).toBe(48)
    expect(square.width).toBe(48)

    const long = recStripSize(axisQuad(0, 0, 2000, 40))
    expect(long.width).toBe(REC_IMG_MAX_WIDTH)
    // 手机截图一整行（宽高比 ~25）不被压缩
    expect(recStripSize(axisQuad(0, 0, 1000, 40)).width).toBe(1200)
  })

  it('极窄框也有最小宽度', () => {
    const r = recStripSize(axisQuad(0, 0, 10, 100))
    expect(r.width).toBeGreaterThanOrEqual(16)
    expect(r.height).toBe(48)
  })
})

describe('parseCharset（字典解析）', () => {
  it('每行一个字符，末尾补空格（use_space_char）', () => {
    expect(parseCharset('a\nb\nc')).toEqual(['a', 'b', 'c', ' '])
  })

  it('CRLF 与末尾空行都能正确处理', () => {
    expect(parseCharset('甲\r\n乙\r\n')).toEqual(['甲', '乙', ' '])
  })
})

describe('warpQuadRgba（透视裁剪方向）', () => {
  /** 生成 w×h 的 RGBA，R 通道 = x，G 通道 = y，便于验证采样位置 */
  function gradient(w: number, h: number): Uint8ClampedArray {
    const d = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4
        d[o] = x
        d[o + 1] = y
        d[o + 2] = 0
        d[o + 3] = 255
      }
    }
    return d
  }

  it('轴对齐框按原尺寸裁剪 = 原样拷贝那块像素（v3.3.2 回归：整片 128 灰）', () => {
    const src = gradient(200, 100)
    const out = warpQuadRgba(src, 200, 100, axisQuad(50, 20, 40, 10), 40, 10)
    for (const [x, y] of [[0, 0], [39, 0], [0, 9], [20, 5], [39, 9]]) {
      const o = (y * 40 + x) * 4
      expect(out[o]).toBeCloseTo(50 + x, 0)
      expect(out[o + 1]).toBeCloseTo(20 + y, 0)
    }
  })

  it('缩放裁剪：目标宽度是源框一半时，按 2 倍步长采样', () => {
    const src = gradient(200, 100)
    const out = warpQuadRgba(src, 200, 100, axisQuad(0, 0, 100, 20), 50, 10)
    // 输出 x=10 → 源 x≈20.5
    expect(out[(5 * 50 + 10) * 4]).toBeGreaterThanOrEqual(20)
    expect(out[(5 * 50 + 10) * 4]).toBeLessThanOrEqual(21)
  })
})

describe('planDetTiles（检测切块）', () => {
  it('普通图：短边缩到 960，整张一块，尺寸是 32 的倍数', () => {
    const t = planDetTiles(1080, 1920)
    expect(t).toHaveLength(1)
    expect(t[0].detWidth).toBe(960)
    expect(t[0].detHeight % 32).toBe(0)
    expect(t[0].detHeight).toBeCloseTo((1920 * 960) / 1080, -2)
  })

  it('小图不放大', () => {
    const t = planDetTiles(400, 300)
    expect(t).toHaveLength(1)
    expect(t[0].detWidth).toBe(416)
    expect(t[0].detHeight).toBe(288)
  })

  it('长截图沿长边切块、相邻重叠且覆盖到底', () => {
    const t = planDetTiles(1080, 10000)
    expect(t.length).toBeGreaterThan(1)
    expect(t[0].y).toBe(0)
    const last = t[t.length - 1]
    expect(last.y + last.height).toBe(10000)
    for (let i = 1; i < t.length; i++) {
      // 有重叠
      expect(t[i].y).toBeLessThan(t[i - 1].y + t[i - 1].height)
    }
    for (const tile of t) {
      expect(tile.detWidth).toBe(960)
      expect(tile.detHeight).toBeLessThanOrEqual(DET_TILE_MAX)
    }
  })

  it('横向长图沿 x 切', () => {
    const t = planDetTiles(9000, 800)
    expect(t.length).toBeGreaterThan(1)
    expect(t.every((x) => x.y === 0 && x.height === 800)).toBe(true)
  })
})

describe('dedupeQuads（切块重叠去重）', () => {
  it('被大框包含的半截框去掉，不相交的都留下', () => {
    const full = axisQuad(10, 100, 500, 40)
    const half = axisQuad(10, 100, 500, 18)
    const other = axisQuad(10, 300, 500, 40)
    const r = dedupeQuads([half, full, other])
    expect(r).toHaveLength(2)
    expect(r).toContainEqual(full)
    expect(r).toContainEqual(other)
  })
})
