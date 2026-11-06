// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const { addTask } = vi.hoisted(() => ({ addTask: vi.fn() }))
vi.mock('@/db/tasks', () => ({ addTask }))
import { QuickAdd } from './QuickAdd'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks() })

it('平板可以点击添加，保存失败后保留输入', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  addTask.mockRejectedValueOnce(new Error('写入失败')).mockResolvedValueOnce({})
  await act(async () => root.render(<QuickAdd />))
  const input = host.querySelector('input')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setValue.call(input, '平板任务'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  const button = host.querySelector<HTMLButtonElement>('button[type=submit]')!
  expect(button.disabled).toBe(false)
  await act(async () => button.click())
  expect(input.value).toBe('平板任务')
  await act(async () => button.click())
  expect(addTask).toHaveBeenCalledTimes(2)
  expect(input.value).toBe('')
  act(() => root.unmount())
})
