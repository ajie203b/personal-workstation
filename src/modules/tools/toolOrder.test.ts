import { expect, it } from 'vitest'
import { orderTools } from './toolOrder'

it('工具顺序兼容新增、删除、重复项和损坏的设置', () => {
  const tools = [{ to: 'a' }, { to: 'b' }, { to: 'new' }]
  expect(orderTools(tools, ['b', 'removed', 'b', 'a'])).toEqual([{ to: 'b' }, { to: 'a' }, { to: 'new' }])
  expect(orderTools(tools, null)).toEqual(tools)
})
