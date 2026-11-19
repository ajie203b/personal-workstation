import { Capacitor, registerPlugin } from '@capacitor/core'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './native'

export type ArchiveDownloadTarget = 'app' | 'local'

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
  target?: ArchiveDownloadTarget
  lastSavedPath?: string | null
}

interface ArchiveBrowserPlugin {
  open(): Promise<void>
  list(): Promise<ArchiveDownloads>
  file(options: { id: string }): Promise<{ uri: string }>
  saveToLocal(options: { id: string }): Promise<{ path: string }>
  remove(options: { id: string }): Promise<void>
}

const android = registerPlugin<ArchiveBrowserPlugin>('ArchiveBrowser')
export const openAndroidArchive = () => android.open()

const KAIROS_IMPORTABLE_EXTS = new Set(['epub', 'pdf', 'docx', 'pptx', 'txt', 'md', 'markdown'])
const ZIP_CONTAINER_EXTS = new Set(['epub', 'docx', 'pptx'])

const MIME_BY_EXT: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  markdown: 'text/markdown;charset=utf-8',
}

export function archiveFileExt(name: string): string {
  const match = /\.([a-z0-9]{1,10})$/i.exec(name.trim())
  return match ? match[1].toLowerCase() : ''
}

export function canImportArchiveBook(name: string): boolean {
  return KAIROS_IMPORTABLE_EXTS.has(archiveFileExt(name))
}

type BrowserAction = 'show' | 'resize' | 'hide' | 'back' | 'reload' | 'home'
type Bounds = Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>

// Serializing native layout changes prevents a late show from covering another route.
let browserOperation: Promise<unknown> = Promise.resolve()

export function controlDesktopArchive(action: BrowserAction, rect?: Bounds): Promise<'ok' | 'exit'> {
  const bounds = rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  const next = browserOperation.then(() => invoke<'ok' | 'exit'>('archive_browser', { action, bounds }))
  browserOperation = next.catch(() => {})
  return next
}

export function setDesktopArchiveTarget(target: ArchiveDownloadTarget): Promise<void> {
  return invoke('archive_set_target', { target })
}

export function listArchiveDownloads(): Promise<ArchiveDownloads> {
  return isTauri() ? invoke('archive_downloads') : android.list()
}

export function downloadArchiveLink(link: string, target?: ArchiveDownloadTarget): Promise<void> {
  return invoke('archive_download_link', { link, target })
}

export function removeArchiveDownload(id: string): Promise<void> {
  return isTauri() ? invoke('archive_download_remove', { id }) : android.remove({ id })
}

export async function saveArchiveDownloadToLocal(book: ArchiveBook): Promise<string | null> {
  if (isTauri()) {
    return invoke<string | null>('archive_download_save_local', { id: book.id })
  }
  const { path } = await android.saveToLocal({ id: book.id })
  return path || `下载/个人工作站/${book.name}`
}

export function openDesktopDownloadsDir(): Promise<void> {
  return invoke('archive_open_downloads_dir')
}

export async function readArchiveDownload(book: ArchiveBook): Promise<File> {
  let blob: Blob
  if (isTauri()) {
    const bytes = await invoke<ArrayBuffer>('archive_download_read', { id: book.id })
    blob = new Blob([bytes])
  } else {
    const { uri } = await android.file({ id: book.id })
    const response = await fetch(Capacitor.convertFileSrc(uri))
    if (!response.ok) throw new Error('无法读取下载的文件')
    blob = await response.blob()
  }

  const ext = archiveFileExt(book.name)
  const header = new Uint8Array(await blob.slice(0, 1024).arrayBuffer())
  const headerText = new TextDecoder().decode(header)
  let valid: boolean
  if (ext === 'pdf') {
    valid = headerText.includes('%PDF-')
  } else if (ZIP_CONTAINER_EXTS.has(ext)) {
    valid = header[0] === 0x50 && header[1] === 0x4b && header[2] === 3 && header[3] === 4
  } else {
    const trimmed = headerText.replace(/^\uFEFF/, '').trimStart().toLowerCase()
    valid = !trimmed.startsWith('<!doctype html') && !trimmed.startsWith('<html') && !trimmed.startsWith('<head')
  }
  if (!valid || blob.size !== book.size) throw new Error('下载内容与文件格式不符，请回到网页换一个版本')
  return new File([blob], book.name, { type: MIME_BY_EXT[ext] || 'application/octet-stream' })
}
