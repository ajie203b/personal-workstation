import { Capacitor, registerPlugin } from '@capacitor/core'
import { bytesToBase64 } from './http'
import { isTauri } from './native'

export class SaveCancelledError extends Error {
  constructor() {
    super('已取消保存')
    this.name = 'SaveCancelledError'
  }
}

export function isSaveCancelled(err: unknown): boolean {
  return err instanceof SaveCancelledError || (err instanceof Error && err.name === 'SaveCancelledError')
}

let lastTauriSavedPath: string | null = null

export interface FileExportPlugin {
  saveToDownloads(options: {
    dataBase64: string
    fileName: string
    mimeType: string
  }): Promise<{ path: string; uri: string }>
  downloadToDownloads(options: {
    url: string
    fileName: string
    mimeType: string
    headers?: Record<string, string>
  }): Promise<{ path: string; uri: string }>
  shareFile(options: {
    fileName: string
    dataBase64: string
    mimeType: string
    title: string
  }): Promise<void>
  openSavedLocation(): Promise<{ location: 'folder' | 'downloads' | 'unavailable' }>
  openAppSettings?: () => Promise<void>
  addListener?: (
    eventName: 'downloadProgress',
    listenerFunc: (event: { fileName: string; loaded: number; total: number }) => void,
  ) => Promise<{ remove: () => Promise<void> }>
}

export const FileExport = registerPlugin<FileExportPlugin>('FileExport')

/** Blob → base64（裸内容，不带 data: 前缀）。分块转，全本 TXT 几 MB 也不会撑爆单次入参 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
}

/** 安卓壳：由原生 OkHttp 流式下载直写「下载/个人工作站」，避免大文件过桥占内存；支持实时字节进度回调 */
export async function downloadUrlToDownloads(
  url: string,
  filename: string,
  headers?: Record<string, string>,
  mimeType = 'application/octet-stream',
  onProgress?: (loaded: number, total: number) => void,
): Promise<string> {
  let handle: { remove: () => Promise<void> } | null = null
  if (onProgress && FileExport.addListener) {
    try {
      handle = await FileExport.addListener('downloadProgress', (ev) => {
        if (!ev.fileName || ev.fileName === filename) {
          onProgress(ev.loaded, ev.total)
        }
      })
    } catch {
      handle = null
    }
  }
  try {
    const res = await FileExport.downloadToDownloads({ url, fileName: filename, mimeType, headers })
    return res.path || `下载/个人工作站/${filename}`
  } finally {
    void handle?.remove().catch(() => undefined)
  }
}

/**
 * 把 Blob 存到用户真能找到的地方，返回落盘位置（给 toast 明说）。
 *
 * - 安卓 App：WebView 对 blob: 的 <a download> 静默丢弃（原生也没接 DownloadListener），
 *   必须把字节交给原生写进「下载/个人工作站」，保存完成后保留在应用内，由 Toast「打开位置」按需跳出
 * - Windows Tauri 桌面版：弹出原生「另存为」对话框并原子写盘，落盘后支持 Toast「打开位置」定位文件
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
  if (isTauri()) {
    const [{ invoke }, dataBase64] = await Promise.all([
      import('@tauri-apps/api/core'),
      blobToBase64(blob),
    ])
    const saved = await invoke<string | null>('save_binary_file', { defaultName: filename, dataBase64 })
    if (!saved) throw new SaveCancelledError()
    lastTauriSavedPath = saved
    return saved
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return '浏览器下载目录'
}

/**
 * 生成文件后的 toast 按钮：
 * - 安卓壳：跳到系统文件管理器「下载/个人工作站」
 * - Windows Tauri 桌面版：在资源管理器中直接选中刚才保存的文件
 * - 浏览器：没有可定位的下载目录，返回 undefined
 */
export function openSavedAction(): { label: string; run: () => void } | undefined {
  if (Capacitor.isNativePlatform()) {
    return {
      label: '打开位置',
      run: () => { void FileExport.openSavedLocation().catch(() => undefined) },
    }
  }
  if (isTauri() && lastTauriSavedPath) {
    const target = lastTauriSavedPath
    return {
      label: '打开位置',
      run: () => {
        void import('@tauri-apps/api/core')
          .then(({ invoke }) => invoke('reveal_saved_file', { path: target }))
          .catch(() => undefined)
      },
    }
  }
  return undefined
}
