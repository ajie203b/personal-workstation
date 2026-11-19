// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverlayAnswer } from './MathNotesPage'
import { LassoSelectionOverlay, ModelStatusBanner } from './MathNotesOverlay'

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
    expect(btn.textContent).toContain('重试')
    expect(btn.title).toContain('onnx 推理崩了')
    expect(btn.parentElement?.style.left).toBe('222px')
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


it('有等号但未算出结果时提供纠错入口', () => {
  const onOpen = vi.fn()
  const el = render(<OverlayAnswer item={{ key: 'k1', block, res: { key: 'k1', recognized: '12+34', result: {kind: 'none', latex: '', text: ''} }, x: 200, y: 40, fontSize: 38, placement: 'inline', canCorrect: true }} showLatex={false} onOpen={onOpen} onRetry={() => {}} onMeasure={() => {}} />)
  const btn = el.querySelector<HTMLButtonElement>('button[aria-label="未算出结果，点击修改识别内容"]')!
  expect(btn).not.toBeNull()
  act(() => btn.click())
  expect(onOpen).toHaveBeenCalledOnce()
})


it('识别失败时可以手动输入算式', () => {
  const manual = vi.fn()
  const el = render(<OverlayAnswer item={{ key: 'k1', block, res: null, failed: '失败', x: 100, y: 40, fontSize: 38, placement: 'inline' }} showLatex={false} onOpen={() => {}} onRetry={() => {}} onManual={manual} onMeasure={() => {}} />)
  act(() => el.querySelector<HTMLButtonElement>('button[aria-label="手动输入算式"]')!.click())
  expect(manual).toHaveBeenCalledOnce()
})


it('按需显示模式不提前展示答案，点击后请求显示；关闭模式隐藏结果', () => {
  const reveal = vi.fn()
  const item = { key: 'k1', block, res: { key: 'k1', recognized: '1+2=', result: { kind: 'inline' as const, latex: '3', text: '3' } }, x: 200, y: 40, fontSize: 38, placement: 'inline' as const }
  const el = render(<OverlayAnswer item={item} showLatex={false} mode="suggest" onReveal={reveal} onOpen={() => {}} onRetry={() => {}} onMeasure={() => {}} />)
  const btn = [...el.querySelectorAll('button')].find(b => b.textContent === '显示结果')!
  expect(el.textContent).not.toContain('3')
  act(() => btn.click()); expect(reveal).toHaveBeenCalledOnce()
  act(() => root!.render(<OverlayAnswer item={item} showLatex={false} mode="off" onOpen={() => {}} onRetry={() => {}} onMeasure={() => {}} />))
  expect(el.textContent).not.toContain('3')
})

describe('OverlayAnswer / LassoSelectionOverlay / ModelStatusBanner P0-P1 升级', () => {
  it('计算结果使用暖琥珀色对比色，识别原文显示规范化后的 LaTeX', () => {
    const el = render(
      <OverlayAnswer
        item={{
          key: 'k1',
          block,
          res: { key: 'k1', recognized: '3\\textsc x+1=7', result: { kind: 'inline', latex: '2', text: '2' } },
          x: 210,
          y: 40,
          fontSize: 38,
          placement: 'inline',
        }}
        showLatex
        onOpen={() => {}}
        onRetry={() => {}}
        onMeasure={() => {}}
      />,
    )
    const answerBtn = el.querySelector<HTMLButtonElement>('button[title="点击修改"]')!
    expect(answerBtn.className).toContain('text-[#B45309]')
    expect(answerBtn.className).toContain('dark:text-[#FBBF24]')
    const chipBtn = el.querySelector<HTMLButtonElement>('button[title="点击修改识别结果"]')!
    expect(chipBtn.textContent).not.toContain('\\textsc')
    expect(chipBtn.textContent).toContain('3x')
  })

  it('顶部块（minY < 40）的 latexChip 与套索工具栏均向下展示以免被裁剪', () => {
    const topBlock = { key: 'top', strokeIds: ['a'], box: { minX: 20, minY: 12, maxX: 180, maxY: 48 } }
    const el = render(
      <>
        <OverlayAnswer
          item={{
            key: 'top',
            block: topBlock,
            res: { key: 'top', recognized: '1+2=', result: { kind: 'inline', latex: '3', text: '3' } },
            x: 190,
            y: 30,
            fontSize: 36,
            placement: 'inline',
          }}
          showLatex
          onOpen={() => {}}
          onRetry={() => {}}
          onMeasure={() => {}}
        />
        <LassoSelectionOverlay
          selectionBox={topBlock.box}
          strokesRef={{ current: [] }}
          selectionDrag={{ current: null }}
          selected={[]}
          pushAction={() => {}}
          afterChange={() => {}}
          bump={() => {}}
          onScale={() => {}}
          onCopy={() => {}}
          onDelete={() => {}}
        />
      </>,
    )
    const chipBtn = el.querySelector<HTMLButtonElement>('button[title="点击修改识别结果"]')!
    expect(parseFloat(chipBtn.style.top)).toBeGreaterThan(topBlock.box.maxY)
    const lassoBar = el.querySelector<HTMLButtonElement>('button[aria-label="缩小选中笔迹"]')!.parentElement!
    expect(lassoBar.style.top).toBe('calc(100% + 8px)')
  })

  it('书写/待识别期间不渲染遮挡笔尖的「手动输入」浮标，变量定义展示 ✓=val 徽标，模型条可收起', () => {
    const manual = vi.fn()
    const el = render(
      <>
        <OverlayAnswer
          item={{ key: 'p1', block, res: null, pending: true, x: 210, y: 40, fontSize: 36, placement: 'inline' }}
          showLatex={false}
          onOpen={() => {}}
          onRetry={() => {}}
          onManual={manual}
          onMeasure={() => {}}
        />
        <OverlayAnswer
          item={{
            key: 'v1',
            block,
            res: { key: 'v1', recognized: 'price=10', result: { kind: 'none', latex: '', text: '', assigned: { name: 'price', value: '10' } } },
            x: 210,
            y: 100,
            fontSize: 36,
            placement: 'inline',
          }}
          showLatex={false}
          onOpen={() => {}}
          onRetry={() => {}}
          onMeasure={() => {}}
        />
        <ModelStatusBanner
          model={{ phase: 'loading', ratio: 0.4, file: 'encoder.onnx' }}
          percent={40}
          recognizing={0}
          onOpenSettings={() => {}}
          onRetryModel={() => {}}
          onNewFormula={manual}
        />
      </>,
    )
    // 待识别块不弹出紧跟笔迹的「手动输入」按钮，避免影响平板手写
    expect(el.querySelector('button[aria-label="手动输入算式"]')).toBeNull()
    expect(el.textContent).toContain('✓ = 10')

    const closeBtn = el.querySelector<HTMLButtonElement>('button[aria-label="收起模型下载提示"]')!
    act(() => closeBtn.click())
    expect(el.textContent).not.toContain('正在下载识别模型')
  })
})
