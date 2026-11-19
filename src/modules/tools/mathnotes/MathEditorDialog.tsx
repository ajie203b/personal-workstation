import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Loader2, RotateCcw } from 'lucide-react'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import { MathView } from './MathView'
import { normalizeLatex } from './latexNormalize'
import { manualExpression } from './mathText'
import type { AngleMode, BlockResult, ComputeResult } from './types'

interface QuickChip {
  label: string
  ariaLabel: string
  prefix: string
  suffix?: string
}

const LATEX_CHIPS: QuickChip[] = [
  { label: 'a/b', ariaLabel: '插入分数', prefix: '\\frac{', suffix: '}{}' },
  { label: '√', ariaLabel: '插入根号', prefix: '\\sqrt{', suffix: '}' },
  { label: 'x²', ariaLabel: '插入平方', prefix: '^2' },
  { label: 'xⁿ', ariaLabel: '插入幂次', prefix: '^{', suffix: '}' },
  { label: 'π', ariaLabel: '插入圆周率', prefix: '\\pi' },
  { label: '°', ariaLabel: '插入角度', prefix: '^{\\circ}' },
  { label: 'sin', ariaLabel: '插入正弦', prefix: '\\sin(', suffix: ')' },
  { label: 'cos', ariaLabel: '插入余弦', prefix: '\\cos(', suffix: ')' },
  { label: 'tan', ariaLabel: '插入正切', prefix: '\\tan(', suffix: ')' },
  { label: 'ln', ariaLabel: '插入自然对数', prefix: '\\ln(', suffix: ')' },
  { label: 'log', ariaLabel: '插入常用对数', prefix: '\\log_{10}(', suffix: ')' },
  { label: '∫', ariaLabel: '插入积分', prefix: '\\int ' },
  { label: '∑', ariaLabel: '插入求和', prefix: '\\sum_{k=1}^{n} ' },
  { label: '→换算', ariaLabel: '插入单位换算箭头', prefix: '\\to ' },
  { label: '矩阵', ariaLabel: '插入矩阵', prefix: '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}' },
]

/**
 * 识别结果纠错：使用系统输入法直接编辑识别文本，提供实时计算预览、变量插入与一键复制。
 */
export function MathEditorDialog({
  open,
  block,
  busy,
  angleMode = 'rad',
  variables,
  previewCompute,
  onOpenChange,
  onSubmit,
  onReset,
  onPlot,
}: {
  open: boolean
  block: BlockResult | null
  busy: boolean
  angleMode?: AngleMode
  variables?: Record<string, number>
  previewCompute?: (latex: string) => Promise<ComputeResult>
  onOpenChange: (open: boolean) => void
  onSubmit: (latex: string) => void
  onReset: () => void
  onPlot?: (latex: string) => void
}) {
  const [value, setValue] = useState('')
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [copied, setCopied] = useState<'result' | 'formula' | null>(null)
  const [livePreview, setLivePreview] = useState<ComputeResult | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const alternatives: Record<string, string[]> = { '0': ['O'], 'O': ['0'], '1': ['7', 'l'], '7': ['1'], 'l': ['1'], '5': ['S'], 'S': ['5'], 'x': ['×'], '×': ['x'], '-': ['+'], '+': ['-'] }
  const selectedText = selection ? value.slice(selection.start, selection.end) : ''
  const choices = alternatives[selectedText] ?? []
  const initial = block ? (block.edited ?? block.recognized) : ''

  useEffect(() => {
    if (open) {
      setValue(initial)
      setSelection(null)
      setCopied(null)
    } else {
      setLivePreview(null)
    }
  }, [open, block?.key, initial])

  useEffect(() => {
    const trimmed = value.trim()
    if (!open || !trimmed) {
      setLivePreview(null)
      return
    }
    let alive = true
    const expr = manualExpression(trimmed, false)
    const run = async () => {
      try {
        const res = previewCompute
          ? await previewCompute(expr)
          : (await import('./compute')).computeLatex(expr, { angleMode, variables })
        if (alive) setLivePreview(res)
      } catch {
        if (alive) setLivePreview(null)
      }
    }
    void run()
    return () => { alive = false }
  }, [open, value, angleMode, variables, previewCompute])

  const copyText = (text: string, kind: 'result' | 'formula') => {
    if (!text) return
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(kind)
      window.setTimeout(() => setCopied((prev) => (prev === kind ? null : prev)), 1500)
    }).catch(() => undefined)
  }

  const varEntries = useMemo(() => Object.entries(variables ?? {}), [variables])

  const submit = () => {
    if (value.trim() && !busy) onSubmit(value.trim())
  }

  const insert = (prefix: string, suffix = '') => {
    const field = inputRef.current
    if (!field) return
    const start = field.selectionStart ?? value.length
    const end = field.selectionEnd ?? value.length
    const selected = value.slice(start, end)
    const next = value.slice(0, start) + prefix + selected + suffix + value.slice(end)
    const cursor = start + prefix.length + selected.length
    setValue(next)
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(cursor, cursor)
    })
  }

  const replaceSelected = (replacement: string) => {
    if (!selection) return
    setValue(value.slice(0, selection.start) + replacement + value.slice(selection.end))
    const position = selection.start + replacement.length
    setSelection(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(position, position)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="修改 / 手动输入算式" description="改好后点「重新计算」或按 Ctrl/Cmd + Enter，答案会更新到画布上" widthClass="w-[min(560px,94vw)]">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] text-on-surface-2">
          算式内容（支持 LaTeX 与普通数学写法）
          <textarea
            ref={inputRef}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && value.trim() && !busy) {
                e.preventDefault()
                submit()
              }
            }}
            rows={3}
            onSelect={(e) => {
              const field = e.currentTarget
              const end = field.selectionEnd
              const start = field.selectionStart === end ? Math.max(0, end - 1) : field.selectionStart
              setSelection({ start, end })
            }}
            aria-label="识别结果"
            placeholder="例如：12+34=、x^2-5x+6=0、5km->m、\\sin(30)="
            className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2 text-[16px] text-on-surface outline-none focus:border-primary/60"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5" aria-label="常用运算符">
            {['+', '−', '×', '÷', '=', '(', ')'].map((symbol) => (
              <button
                key={symbol}
                type="button"
                aria-label={`插入${symbol}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => insert(symbol)}
                className="h-9 min-w-10 px-3 rounded-[10px] bg-surface-2 text-on-surface hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 cursor-pointer"
              >
                {symbol}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="常用数学模板">
            {LATEX_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                aria-label={chip.ariaLabel}
                title={chip.prefix + (chip.suffix ?? '')}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => insert(chip.prefix, chip.suffix)}
                className="h-8 px-2.5 rounded-[10px] border border-outline bg-surface-2 text-xs font-medium text-on-surface hover:bg-surface-3 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 cursor-pointer"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {choices.length > 0 && (
          <div className="flex items-center flex-wrap gap-2 text-xs text-on-surface-2">
            <span>“{selectedText}”可能是：</span>
            {choices.map((choice) => (
              <button
                key={choice}
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => replaceSelected(choice)}
                className="rounded-lg border border-outline bg-surface-2 px-2 py-1 text-on-surface cursor-pointer"
              >
                {choice}
              </button>
            ))}
          </div>
        )}

        {varEntries.length > 0 && (
          <div className="flex items-center flex-wrap gap-1.5 text-xs text-on-surface-2" aria-label="本页变量快捷插入">
            <span>本页变量：</span>
            {varEntries.map(([name, val]) => (
              <button
                key={name}
                type="button"
                aria-label={`插入变量 ${name}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => insert(name)}
                className="rounded-lg border border-ok/40 bg-ok/10 px-2 py-0.5 text-ok hover:bg-ok/15 cursor-pointer tabular-nums"
              >
                {name} = {Number(val.toPrecision(6))}
              </button>
            ))}
          </div>
        )}

        <p className="text-[12px] text-on-surface-2">点击或选中易混淆的字符可查看候选；方程组每行输入一个等式；Ctrl/Cmd + Enter 快速计算。</p>

        {value.trim() && (
          <div className="rounded-[10px] bg-surface-2 px-3 py-2 text-on-surface overflow-x-auto flex items-center justify-between gap-2" aria-label="公式预览">
            <div className="min-w-0 overflow-x-auto">
              <MathView latex={normalizeLatex(value)} />
            </div>
            <button
              type="button"
              aria-label="复制算式 LaTeX"
              title="复制算式"
              onClick={() => copyText(normalizeLatex(value), 'formula')}
              className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-outline bg-surface px-2 py-1 text-[11px] text-on-surface-2 hover:text-on-surface cursor-pointer"
            >
              {copied === 'formula' ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
              <span>{copied === 'formula' ? '已复制' : '复制算式'}</span>
            </button>
          </div>
        )}

        {livePreview && (livePreview.kind !== 'none' || livePreview.assigned) && (
          <div className="rounded-[10px] border border-outline/70 bg-surface-2/70 px-3 py-2 text-[12.5px] flex items-center justify-between gap-2" aria-label="实时计算预览">
            <div className="min-w-0 flex items-center gap-1.5 flex-wrap text-on-surface-2">
              <span className="shrink-0">实时结果：</span>
              {livePreview.kind === 'error' ? (
                <span className="text-danger">{livePreview.message}</span>
              ) : livePreview.assigned ? (
                <span className="text-ok font-medium">变量 {livePreview.assigned.name} = {livePreview.assigned.value}</span>
              ) : (
                <span className="flex items-center gap-1.5 flex-wrap text-[#B45309] dark:text-[#FBBF24] font-medium">
                  <MathView latex={livePreview.latex} />
                  {livePreview.alt && <span className="text-on-surface-2 text-[11.5px]">≈ {livePreview.alt}</span>}
                </span>
              )}
            </div>
            {(livePreview.text || livePreview.latex) && livePreview.kind !== 'error' && (
              <button
                type="button"
                aria-label="复制计算结果"
                title="复制计算结果"
                onClick={() => copyText(livePreview.text || livePreview.latex, 'result')}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-outline bg-surface px-2 py-1 text-[11px] text-on-surface-2 hover:text-on-surface cursor-pointer"
              >
                {copied === 'result' ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                <span>{copied === 'result' ? '已复制' : '复制结果'}</span>
              </button>
            )}
          </div>
        )}

        {block && (
          <div className="rounded-[12px] bg-surface-2 px-3 py-2 text-[12px] text-on-surface-2 flex flex-col gap-1">
            <span>
              识别原文：<code className="font-mono break-all">{block.recognized || '（手动输入）'}</code>
            </span>
            {block.result.kind === 'error' ? (
              <span className="text-danger">{block.result.message}</span>
            ) : block.result.latex ? (
              <span className="flex items-center gap-1.5 flex-wrap">
                当前结果：
                <MathView latex={block.result.latex} className="text-on-surface" />
                {block.result.alt && <span>≈ {block.result.alt}</span>}
              </span>
            ) : block.result.assigned ? (
              <span className="text-ok">已注册变量：{block.result.assigned.name} = {block.result.assigned.value}</span>
            ) : null}
          </div>
        )}

        <div className="flex items-center gap-2 justify-end flex-wrap">
          {block?.edited != null && block.recognized && (
            <Button variant="ghost" className="h-9 px-3 mr-auto" onClick={onReset} disabled={busy}>
              <RotateCcw size={14} /> 恢复识别结果
            </Button>
          )}
          {onPlot && (
            <Button variant="outline" className="h-9 px-3" onClick={() => onPlot(value.trim())} disabled={!value.trim() || busy}>
              查看图像
            </Button>
          )}
          <Button variant="outline" className="h-9 px-4" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" className="h-9 px-4" onClick={submit} disabled={busy || !value.trim()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} 重新计算
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
