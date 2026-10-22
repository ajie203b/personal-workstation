import { useState } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { cn } from '@/lib/cn'
import { uid } from '@/lib/id'
import { fileToEmbeddedImage } from './imageInput'
import { imagesToPdf } from './pdfOps'
import type { ImagePageSize } from './layout'
import { yieldToUi, type ToolOutput } from './output'
import { Field, FilePicker, OutputBar, Panel, pdfBlob } from './parts'

interface Item {
  id: string
  file: File
}

const SIZE_OPTIONS: { value: ImagePageSize; label: string }[] = [
  { value: 'a4', label: 'A4 等比居中' },
  { value: 'native', label: '原图尺寸' },
  { value: 'fit', label: '自适应长图' },
]

const MARGINS = [0, 12, 24, 36]

/** 图片转 PDF：JPG/PNG 直贴，其他格式转 JPEG；EXIF 方向解码时转正 */
export function ImagesToPdfPanel() {
  const [items, setItems] = useState<Item[]>([])
  const [size, setSize] = useState<ImagePageSize>('a4')
  const [margin, setMargin] = useState('12')
  const [name, setName] = useState('图片')

  const make = async (): Promise<ToolOutput> => {
    if (!items.length) throw new Error('先选几张图片')
    const images = []
    for (const it of items) {
      images.push(await fileToEmbeddedImage(it.file))
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
    <Panel title="图片转 PDF" desc="每张图一页；照片的 EXIF 方向会自动转正，截图/PNG 保留透明底。">
      <FilePicker
        accept="image/*"
        multiple
        label="添加图片"
        hint="JPG / PNG 直贴，其他格式自动转 JPEG"
        onPick={(files) => setItems((list) => [...list, ...files.map((file) => ({ id: uid(), file }))])}
      />

      {items.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {items.map((it, index) => (
            <li key={it.id} className="flex items-center gap-2 rounded-[10px] border border-outline bg-surface-2 px-2 py-1.5">
              <span className="grid place-items-center w-7 h-7 rounded-[8px] bg-primary-soft text-primary shrink-0">
                <ImageIcon size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] leading-5 truncate">{it.file.name}</p>
                <p className="text-[11px] text-on-surface-2">
                  第 {index + 1} 页 · {(it.file.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="移除"
                onClick={() => setItems((list) => list.filter((i) => i.id !== it.id))}
              >
                <X size={15} />
              </Button>
            </li>
          ))}
        </ul>
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
          className="w-40 h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[13px] outline-none focus:border-primary/60 text-right"
        />
      </Field>

      <OutputBar make={make} action="转换" disabled={!items.length} />
    </Panel>
  )
}
