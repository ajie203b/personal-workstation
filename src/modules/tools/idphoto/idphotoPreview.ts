import type { CSSProperties } from 'react'
import { cropGuides, type CropBox } from './idphotoCrop'
import type { RgbaImage } from './idphotoEngine'

export const CHECKERBOARD_STYLE: CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)',
  backgroundSize: '12px 12px',
  backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
  backgroundColor: '#ffffff',
}

// 取景预览：裁剪框超出原图时扩展画布，保留完整的裁剪框。
export function drawFacePreview(canvas: HTMLCanvasElement, image: RgbaImage, crop: CropBox) {
  const pad = 12
  const minX = Math.min(0, crop.x - pad)
  const minY = Math.min(0, crop.y - pad)
  const maxX = Math.max(image.width, crop.x + crop.width + pad)
  const maxY = Math.max(image.height, crop.y + crop.height + pad)
  const expanded = crop.x < 0 || crop.y < 0 || crop.x + crop.width > image.width || crop.y + crop.height > image.height
  const viewX = expanded ? minX : 0
  const viewY = expanded ? minY : 0
  const viewW = expanded ? maxX - minX : image.width
  const viewH = expanded ? maxY - minY : image.height

  const scale = Math.min(1, 640 / Math.max(viewW, viewH))
  canvas.width = Math.max(1, Math.round(viewW * scale))
  canvas.height = Math.max(1, Math.round(viewH * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.fillStyle = '#1E293B'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const src = document.createElement('canvas')
  src.width = image.width
  src.height = image.height
  const sctx = src.getContext('2d')
  if (!sctx) return
  sctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0)

  const ox = -viewX * scale
  const oy = -viewY * scale
  ctx.drawImage(src, ox, oy, image.width * scale, image.height * scale)

  if (expanded) {
    ctx.save()
    ctx.strokeStyle = 'rgba(148,163,184,0.65)'
    ctx.setLineDash([4, 4])
    ctx.strokeRect(ox, oy, image.width * scale, image.height * scale)
    ctx.restore()
  }

  const k = scale
  const g = cropGuides(crop)
  const cx = ox + crop.x * k
  const cy = oy + crop.y * k
  const cw = crop.width * k
  const ch = crop.height * k

  ctx.strokeStyle = 'rgba(255,255,255,0.92)'
  ctx.lineWidth = 2
  ctx.strokeRect(cx, cy, cw, ch)
  ctx.strokeStyle = 'rgba(67,142,219,0.9)'
  ctx.lineWidth = 1
  for (const y of g.thirdLinesY) {
    ctx.beginPath()
    ctx.moveTo(cx, oy + y * k)
    ctx.lineTo(cx + cw, oy + y * k)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(217,0,27,0.9)'
  ctx.beginPath()
  ctx.moveTo(cx, oy + g.eyeLineY * k)
  ctx.lineTo(cx + cw, oy + g.eyeLineY * k)
  ctx.stroke()
}
