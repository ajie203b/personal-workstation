import { Capacitor, registerPlugin } from '@capacitor/core'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './native'

export interface ArchiveBook {
  id: string
  name: string
  size: number
}

export interface ArchiveDownloads {
  items: ArchiveBook[]
  downloading: boolean
  progress?: { received: number; total: number | null } | null
  error?: string | null
}

interface ArchiveBrowserPlugin {
  open(): Promise<void>
  list(): Promise<ArchiveDownloads>
  file(options: { id: string }): Promise<{ uri: string }>
  remove(options: { id: string }): Promise<void>
}

const android = registerPlugin<ArchiveBrowserPlugin>('ArchiveBrowser')
export const openAndroidArchive = () => android.open()

type BrowserAction = 'show' | 'resize' | 'hide' | 'back' | 'reload' | 'home'
type Bounds = Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>

// Serializing native layout changes prevents a late show from covering another route.
let browserOperation: Promise<void> = Promise.resolve()

export function controlDesktopArchive(action: BrowserAction, rect?: Bounds): Promise<void> {
  const bounds = rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  const next = browserOperation.then(() => invoke<void>('archive_browser', { action, bounds }))
  browserOperation = next.catch(() => {})
  return next
}

export function listArchiveDownloads(): Promise<ArchiveDownloads> {
  return isTauri() ? invoke('archive_downloads') : android.list()
}

export function downloadArchiveLink(link: string): Promise<void> {
  return invoke('archive_download_link', { link })
}

export function removeArchiveDownload(id: string): Promise<void> {
  return isTauri() ? invoke('archive_download_remove', { id }) : android.remove({ id })
}

export async function readArchiveDownload(book: ArchiveBook): Promise<File> {
  let blob: Blob
  if (isTauri()) {
    const bytes = await invoke<ArrayBuffer>('archive_download_read', { id: book.id })
    blob = new Blob([bytes])
  } else {
    const { uri } = await android.file({ id: book.id })
    const response = await fetch(Capacitor.convertFileSrc(uri))
    if (!response.ok) throw new Error('无法读取下载的电子书')
    blob = await response.blob()
  }

  const pdf = /\.pdf$/i.test(book.name)
  const header = new Uint8Array(await blob.slice(0, 1024).arrayBuffer())
  const valid = pdf
    ? new TextDecoder().decode(header).includes('%PDF-')
    : /\.epub$/i.test(book.name) && header[0] === 0x50 && header[1] === 0x4b && header[2] === 3 && header[3] === 4
  if (!valid || blob.size !== book.size) throw new Error('下载内容与文件格式不符，请回到网页换一个版本')
  return new File([blob], book.name, { type: pdf ? 'application/pdf' : 'application/epub+zip' })
}
