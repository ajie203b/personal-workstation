import { Capacitor, registerPlugin } from '@capacitor/core'

interface FileExportPlugin {
  saveToDownloads(options: {
    dataBase64: string
    fileName: string
    mimeType: string
  }): Promise<{ path: string; uri: string }>
  openSavedLocation(): Promise<void>
}

const FileExport = registerPlugin<FileExportPlugin>('FileExport')

/** Blob → base64（裸内容，不带 data: 前缀）。分块转，全本 TXT 几 MB 也不会撑爆单次入参 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * 把 Blob 存到用户真能找到的地方，返回落盘位置（给 toast 明说）。
 *
 * - 安卓 App：WebView 对 blob: 的 <a download> 静默丢弃（原生也没接 DownloadListener），
 *   必须把字节交给原生写进「下载/个人工作站」，否则 toast 说已导出、文件却哪都没有
 * - 浏览器 / PWA：走 <a download>，落点是浏览器的下载目录
 */
export async function saveBlob(blob: Blob, filename: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const dataBase64 = await blobToBase64(blob)
    const res = await FileExport.saveToDownloads({
      dataBase64,
      fileName: filename,
      mimeType: blob.type || 'application/octet-stream',
    })
    return res.path || `下载/个人工作站/${filename}`
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  return '浏览器下载目录'
}

/**
 * 生成文件后的 toast 按钮：跳到「下载/个人工作站」。
 * 只有安卓壳能打开系统文件管理器；浏览器 / 桌面没有可定位的下载目录，返回 undefined。
 */
export function openSavedAction(): { label: string; run: () => void } | undefined {
  if (!Capacitor.isNativePlatform()) return undefined
  return {
    label: '打开位置',
    run: () => { void FileExport.openSavedLocation().catch(() => undefined) },
  }
}
