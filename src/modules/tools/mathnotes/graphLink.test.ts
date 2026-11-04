import { expect, it } from 'vitest'
import { findGraphSource } from './graphLink'
const b = (key: string) => ({key, strokeIds:key.split('|'), box:{minX:0,minY:0,maxX:1,maxY:1}})
it('公式改写部分笔画时保留图像关联；存在歧义时不猜测', () => {
  expect(findGraphSource('a|b|c', [b('a|b|new')])).toBe('a|b|new')
  expect(findGraphSource('a|b', [b('a|new'), b('b|other')])).toBeUndefined()
  expect(findGraphSource('a|b', [b('x|y')])).toBeUndefined()
})
