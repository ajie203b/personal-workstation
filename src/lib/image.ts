/**
 * 图片插入（v2.0）：把选中的图片转成 data URL 存进 Markdown 正文。
 * 本地优先，不依赖任何图床；小图原样保留，大图等比缩到最长边 1600px 再编码，
 * 免得把几十 MB 的原始照片塞进一篇笔记（备份与同步都会跟着变重）。
 */
export async function fileToDataUrl(file: File, maxEdge = 1600): Promise<string> {
  const readAsDataUrl = () =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(r.error ?? new Error('读取图片失败'))
      r.readAsDataURL(file)
    })

  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.size <= 300 * 1024) {
    return readAsDataUrl()
  }

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close?.()
      return readAsDataUrl()
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    // 截图类（PNG）优先保真：小一点的仍用 PNG，大图用 WebP，最后才退 JPEG
    if (file.type === 'image/png' && file.size < 1_200_000) {
      return canvas.toDataURL('image/png')
    }
    const webp = canvas.toDataURL('image/webp', 0.9)
    if (webp.startsWith('data:image/webp')) return webp
    return canvas.toDataURL('image/jpeg', 0.9)
  } catch {
    return readAsDataUrl()
  }
}
