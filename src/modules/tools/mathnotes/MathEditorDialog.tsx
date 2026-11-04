import { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import { MathView } from './MathView'
import type { BlockResult } from './types'


/**
 * 识别结果纠错：使用系统输入法直接编辑识别文本，避免加载额外的大型公式编辑器。
 */
export function MathEditorDialog({
  open,
  block,
  busy,
  onOpenChange,
  onSubmit,
  onReset,
}: {
  open: boolean
  block: BlockResult | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (latex: string) => void
  onReset: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const initial = block ? (block.edited ?? block.recognized) : ''
  useEffect(() => {
    if (open) setValue(initial)
  }, [open, block?.key])

  const submit = () => onSubmit(value.trim())
  const insert = (symbol: string) => {
    const field = inputRef.current
    if (!field) return
    const start = field.selectionStart
    const end = field.selectionEnd
    setValue(value.slice(0, start) + symbol + value.slice(end))
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(start + symbol.length, start + symbol.length)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="修改识别结果" description="改好后点「重新计算」，答案会更新到画布上" widthClass="w-[min(560px,94vw)]">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] text-on-surface-2">
          识别结果（可直接修改数字和运算符）
          <textarea ref={inputRef} autoFocus value={value} onChange={(e) => setValue(e.target.value)} rows={3}
            aria-label="识别结果" className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2 text-[16px] text-on-surface outline-none focus:border-primary/60" />
        </label>
        <div className="flex flex-wrap gap-1.5" aria-label="常用运算符">
          {['+', '−', '×', '÷', '=', '(', ')'].map(symbol => (
            <button key={symbol} type="button" aria-label={`插入${symbol}`} onPointerDown={e => e.preventDefault()} onClick={() => insert(symbol)}
              className="h-9 min-w-10 px-3 rounded-[10px] bg-surface-2 text-on-surface hover:bg-surface-3">{symbol}</button>
          ))}
        </div>
        <p className="text-[12px] text-on-surface-2">支持直接输入算式，也可以编辑 LaTeX。</p>
        {value.trim() && <div className="rounded-[10px] bg-surface-2 px-3 py-2 text-on-surface" aria-label="公式预览"><MathView latex={value} /></div>}
        {block && (
          <div className="rounded-[12px] bg-surface-2 px-3 py-2 text-[12px] text-on-surface-2 flex flex-col gap-1">
            <span>
              识别原文：<code className="font-mono break-all">{block.recognized || '（空）'}</code>
            </span>
            {block.result.kind === 'error' ? (
              <span className="text-danger">{block.result.message}</span>
            ) : block.result.latex ? (
              <span className="flex items-center gap-1.5 flex-wrap">
                当前结果：
                <MathView latex={block.result.latex} className="text-on-surface" />
                {block.result.alt && <span>≈ {block.result.alt}</span>}
              </span>
            ) : null}
          </div>
        )}
        <div className="flex items-center gap-2 justify-end flex-wrap">
          {block?.edited != null && (
            <Button variant="ghost" className="h-9 px-3 mr-auto" onClick={onReset} disabled={busy}>
              <RotateCcw size={14} /> 恢复识别结果
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
