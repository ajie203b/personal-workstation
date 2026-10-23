import { expect, it } from 'vitest'
import { safeOutputName } from './outputName'

it('导出名称保留中文和扩展名，去掉路径与控制字符', () => {
  expect(safeOutputName('../报告/最终\0.pdf')).toBe('_报告_最终_.pdf')
  expect(safeOutputName('CON.pdf')).toBe('文档-CON.pdf')
  expect(safeOutputName(' ... ')).toBe('导出')
  expect(safeOutputName('文'.repeat(220) + '.pdf')).toMatch(/\.pdf$/)
  expect(safeOutputName('课程设计.pdf')).toBe('课程设计.pdf')
})
