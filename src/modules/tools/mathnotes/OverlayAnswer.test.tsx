// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverlayAnswer } from './MathNotesPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
})

function render(ui: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(ui))
  return host
}

const block = { key: 'k1', strokeIds: ['a'], box: { minX: 20, minY: 20, maxX: 200, maxY: 60 } }

describe('OverlayAnswer：推理失败显示标记并可重试（回归）', () => {
  it('识别失败的块在算式位置显示 ⚠，点击触发重试', () => {
    const onRetry = vi.fn()
    const onOpen = vi.fn()
    const el = render(
      <OverlayAnswer
        item={{ key: 'k1', block, res: null, failed: 'onnx 推理崩了', x: 222, y: 40, fontSize: 38, placement: 'inline' }}
        showLatex={false}
        onOpen={onOpen}
        onRetry={onRetry}
        onMeasure={() => {}}
      />,
    )
    const btn = el.querySelector<HTMLButtonElement>('[data-testid="mathnotes-recognize-failed"]')!
    expect(btn).not.toBeNull()
    expect(btn.textContent).toContain('识别失败')
    expect(btn.title).toContain('onnx 推理崩了')
    expect(btn.style.left).toBe('222px')
    act(() => btn.click())
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('答案按 fitAnswer 给出的位置 / 限宽渲染，并上报实测宽度', () => {
    const onMeasure = vi.fn()
    const el = render(
      <OverlayAnswer
        item={{
          key: 'k1',
          block,
          res: { key: 'k1', recognized: '12+34=', result: { kind: 'inline', latex: '46', text: '46' } },
          x: 8,
          y: 90,
          fontSize: 38,
          placement: 'below',
          maxWidth: 300,
        }}
        showLatex={false}
        onOpen={() => {}}
        onRetry={() => {}}
        onMeasure={onMeasure}
      />,
    )
    const btn = el.querySelector<HTMLButtonElement>('button[title="点击修改"]')!
    expect(btn.textContent).toContain('46')
    expect(btn.style.left).toBe('8px')
    expect(btn.style.maxWidth).toBe('300px')
    expect(onMeasure).toHaveBeenCalledWith('k1', expect.any(Number))
  })
})
