import { expect, it } from 'vitest'
import { fileName, parentPath, localLink } from './localMarkdown'

it('保留中文、空格和 Windows 路径，相对链接交给原生路径校验', () => {
  expect(fileName('D:\\笔记\\章节.md')).toBe('章节.md')
  expect(parentPath('D:\\笔记\\章节.md')).toBe('D:\\笔记\\')
  expect(localLink('D:\\笔记\\章节.md', './子目录/说明%20书.md#标题')).toEqual({ path: 'D:\\笔记\\./子目录/说明 书.md', hash: '标题' })
})
it('外部协议、绝对路径和损坏的编码不会当本地相对链接', () => {
  for (const href of ['https://example.com/a.md', 'javascript:alert(1)', 'file:///c:/secret', '/secret.md', '#标题', '%xx']) expect(localLink('D:\\a.md', href)).toBeNull()
})

it('资源管理器返回的 Windows 扩展路径先消解点段与正斜杠', () => {
  expect(localLink('\\\\?\\D:\\笔记\\章节\\a.md', '../资料/说明%20书.md#标题')).toEqual({ path: '\\\\?\\D:\\笔记\\资料\\说明 书.md', hash: '标题' })
  expect(localLink('\\\\?\\UNC\\server\\share\\笔记\\a.md', './b.md')).toEqual({ path: '\\\\?\\UNC\\server\\share\\笔记\\b.md', hash: '' })
})
