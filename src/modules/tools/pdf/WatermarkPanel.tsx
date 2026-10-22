import { useState } from 'react'
import { FileText, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { Segmented } from '@/shared/ui/Segmented'
import { pdfPageInfos, pageNumberStamp, pageNumberText, stampPngs, watermarkStamps, type PageNumberFormat, type Stamp } from './pdfOps'
import type { PageNumberPos } from './layout'
import { renderTextPng } from './textPng'
import { type ToolOutput } from './output'
import { Field, FilePicker, OutputBar, Panel, fileBytes, pdfBlob } from './parts'

type Kind = 'watermark' | 'pagenum'

/** 水印 / 页码：文字用 canvas 渲成透明 PNG 再贴（不嵌中文字体，产物不膨胀） */
export function WatermarkPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<Kind>('watermark')
  const [text, setText] = useState('内部资料')
  const [opacity, setOpacity] = useState(0.15)
  const [angle, setAngle] = useState(30)
  const [position, setPosition] = useState<'tile' | 'center' | 'corners'>('tile')
  const [format, setFormat] = useState<PageNumberFormat>('n/total')
  const [pos, setPos] = useState<PageNumberPos>('center')
  const [name, setName] = useState('加水印')

  const make = async (): Promise<ToolOutput> => {
    if (!file) throw new Error('先选一份 PDF')
    const bytes = await fileBytes(file)
    const infos = await pdfPageInfos(bytes)
    if (!infos.length) throw new Error('文档没有页面')

    if (kind === 'watermark') {
      const t = text.trim()
      if (!t) throw new Error('水印文字不能为空')
      const png = await renderTextPng(t, { fontSize: 28, angle, bold: true, color: 'rgba(70,70,70,1)' })
      const stamps = watermarkStamps(png.bytes, png.width, png.height, infos, {
        position,
        opacity,
      })
      return {
        blob: pdfBlob(await stampPngs(bytes, stamps)),
        filename: `${name.trim() || '加水印'}.pdf`,
        isPdf: true,
      }
    }

    // 页码：每页文字不同，逐页渲小 PNG 贴到底部
    const stamps: Stamp[] = []
    for (let i = 0; i < infos.length; i++) {
      const label = pageNumberText(i, infos.length, format)
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
      desc="文字渲成透明 PNG 平铺或放角落，不嵌中文字体；页码同理贴在页脚。"
    >
      {file ? (
        <div className="flex items-center gap-2 rounded-[12px] border border-outline bg-surface-2 px-3 py-2">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-primary-soft text-primary shrink-0">
            <FileText size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-5 truncate">{file.name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setFile(null)} aria-label="移除">
            <X size={16} />
          </Button>
        </div>
      ) : (
        <FilePicker accept="application/pdf" label="选择 PDF" onPick={(files) => setFile(files[0])} />
      )}

      <Segmented
        options={[
          { value: 'watermark', label: '文字水印' },
          { value: 'pagenum', label: '页码' },
        ]}
        value={kind}
        onChange={(v) => setKind(v as Kind)}
        ariaLabel="类型"
        className="self-start"
      />

      {kind === 'watermark' ? (
        <>
          <Field label="水印文字">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="内部资料"
              className="w-52 h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[13px] outline-none focus:border-primary/60"
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
          onChange={(e) => setName(e.target.value)}
          placeholder="加水印"
          className="w-40 h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[13px] outline-none focus:border-primary/60 text-right"
        />
      </Field>

      <OutputBar make={make} action="导出" disabled={!file} />
    </Panel>
  )
}
