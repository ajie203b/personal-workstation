// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { MathEditorDialog } from './MathEditorDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let cleanup = () => {}
afterEach(() => cleanup())
it('打开纠错后可以编辑并提交，不依赖大型公式编辑器', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  const submit = vi.fn()
  const block = { key: 'a', recognized: '1+2=', result: { kind: 'inline' as const, latex: '3', text: '3' } }
  await act(async () => root.render(<MathEditorDialog open block={block} busy={false} onOpenChange={() => {}} onSubmit={submit} onReset={() => {}} />))
  const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="识别结果"]')!
  expect(input.value).toBe('1+2=')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => { setter.call(input, '1+3='); input.dispatchEvent(new Event('input', { bubbles: true })) })
  const button = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('重新计算'))!
  await act(async () => button.click())
  expect(submit).toHaveBeenCalledWith('1+3=')
})


it('常用运算符插入光标位置', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  const block = { key: 'a', recognized: '12', result: { kind: 'none' as const, latex: '', text: '' } }
  await act(async () => root.render(<MathEditorDialog open block={block} busy={false} onOpenChange={() => {}} onSubmit={() => {}} onReset={() => {}} />))
  const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="识别结果"]')!
  input.setSelectionRange(1, 1)
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="插入+"]')!.click())
  expect(input.value).toBe('1+2')
})
