// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { MathEditorDialog } from './MathEditorDialog'
import { computeLatex } from './compute'

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


it('可从已识别的公式打开图像', async () => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  const onPlot = vi.fn()
  const block = { key: 'f', recognized: 'y=x^2', result: { kind: 'none' as const, latex: '', text: '' } }
  await act(async () => root.render(<MathEditorDialog open block={block} busy={false} onOpenChange={() => {}} onSubmit={() => {}} onReset={() => {}} onPlot={onPlot} />))
  const button = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('查看图像'))!
  await act(async () => button.click())
  expect(onPlot).toHaveBeenCalledWith('y=x^2')
})


it('选中易混淆字符时提供候选并只替换该字符', async () => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); cleanup = () => { act(() => root.unmount()); host.remove() }
  const block = { key: 'a', recognized: '1O+2=', result: { kind: 'none' as const, latex: '', text: '' } }
  await act(async () => root.render(<MathEditorDialog open block={block} busy={false} onOpenChange={() => {}} onSubmit={() => {}} onReset={() => {}} />))
  const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="识别结果"]')!
  await act(async () => { input.focus(); input.setSelectionRange(1, 2); input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight' })) })
  const candidate = [...document.querySelectorAll('button')].find(b => b.textContent === '0')
  expect(candidate).toBeDefined()
  await act(async () => candidate!.click())
  expect(input.value).toBe('10+2=')
})

it('提供快捷 LaTeX 模板芯片并支持 Ctrl/Cmd + Enter 提交', async () => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); cleanup = () => { act(() => root.unmount()); host.remove() }
  const submit = vi.fn()
  const block = { key: 'a', recognized: '', result: { kind: 'none' as const, latex: '', text: '' } }
  await act(async () => root.render(<MathEditorDialog open block={block} busy={false} onOpenChange={() => {}} onSubmit={submit} onReset={() => {}} />))
  const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="识别结果"]')!

  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="插入分数"]')!.click())
  expect(input.value).toBe('\\frac{}{}')
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="插入圆周率"]')!.click())
  expect(input.value).toContain('\\pi')
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="插入矩阵"]')!.click())
  expect(input.value).toContain('\\begin{pmatrix}')

  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', ctrlKey: true }))
  })
  expect(submit).toHaveBeenCalledTimes(1)
})

it('支持实时计算预览与本页变量快捷插入', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup = () => { act(() => root.unmount()); host.remove() }
  const block = { key: 'a', recognized: 'a+2=', result: { kind: 'none' as const, latex: '', text: '' } }
  await act(async () =>
    root.render(
      <MathEditorDialog
        open
        block={block}
        busy={false}
        variables={{ a: 10, b: 3 }}
        previewCompute={async (expr) => computeLatex(expr, { variables: { a: 10, b: 3 } })}
        onOpenChange={() => {}}
        onSubmit={() => {}}
        onReset={() => {}}
      />,
    ),
  )
  await act(async () => {
    await new Promise((r) => setTimeout(r, 180))
  })
  const preview = document.querySelector('[aria-label="实时计算预览"]')
  expect(preview?.textContent).toContain('12')

  const varBtn = document.querySelector<HTMLButtonElement>('button[aria-label="插入变量 b"]')!
  expect(varBtn).not.toBeNull()
  const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="识别结果"]')!
  input.setSelectionRange(input.value.length, input.value.length)
  await act(async () => varBtn.click())
  expect(input.value).toBe('a+2=b')
})
