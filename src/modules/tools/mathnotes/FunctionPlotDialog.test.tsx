// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { FunctionPlotDialog, plotPaths } from './FunctionPlotDialog'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let cleanup = () => {}
afterEach(() => cleanup())
it('在无定义点和大幅跳变处断开曲线', () => {
  expect(plotPaths([1, 2, null, -2, -1], 10)).toHaveLength(2)
  expect(plotPaths([1, 3, -30, -1], 10).length).toBeGreaterThan(1)
})
it('打开图像并能放大范围', async () => {
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  cleanup = () => { act(() => root.unmount()); node.remove() }
  const plot = vi.fn(async () => [{ kind: 'explicit' as const, label: 'y=x^2', values: [1, 0, 1] }])
  await act(async () => root.render(<FunctionPlotDialog open initial="y=x^2" onOpenChange={() => {}} plot={plot} />))
  expect(plot).toHaveBeenCalledWith('y=x^2', -10, 10, 0, Math.PI * 2, 0, 0)
  expect(document.querySelector('svg[aria-label="函数 y=x^2 的图像"]')).not.toBeNull()
  const zoom = [...document.querySelectorAll('button')].find(b => b.textContent === '放大')!
  await act(async () => zoom.click())
  expect(plot).toHaveBeenLastCalledWith('y=x^2', -5, 5, 0, Math.PI * 2, 0, 0)
})


it('多条曲线显示各自的颜色说明', async () => {
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  cleanup = () => { act(() => root.unmount()); node.remove() }
  const plot = vi.fn(async () => [{ kind: 'explicit' as const, label: 'y=x', values: [-1, 0, 1] }, { kind: 'implicit' as const, label: 'x^2+y^2=25', segments: [[10, 10, 20, 20] as [number, number, number, number]] }])
  await act(async () => root.render(<FunctionPlotDialog open initial={'y=x\nx^2+y^2=25'} onOpenChange={() => {}} plot={plot} />))
  expect(document.body.textContent).toContain('● y=x')
  expect(document.body.textContent).toContain('● x^2+y^2=25')
})


it('三维参数曲线提供范围输入和可操作的旋转视角', async () => {
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  cleanup = () => { act(() => root.unmount()); node.remove() }
  const plot = vi.fn(async () => [{ kind: 'parametric3d' as const, label: '(cos(t),sin(t),t)', points: [[1, 0, 0] as [number, number, number], [0, 1, 1] as [number, number, number]] }])
  await act(async () => root.render(<FunctionPlotDialog open initial="(cos(t),sin(t),t)" onOpenChange={() => {}} plot={plot} />))
  expect(document.querySelector('input[aria-label="参数起点"]')).not.toBeNull()
  expect(document.querySelector('input[aria-label="参数终点"]')).not.toBeNull()
  const curve = document.querySelector<SVGPathElement>('[data-plot-curves] g path')!
  const before = curve.getAttribute('d')
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="向右旋转"]')!.click())
  expect(curve.getAttribute('d')).not.toBe(before)
})


it('多条曲线的交点显示在图上及坐标列表，可隐藏', async () => {
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  cleanup = () => { act(() => root.unmount()); node.remove() }
  const plot = vi.fn(async () => [
    { kind: 'explicit' as const, label: 'y=x', values: [-10, 0, 10] },
    { kind: 'explicit' as const, label: 'y=-x', values: [10, 0, -10] },
  ])
  await act(async () => root.render(<FunctionPlotDialog open initial={'y=x\ny=-x'} onOpenChange={() => {}} plot={plot} />))
  expect(document.querySelector('[aria-label="交点 1，坐标 0，0"]')).not.toBeNull()
  expect(document.querySelector('[aria-label="曲线交点"]')?.textContent).toContain('1. (0, 0)')
  const toggle = [...document.querySelectorAll('button')].find(b => b.textContent === '隐藏交点')!
  await act(async () => toggle.click())
  expect(document.querySelector('[aria-label="交点 1，坐标 0，0"]')).toBeNull()
})


it('图像支持拖动平移并按新范围重新采样', async () => {
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node); cleanup = () => { act(() => root.unmount()); node.remove() }
  const plot = vi.fn(async () => [{ kind: 'explicit' as const, label: 'y=x', values: [-1, 0, 1] }])
  await act(async () => root.render(<FunctionPlotDialog open initial="y=x" onOpenChange={() => {}} plot={plot} />))
  const svg = document.querySelector<SVGSVGElement>('svg[role="img"]')!
  svg.setPointerCapture = () => {}
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
  const event = (name: string, x: number, y: number) => { const e = new MouseEvent(name, { bubbles: true, clientX: x, clientY: y }); Object.defineProperty(e, 'pointerId', { value: 1 }); svg.dispatchEvent(e) }
  await act(async () => { event('pointerdown', 200, 200); event('pointermove', 240, 220); event('pointerup', 240, 220) })
  expect(plot).toHaveBeenLastCalledWith('y=x', -10, 10, 0, Math.PI * 2, -2, 1)
})


it('双指缩放按手指距离更新范围', async () => {
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node); cleanup = () => { act(() => root.unmount()); node.remove() }
  const plot = vi.fn(async () => [{ kind: 'explicit' as const, label: 'y=x', values: [-1, 0, 1] }])
  await act(async () => root.render(<FunctionPlotDialog open initial="y=x" onOpenChange={() => {}} plot={plot} />))
  const svg = document.querySelector<SVGSVGElement>('svg[role="img"]')!
  svg.setPointerCapture = () => {}
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
  const event = (name: string, id: number, x: number) => { const e = new MouseEvent(name, { bubbles: true, clientX: x, clientY: 200 }); Object.defineProperty(e, 'pointerId', { value: id }); svg.dispatchEvent(e) }
  await act(async () => { event('pointerdown', 1, 150); event('pointerdown', 2, 250); event('pointermove', 1, 100); event('pointermove', 2, 300); event('pointerup', 1, 100); event('pointerup', 2, 300) })
  expect(plot).toHaveBeenLastCalledWith('y=x', -5, 5, 0, Math.PI * 2, 0, 0)
})

it('隐藏某条曲线后不再展示其交点', async () => {
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node); cleanup = () => { act(() => root.unmount()); node.remove() }
  const plot = vi.fn(async () => [{ kind: 'explicit' as const, label: 'y=x', values: [-10, 0, 10] }, { kind: 'explicit' as const, label: 'y=-x', values: [10, 0, -10] }])
  await act(async () => root.render(<FunctionPlotDialog open initial={'y=x\ny=-x'} onOpenChange={() => {}} plot={plot} />))
  expect(document.querySelector('[aria-label="交点 1，坐标 0，0"]')).not.toBeNull()
  const button = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('y=-x'))!
  await act(async () => button.click())
  expect(button.getAttribute('aria-pressed')).toBe('false')
  expect(document.querySelector('[aria-label="交点 1，坐标 0，0"]')).toBeNull()
})
