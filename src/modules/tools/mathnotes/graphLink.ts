import type { InkBlock } from './types'
/** 公式重写部分笔画后，用仍保留的笔画关联到唯一最接近的识别块。 */
export function findGraphSource(oldKey: string, blocks: InkBlock[]): string | undefined {
  if (blocks.some(block => block.key === oldKey)) return oldKey
  const oldIds = new Set(oldKey.split('|'))
  const matches = blocks.map(block => ({ key: block.key, overlap: block.strokeIds.filter(id => oldIds.has(id)).length }))
    .filter(match => match.overlap >= Math.ceil(oldIds.size / 2))
    .sort((a, b) => b.overlap - a.overlap)
  if (!matches.length || (matches[1] && matches[0].overlap === matches[1].overlap)) return undefined
  return matches[0].key
}
