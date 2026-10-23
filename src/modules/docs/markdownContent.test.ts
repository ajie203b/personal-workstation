import { describe, expect, it } from 'vitest'
import { normalizeMarkdown } from './markdownContent'

describe('Markdown table recovery', () => {
  it('recovers the pasted table whose pipes and cells are separate paragraphs', () => {
    const source = '|\n配置项\n\n|\n\n填什么\n\n|\n| --- | --- |\n|\n\n接口地址\n\n'
      + '| https://opencode.ai/inference/openai/v1/chat/completions |\n|\n\n认证\n\n'
      + '| Authorization: Bearer 你的 Console Key |\n|\n\n模型名\n\n'
      + '| minimax-m3.1-flash-free |             ## 4. 注意事项'
    expect(normalizeMarkdown(source)).toBe(
      '| 配置项 | 填什么 |\n| --- | --- |\n'
      + '| 接口地址 | https://opencode.ai/inference/openai/v1/chat/completions |\n'
      + '| 认证 | Authorization: Bearer 你的 Console Key |\n'
      + '| 模型名 | minimax-m3.1-flash-free |\n\n## 4. 注意事项',
    )
  })

  it('removes blank lines between otherwise complete table rows', () => {
    expect(normalizeMarkdown('| 名称 | 内容 |\n\n| --- | --- |\n\n| **粗体** | `a|b` |'))
      .toBe('| 名称 | 内容 |\n| --- | --- |\n| **粗体** | `a|b` |')
  })

  it('leaves fenced examples, ordinary paragraphs and incomplete tables alone', () => {
    for (const source of [
      '```md\n| 标题 | 内容 |\n\n| --- | --- |\n\n| 示例 | 内容 |\n```',
      '~~~md\n| 标题 | 内容 |\n\n| --- | --- |\n~~~',
      '普通文字 | 不是表格\n\n**粗体**',
      '|\n不完整\n\n| --- | --- |',
    ]) expect(normalizeMarkdown(source)).toBe(source)
  })

  it('keeps adjacent tables separate', () => {
    const source = '| 一 | 二 |\n| --- | --- |\n| a | b |\n\n| 三 | 四 |\n| --- | --- |\n| c | d |'
    expect(normalizeMarkdown(source)).toBe(source)
  })
})
