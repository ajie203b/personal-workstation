import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { Segmented } from '@/shared/ui/Segmented'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { usePdfHandoff } from './handoff'
import { centerRect, cornerRects, pageNumberRect, tileRects, type PageNumberPos } from './layout'
import { pdfPageInfos, pageNumberStamp, pageNumberText, stampPngs, watermarkStamps, type PageNumberFormat, type Stamp } from './pdfOps'
import { openPdfDocument, renderPageThumb, type PDFDocumentProxy } from './pdfRender'
import { renderTextPng } from './textPng'
import { type ToolOutput } from './output'
import { FIELD_INPUT, Field, FilePicker, OutputBar, Panel, fileBytes, pdfBlob } from './parts'
import { parsePageExpr } from './pdfPages'

type Kind = 'watermark' | 'pagenum'

const WATERMARK_COLORS = [
  { value: '#464646', label: '深灰' },
  { value: '#111827', label: '纯黑' },
  { value: '#1D4ED8', label: '靛蓝' },
  { value: '#DC2626', label: '朱红' },
  { value: '#0F766E', label: '墨绿' },
] as const

let measureCanvas: HTMLCanvasElement | null = null

/** 同步估算旋转文字的逻辑包围盒（pt），用于第 1 页实时预览对齐导出几何。 */
function estimateTextBox(text: string, fontSize: number, angleDeg: number, bold: boolean) {
  const padding = Math.ceil(fontSize * 0.35)
  let textW = Math.max(1, Array.from(text).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 127 ? fontSize : fontSize * 0.6), 0))
  let textH = Math.max(1, fontSize)
  if (typeof document !== 'undefined') {
    measureCanvas ??= document.createElement('canvas')
    const ctx = measureCanvas.getContext('2d')
    if (ctx) {
      ctx.font = `${bold ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`
      const m = ctx.measureText(text)
      textW = Math.max(1, Math.ceil(m.width))
      textH = Math.max(1, Math.ceil((m.actualBoundingBoxAscent ?? fontSize * 0.8) + (m.actualBoundingBoxDescent ?? fontSize * 0.2)))
    }
  }
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return {
    boxW: Math.ceil(textW * cos + textH * sin) + padding * 2,
    boxH: Math.ceil(textW * sin + textH * cos) + padding * 2,
  }
}

/** 水印 / 页码：文字用 2× canvas 渲成透明 PNG 再贴（不嵌中文字体，产物不膨胀） */
export function WatermarkPanel() {
  const toast = useUi((s) => s.toast)
  const [file, setFile] = useState<File | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [totalPages, setTotalPages] = useState(0)
  const [preview, setPreview] = useState<string>()
  const [page1Size, setPage1Size] = useState<{ visW: number; visH: number } | null>(null)
  const [kind, setKind] = useState<Kind>('watermark')
  const [text, setText] = useState('内部资料')
  const [fontSize, setFontSize] = useState(28)
  const [color, setColor] = useState<string>('#464646')
  const [opacity, setOpacity] = useState(0.15)
  const [angle, setAngle] = useState(30)
  const [position, setPosition] = useState<'tile' | 'center' | 'corners'>('tile')
  const [format, setFormat] = useState<PageNumberFormat>('n/total')
  const [pos, setPos] = useState<PageNumberPos>('center')
  const [name, setName] = useState('加水印')
  const [nameEdited, setNameEdited] = useState(false)
  const [range, setRange] = useState('')
  const [start, setStart] = useState('1')
  const loadId = useRef(0)

  useEffect(() => () => { loadId.current++ }, [])
  useEffect(() => () => void doc?.destroy(), [doc])

  const pickFile = useCallback(async (f: File) => {
    const request = ++loadId.current
    setFile(f)
    setDoc(null)
    setTotalPages(0)
    setPreview(undefined)
    setPage1Size(null)
    try {
      const opened = await openPdfDocument(await fileBytes(f))
      if (request !== loadId.current) { void opened.destroy(); return }
      setDoc(opened)
      setTotalPages(opened.numPages)
      const page1 = await opened.getPage(1)
      if (request !== loadId.current) return
      const vp = page1.getViewport({ scale: 1 })
      setPage1Size({ visW: vp.width, visH: vp.height })
      const url = await renderPageThumb(page1, 1)
      if (request === loadId.current) setPreview(url)
    } catch {
      if (request !== loadId.current) return
      toast('打不开这份 PDF（可能已损坏或格式特殊）')
      setFile(null)
    }
  }, [toast])

  usePdfHandoff('watermark', (incoming) => void pickFile(incoming))

  const clearFile = () => {
    loadId.current++
    setFile(null)
    setDoc(null)
    setTotalPages(0)
    setPreview(undefined)
    setPage1Size(null)
  }

  const onKindChange = (next: Kind) => {
    setKind(next)
    if (!nameEdited) setName(next === 'watermark' ? '加水印' : '加页码')
  }

  const page1Included = useMemo(() => {
    if (!totalPages) return true
    if (!range.trim()) return true
    try {
      return parsePageExpr(range, totalPages).includes(1)
    } catch {
      return true
    }
  }, [range, totalPages])

  const previewOverlay = useMemo(() => {
    if (!page1Size) return null
    const { visW, visH } = page1Size
    if (kind === 'watermark') {
      const label = text.trim()
      if (!label) return { visW, visH, items: [] as { x: number; y: number; size: number; label: string; angle: number; color: string; opacity: number }[] }
      const { boxW, boxH } = estimateTextBox(label, fontSize, angle, true)
      const rects =
        position === 'tile'
          ? tileRects(visW, visH, boxW, boxH)
          : position === 'center'
            ? [centerRect(visW, visH, boxW, boxH)]
            : cornerRects(visW, visH, boxW, boxH, 18)
      return {
        visW,
        visH,
        items: rects.map((r) => ({
          x: r.x + r.w / 2,
          y: r.y + r.h / 2,
          size: fontSize * (r.w / Math.max(1, boxW)),
          label,
          angle,
          color,
          opacity,
        })),
      }
    }
    const first = Number.isInteger(Number(start)) && Number(start) >= 1 ? Number(start) : 1
    let count = totalPages || 1
    if (totalPages && range.trim()) {
      try {
        const parsed = parsePageExpr(range, totalPages)
        if (parsed.length) count = parsed.length
      } catch { /* 范围编辑中途保留总页数预览 */ }
    }
    const label = pageNumberText(0, first + count - 1, format, first)
    const { boxW, boxH } = estimateTextBox(label, 16, 0, false)
    const r = pageNumberRect(visW, visH, boxW, boxH, pos, 20)
    return {
      visW,
      visH,
      items: [{
        x: r.x + r.w / 2,
        y: r.y + r.h / 2,
        size: 16,
        label,
        angle: 0,
        color: '#5a5a5a',
        opacity: 0.85,
      }],
    }
  }, [page1Size, kind, text, fontSize, angle, position, color, opacity, start, totalPages, range, format, pos])

  const make = async (): Promise<ToolOutput> => {
    if (!file) throw new Error('先选一份 PDF')
    const bytes = await fileBytes(file)
    const infos = await pdfPageInfos(bytes)
    if (!infos.length) throw new Error('文档没有页面')
    const chosen = range.trim() ? parsePageExpr(range, infos.length) : infos.map((_, i) => i + 1)
    if (!chosen.length) throw new Error('请选择至少一页')

    if (kind === 'watermark') {
      const t = text.trim()
      if (!t) throw new Error('水印文字不能为空')
      const png = await renderTextPng(t, { fontSize, angle, bold: true, color })
      const selected = new Set(chosen)
      const stamps = watermarkStamps(png.bytes, png.width, png.height, infos, {
        position,
        opacity,
      }).filter(stamp => selected.has(stamp.pageIndex + 1))
      return {
        blob: pdfBlob(await stampPngs(bytes, stamps)),
        filename: `${name.trim() || '加水印'}.pdf`,
        isPdf: true,
      }
    }

    // 页码：每页文字不同，逐页渲小 PNG 贴到底部
    const stamps: Stamp[] = []
    const first = Number(start)
    if (!Number.isInteger(first) || first < 1 || first > 999999) throw new Error('起始页码应为 1 到 999999 的整数')
    for (const [offset, pageNo] of chosen.entries()) {
      const i = pageNo - 1
      const label = pageNumberText(offset, first + chosen.length - 1, format, first)
      const png = await renderTextPng(label, { fontSize: 16, bold: false, color: 'rgba(90,90,90,1)' })
      stamps.push(pageNumberStamp(i, infos[i], png.bytes, png.width, png.height, { pos }))
    }
    return {
      blob: pdfBlob(await stampPngs(bytes, stamps)),
      filename: `${name.trim() || '加页码'}.pdf`,
      isPdf: true,
    }
  }

  return (
    <Panel
      title="水印 / 页码"
      desc="支持第 1 页实时预览效果、应用页码范围、字号颜色与旋转角度。"
    >
      {file ? (
        <div className="flex items-center gap-2 rounded-[12px] border border-outline bg-surface-2 px-3 py-2">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-primary-soft text-primary shrink-0">
            <FileText size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-5 truncate">{file.name}</p>
            {totalPages > 0 && <p className="text-[11px] text-on-surface-2">共 {totalPages} 页</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={clearFile} aria-label="移除">
            <X size={16} />
          </Button>
        </div>
      ) : (
        <FilePicker accept="application/pdf,.pdf" label="选择 PDF" onPick={(files) => void pickFile(files[0])} />
      )}

      {file && (
        <div className="max-w-sm mx-auto w-full flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11.5px] text-on-surface-2 px-0.5">
            <span>第 1 页实时预览</span>
            {!page1Included && <span className="text-amber-600 dark:text-amber-400">当前范围未包含第 1 页</span>}
          </div>
          <div className="relative rounded-[12px] overflow-hidden border border-outline bg-white shadow-xs">
            {preview ? (
              <img src={preview} alt="第 1 页实时预览" className="w-full block select-none" draggable={false} />
            ) : (
              <div className="aspect-[3/4] animate-pulse bg-surface-3/60" />
            )}
            {previewOverlay && page1Included && (
              <svg
                viewBox={`0 0 ${previewOverlay.visW} ${previewOverlay.visH}`}
                className="absolute inset-0 w-full h-full pointer-events-none select-none"
                aria-hidden
              >
                {previewOverlay.items.map((item, idx) => (
                  <text
                    key={idx}
                    x={item.x}
                    y={item.y}
                    fill={item.color}
                    fillOpacity={item.opacity}
                    fontSize={item.size}
                    fontWeight={kind === 'watermark' ? 700 : 400}
                    fontFamily="system-ui, sans-serif"
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={item.angle ? `rotate(${-item.angle} ${item.x} ${item.y})` : undefined}
                  >
                    {item.label}
                  </text>
                ))}
              </svg>
            )}
          </div>
        </div>
      )}

      <Segmented
        asRadio
        options={[
          { value: 'watermark', label: '文字水印' },
          { value: 'pagenum', label: '页码' },
        ]}
        value={kind}
        onChange={onKindChange}
        ariaLabel="类型"
        className="self-start"
      />
      <Field label="应用页码"><input aria-label="水印页码范围" value={range} onChange={e => setRange(e.target.value)} placeholder="留空为全部，如 2-5,8" className={FIELD_INPUT} /></Field>

      {kind === 'watermark' ? (
        <>
          <Field label="水印文字">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="内部资料"
              className={FIELD_INPUT}
            />
          </Field>
          <Field label="位置">
            <SelectMenu
              value={position}
              onChange={(v) => setPosition(v as typeof position)}
              options={[
                { value: 'tile', label: '平铺全页' },
                { value: 'center', label: '居中一枚' },
                { value: 'corners', label: '四角各一枚' },
              ]}
              ariaLabel="水印位置"
              title="水印位置"
              triggerClassName="w-32"
            />
          </Field>
          <Field label="颜色">
            <div className="flex flex-wrap items-center justify-end gap-1.5" role="group" aria-label="水印颜色">
              {WATERMARK_COLORS.map((c) => {
                const active = color.toLowerCase() === c.value.toLowerCase()
                return (
                  <button
                    key={c.value}
                    type="button"
                    aria-label={`水印颜色：${c.label}`}
                    aria-pressed={active}
                    onClick={() => setColor(c.value)}
                    className={cn(
                      'w-6 h-6 rounded-full border-2 cursor-pointer transition-transform shrink-0',
                      active ? 'border-primary scale-110 ring-2 ring-primary/30' : 'border-outline hover:scale-105',
                    )}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                )
              })}
              <label
                className="relative inline-flex w-6 h-6 rounded-full border border-outline overflow-hidden cursor-pointer shrink-0 focus-within:ring-2 focus-within:ring-primary/40"
                style={{ backgroundColor: color }}
                title="自定义颜色"
              >
                <input
                  type="color"
                  aria-label="自定义水印颜色"
                  value={/^#[\da-f]{6}$/i.test(color) ? color : '#464646'}
                  onChange={(e) => setColor(e.target.value.toUpperCase())}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </label>
            </div>
          </Field>
          <div>
            <p className="text-[12px] font-medium text-on-surface-2 mb-1 flex items-center justify-between">
              <span>字号</span>
              <span className="text-on-surface tabular-nums">{fontSize} pt</span>
            </p>
            <input
              type="range"
              min={16}
              max={64}
              step={2}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              aria-label="水印字号"
              className="reader-range w-full cursor-pointer"
              style={{ ['--range-pct' as string]: `${((fontSize - 16) / 48) * 100}%` } as React.CSSProperties}
            />
          </div>
          <div>
            <p className="text-[12px] font-medium text-on-surface-2 mb-1 flex items-center justify-between">
              <span>透明度</span>
              <span className="text-on-surface tabular-nums">{Math.round(opacity * 100)}%</span>
            </p>
            <input
              type="range"
              min={5}
              max={80}
              step={5}
              value={Math.round(opacity * 100)}
              onChange={(e) => setOpacity(Number(e.target.value) / 100)}
              aria-label="水印透明度"
              className="reader-range w-full cursor-pointer"
              style={{ ['--range-pct' as string]: `${((opacity * 100 - 5) / 75) * 100}%` } as React.CSSProperties}
            />
          </div>
          <div>
            <p className="text-[12px] font-medium text-on-surface-2 mb-1 flex items-center justify-between">
              <span>角度</span>
              <span className="text-on-surface tabular-nums">{angle}°</span>
            </p>
            <input
              type="range"
              min={-90}
              max={90}
              step={5}
              value={angle}
              onChange={(e) => setAngle(Number(e.target.value))}
              aria-label="水印角度"
              className="reader-range w-full cursor-pointer"
              style={{ ['--range-pct' as string]: `${((angle + 90) / 180) * 100}%` } as React.CSSProperties}
            />
          </div>
        </>
      ) : (
        <>
          <Field label="起始编号"><input type="number" aria-label="起始编号" min={1} max={999999} value={start} onChange={e => setStart(e.target.value)} className={cn(FIELD_INPUT, 'w-28 sm:w-28 tabular-nums')} /></Field>
          <Field label="格式">
            <SelectMenu
              value={format}
              onChange={(v) => setFormat(v as PageNumberFormat)}
              options={[
                { value: 'n', label: '7' },
                { value: 'n/total', label: '7 / 42' },
                { value: 'cn', label: '第 7 页' },
              ]}
              ariaLabel="页码格式"
              title="页码格式"
              triggerClassName="w-28"
            />
          </Field>
          <Field label="位置">
            <SelectMenu
              value={pos}
              onChange={(v) => setPos(v as PageNumberPos)}
              options={[
                { value: 'left', label: '页脚左侧' },
                { value: 'center', label: '页脚居中' },
                { value: 'right', label: '页脚右侧' },
              ]}
              ariaLabel="页码位置"
              title="页码位置"
              triggerClassName="w-32"
            />
          </Field>
        </>
      )}

      <Field label="文件名">
        <input
          value={name}
          onChange={(e) => {
            setNameEdited(true)
            setName(e.target.value)
          }}
          placeholder={kind === 'watermark' ? '加水印' : '加页码'}
          className={FIELD_INPUT}
        />
      </Field>

      <OutputBar make={make} action="导出" disabled={!file} />
    </Panel>
  )
}
