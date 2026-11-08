import { invoke } from '@tauri-apps/api/core'

export interface LocalEntry { name: string; path: string; directory: boolean }
export interface LocalFolder { directory: string; parent: string | null; entries: LocalEntry[] }
export interface LocalDocument { path: string; markdown: string; version: string }

export const localMarkdown = {
  pick: (folder: boolean) => invoke<string | null>('local_markdown_pick', { folder }),
  list: (directory: string) => invoke<LocalFolder>('local_markdown_list', { directory }),
  read: (path: string, knownVersion?: string) => invoke<LocalDocument | null>('local_markdown_read', { path, knownVersion }),
  write: (path: string, markdown: string, expectedVersion?: string) => invoke<LocalDocument>('local_markdown_write', { path, markdown, expectedVersion }),
  image: (path: string) => invoke<string>('local_markdown_image', { path }),
  defaults: () => invoke<void>('local_markdown_defaults'),
}

export function fileName(path: string): string { return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path }
export function parentPath(path: string): string { return path.replace(/[^\\/]+$/, '') }

/** Relative URL decoding only; canonical scope validation is always performed by Rust. */
export function localLink(baseFile: string, href: string): { path: string; hash: string } | null {
  if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href) || /^[\\/]/.test(href)) return null
  const [file, hash = ''] = href.split('#', 2)
  try {
    const path = decodeURIComponent(file.split('?')[0])
    if (!path || path.includes('\0')) return null
    return { path: parentPath(baseFile) + path, hash: decodeURIComponent(hash) }
  } catch { return null }
}
