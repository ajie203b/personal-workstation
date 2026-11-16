import { useEffect, useState } from 'react'
import { RotateCw, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { uid } from '@/lib/id'
import { fileToEmbeddedImage } from './imageInput'
import { imagesToPdf } from './pdfOps'
import type { ImagePageSize } from './layout'
import { yieldToUi, type ToolOutput } from './output'
import { FIELD_INPUT, Field, FilePicker, OutputBar, Panel, pdfBlob } from './parts'
import { arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { DragSort, DragSortItem } from '@/shared/ui/DragSort'

interface Item {
  id: string
  file: File
  rot: number
}

const SIZE_OPTIONS: { value: ImagePageSize; label: string }[] = [
  { value: 'a4', label: 'A4 等比居中' },
  { value: 'native', label: '原图尺寸' },
  { value: 'fit', label: '自适应长图' },
]

const MARGINS = [0, 12, 24, 36]

function ImageThumb({ file, rot }: { file: File; rot: number }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const objUrl = URL.createObjectURL(file)
    setUrl(objUrl)
    return () => URL.revokeObjectURL(objUrl)
  }, [file])
  return (
    <span className="grid place-items-center w-10 h-10 rounded-[8px] border border-outline bg-white overflow-hidden shrink-0">
      {url && (
        <img
          src={url}
          alt=""
          className="max-w-full max-h-full object-contain transition-transform duration-150 pointer-events-none select-none"
          style={{ transform: rot ? `rotate(${rot}deg)` : undefined }}
          draggable={false}
        />
      )}
    </span>
  )
}

/** 图片转 PDF：JPG/PNG 直贴，其他格式白底转 JPEG；EXIF 方向解码时转正 */
export function ImagesToPdfPanel() {
  const [items, setItems] = useState<Item[]>([])
  const [size, setSize] = useState<ImagePageSize>('a4')
  const [margin, setMargin] = useState('12')
  const [name, setName] = useState('图片')

  const make = async (): Promise<ToolOutput> => {
    if (!items.length) throw new Error('先选几张图片')
    const images = []
    for (const it of items) {
      images.push(await fileToEmbeddedImage(it.file, it.rot))
      await yieldToUi()
    }
    const m = Number(margin)
    const bytes = await imagesToPdf(images, { size, margin: m })
    return { blob: pdfBlob(bytes), filename: `${name.trim() || '图片'}.pdf`, isPdf: true }
  }

  // 预览第一张图的版式说明
  const hint = items.length
    ? size === 'a4'
      ? '每页 A4，图片等比缩放居中'
      : size === 'native'
        ? `页面 = 图片尺寸 + ${margin}pt 边距`
        : '页宽固定 A4 宽，页高随图片拉长（长截图不裁切）'
    : undefined

  return (
    <Panel title="图片转 PDF" desc="每张图一页；支持拖拽排序与单图 90° 旋转，照片 EXIF 自动转正。">
      <FilePicker
        accept="image/*"
        multiple
        label="添加图片"
        hint="JPG / PNG 直贴，WebP / GIF / SVG 自动白底转换"
        onPick={(files) => setItems((list) => [...list, ...files.map((file) => ({ id: uid(), file, rot: 0 }))])}
      />

      {items.length > 0 && (
        <DragSort ids={items.map(i => i.id)} strategy={verticalListSortingStrategy} onMove={(active, over) => setItems(list => arrayMove(list, list.findIndex(i => i.id === active), list.findIndex(i => i.id === over)))}>
        <ul className="flex flex-col gap-1.5">
          {items.map((it, index) => (
            <DragSortItem as="li" id={it.id} key={it.id} className="flex items-center gap-2 rounded-[10px] border border-outline bg-surface-2 px-2 py-1.5">
              <ImageThumb file={it.file} rot={it.rot} />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] leading-5 truncate">{it.file.name}</p>
                <p className="text-[11px] text-on-surface-2 tabular-nums">
                  第 {index + 1} 页 · {formatBytes(it.file.size)}{it.rot ? ` · ${it.rot}°` : ''}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 shrink-0"
                aria-label={`顺时针旋转 ${it.file.name} 90°`}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={() => setItems((list) => list.map((item) => (item.id === it.id ? { ...item, rot: (item.rot + 90) % 360 } : item)))}
              >
                <RotateCw size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 shrink-0"
                aria-label="移除"
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={() => setItems((list) => list.filter((i) => i.id !== it.id))}
              >
                <X size={15} />
              </Button>
            </DragSortItem>
          ))}
        </ul>
        </DragSort>
      )}

      <Field label="页面尺寸">
        <SelectMenu
          value={size}
          onChange={(v) => setSize(v as ImagePageSize)}
          options={SIZE_OPTIONS}
          ariaLabel="页面尺寸"
          title="页面尺寸"
          triggerClassName="w-40"
        />
      </Field>
      <Field label="边距">
        <SelectMenu
          value={margin}
          onChange={setMargin}
          options={MARGINS.map((m) => ({ value: String(m), label: `${m} pt` }))}
          ariaLabel="边距"
          title="边距"
          triggerClassName="w-28"
        />
      </Field>
      {hint && <p className={cn('text-[11px] text-on-surface-2 leading-relaxed')}>{hint}</p>}

      <Field label="文件名">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="图片"
          className={FIELD_INPUT}
        />
      </Field>

      <OutputBar make={make} action="转换" disabled={!items.length} />
    </Panel>
  )
}
