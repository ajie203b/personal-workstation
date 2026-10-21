import { useCallback, useEffect, useRef, useState } from 'react'
import type { Doc, DocSettings } from '@/db/db'
import { Segmented } from '@/shared/ui/Segmented'
import { Stepper } from './ReaderPanels'

interface Props {
  doc: Doc
  settings: DocSettings
  updateSettings: (patch: Partial<DocSettings>, persist?: boolean) => void
  onClose: () => void
  onResetLayout: () => void
}

/**
 * 排版弹层（从 DocReaderPage 表头抽出）：主题、字号/行距（PDF 为缩放）、正文宽度、重置布局。
 *
 * 正文宽度是「拖动预览、松手落库」：Range 的每次 input 都写 IndexedDB 会卡，
 * 所以拖动中只 setState 预览（PDF 连预览都不做，重排一次 canvas 太贵），松手才持久化。
 */
export function ReaderSettingsPanel({ doc, settings, updateSettings, onClose, onResetLayout }: Props) {
  const isPdf = doc.kind === 'pdf'
  const [widthDraft, setWidthDraft] = useState(settings.widthPct)
  const [draggingWidth, setDraggingWidth] = useState(false)
  const widthDraftRef = useRef(settings.widthPct)
  const widthRaf = useRef(0)

  useEffect(() => {
    setWidthDraft(settings.widthPct)
    widthDraftRef.current = settings.widthPct
  }, [settings.widthPct])

  useEffect(() => () => cancelAnimationFrame(widthRaf.current), [])

  const previewWidth = (v: number) => {
    widthDraftRef.current = v
    setWidthDraft(v)
    // PDF 重排一次 canvas 很贵，拖动中只改数字，松手才真正换页宽
    if (isPdf) return
    cancelAnimationFrame(widthRaf.current)
    widthRaf.current = requestAnimationFrame(() => updateSettings({ widthPct: v }, false))
  }

  const commitWidth = useCallback((v: number) => {
    widthDraftRef.current = v
    setWidthDraft(v)
    updateSettings({ widthPct: v }, true)
  }, [updateSettings])

  // 指针可能拖出滑块再松开，监听 window 的 pointerup 兜底提交
  useEffect(() => {
    if (!draggingWidth) return
    const up = () => {
      setDraggingWidth(false)
      commitWidth(widthDraftRef.current)
    }
    window.addEventListener('pointerup', up, true)
    return () => window.removeEventListener('pointerup', up, true)
  }, [draggingWidth, commitWidth])

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        className="pop z-50 w-[260px] p-4 flex flex-col gap-3.5 fixed"
        style={{ right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 60px)' }}
      >
        <div>
          <p className="text-[12px] font-medium text-on-surface-2 mb-1.5">阅读主题</p>
          <Segmented
            size="sm"
            value={settings.theme}
            onChange={(v) => updateSettings({ theme: v as DocSettings['theme'] })}
            options={[
              { value: 'day', label: '日间' },
              { value: 'night', label: '夜间' },
              { value: 'sepia', label: '羊皮纸' },
              { value: 'dusk', label: '暮色' },
            ]}
          />
        </div>
        {isPdf ? (
          <Stepper
            label="缩放"
            value={`${Math.round((settings.zoom ?? 1) * 100)}%`}
            onMinus={() => updateSettings({ zoom: Math.max(0.5, Math.round(((settings.zoom ?? 1) - 0.1) * 10) / 10) })}
            onPlus={() => updateSettings({ zoom: Math.min(3, Math.round(((settings.zoom ?? 1) + 0.1) * 10) / 10) })}
          />
        ) : (
          <>
            <Stepper label="字号" value={`${settings.fontSize}px`} onMinus={() => updateSettings({ fontSize: Math.max(14, settings.fontSize - 1) })} onPlus={() => updateSettings({ fontSize: Math.min(32, settings.fontSize + 1) })} />
            <Stepper label="行距" value={settings.leading.toFixed(2)} onMinus={() => updateSettings({ leading: Math.max(1.6, Math.round((settings.leading - 0.1) * 10) / 10) })} onPlus={() => updateSettings({ leading: Math.min(2.2, Math.round((settings.leading + 0.1) * 10) / 10) })} />
          </>
        )}
        <div>
          <p className="text-[12px] font-medium text-on-surface-2 mb-1.5 flex items-center justify-between">
            <span>正文宽度</span>
            <span className="text-on-surface tabular-nums">{widthDraft}%</span>
          </p>
          <input
            type="range"
            min={50}
            max={100}
            step={2}
            value={widthDraft}
            onPointerDown={() => setDraggingWidth(true)}
            onPointerUp={() => { setDraggingWidth(false); commitWidth(widthDraftRef.current) }}
            onPointerCancel={() => { setDraggingWidth(false); commitWidth(widthDraftRef.current) }}
            onChange={(e) => previewWidth(Number(e.target.value))}
            onKeyUp={(e) => commitWidth(Number(e.currentTarget.value))}
            onBlur={(e) => commitWidth(Number(e.currentTarget.value))}
            aria-label="正文宽度"
            aria-valuetext={`${widthDraft}%`}
            className="reader-range w-full cursor-pointer"
            style={{ ['--range-pct' as string]: `${((widthDraft - 50) / 50) * 100}%` } as React.CSSProperties}
          />
          <div className="flex justify-between text-[10.5px] text-on-surface-2 mt-0.5">
            <span>窄</span>
            <span>{isPdf ? '松开后应用页宽' : '拖动实时预览'}</span>
            <span>宽</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-on-surface-2">排版按文档记忆，栏宽按设备记忆</p>
          <button
            type="button"
            onClick={onResetLayout}
            className="shrink-0 text-[11px] font-medium text-primary hover:underline cursor-pointer"
          >
            重置布局
          </button>
        </div>
      </div>
    </>
  )
}
