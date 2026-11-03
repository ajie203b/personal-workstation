import { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import { MathView } from './MathView'
import type { BlockResult } from './types'

type MathfieldEl = HTMLElement & { value: string; focus(): void }

/**
 * 识别结果纠错：MathLive 可视化编辑 LaTeX，确认后重新计算。
 * MathLive 按需加载（约 800KB），只在第一次打开纠错框时下载进内存；
 * 字体用 mathlive/fonts.css 经 Vite 打包（不走它默认的相对目录 / CDN），提示音关闭。
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
  const hostRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<MathfieldEl | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [fallback, setFallback] = useState('')
  const initial = block ? (block.edited ?? block.recognized) : ''

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadError('')
    setFallback(initial)
    void (async () => {
      try {
        const [{ MathfieldElement }] = await Promise.all([import('mathlive'), import('mathlive/fonts.css')])
        MathfieldElement.fontsDirectory = null
        MathfieldElement.soundsDirectory = null
        if (cancelled || !hostRef.current) return
        const mf = new MathfieldElement() as unknown as MathfieldEl
        mf.value = initial
        mf.setAttribute('math-virtual-keyboard-policy', 'auto')
        mf.className = 'block w-full min-h-[56px] rounded-[12px] border border-outline bg-surface-2 px-3 py-2 text-[20px] outline-none'
        hostRef.current.replaceChildren(mf)
        fieldRef.current = mf
        setReady(true)
        requestAnimationFrame(() => mf.focus())
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : '编辑器加载失败')
      }
    })()
    return () => {
      cancelled = true
      setReady(false)
      fieldRef.current = null
      hostRef.current?.replaceChildren()
    }
    // initial 只在打开时读一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, block?.key])

  const submit = () => {
    const latex = fieldRef.current ? fieldRef.current.value : fallback
    onSubmit(latex.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="修改识别结果" description="改好后点「重新计算」，答案会更新到画布上" widthClass="w-[min(560px,94vw)]">
      <div className="flex flex-col gap-3">
        <div ref={hostRef} className={ready ? '' : 'hidden'} />
        {!ready && !loadError && (
          <div className="flex items-center gap-2 text-[12.5px] text-on-surface-2 h-14">
            <Loader2 size={14} className="animate-spin" /> 加载公式编辑器…
          </div>
        )}
        {loadError && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] text-danger">{loadError}，可直接改 LaTeX：</p>
            <textarea
              value={fallback}
              onChange={(e) => setFallback(e.target.value)}
              rows={3}
              className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2 font-mono text-[13px] outline-none focus:border-primary/60"
            />
          </div>
        )}
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
          <Button variant="primary" className="h-9 px-4" onClick={submit} disabled={busy || (!ready && !loadError)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} 重新计算
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
