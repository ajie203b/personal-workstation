import { invoke } from '@tauri-apps/api/core'

export interface LocalEntry { name: string; path: string; directory: boolean }
export interface LocalFolder { directory: string; parent: string | null; entries: LocalEntry[] }
export interface LocalDocument { path: string; markdown: string; version: string; base64?: string }

export function localFileKind(path: string) {
  switch (/\.([^./\\]+)$/.exec(path)?.[1].toLowerCase()) {
    case 'md': case 'markdown': return 'md'
    case 'txt': case 'csv': case 'tsv': case 'json': return 'text'
    case 'html': case 'htm': return 'html'
    case 'pdf': return 'pdf'
    case 'docx': return 'docx'
    case 'pptx': return 'pptx'
    case 'epub': return 'epub'
    default: return undefined
  }
}

export const localMarkdown = {
  pick: (folder: boolean) => invoke<string | null>('local_markdown_pick', { folder }),
  list: (directory: string) => invoke<LocalFolder>('local_markdown_list', { directory }),
  read: (path: string, knownVersion?: string) => invoke<LocalDocument | null>('local_markdown_read', { path, knownVersion }),
  write: (path: string, markdown: string, expectedVersion?: string) => invoke<LocalDocument>('local_markdown_write', { path, markdown, expectedVersion }),
  image: (path: string) => invoke<string>('local_markdown_image', { path }),
  openWith: (path: string) => invoke<void>('local_document_open_with', { path }),
  defaults: () => invoke<void>('local_markdown_defaults'),
}

export function fileName(path: string): string { return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path }
export function parentPath(path: string): string { return path.replace(/[^\\/]+$/, '') }

/** Decode relative URLs and resolve Windows verbatim paths; Rust still validates canonical scope. */
export function localLink(baseFile: string, href: string): { path: string; hash: string } | null {
  if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href) || /^[\\/]/.test(href)) return null
  const [file, hash = ''] = href.split('#', 2)
  try {
    const path = decodeURIComponent(file.split('?')[0])
    if (!path || path.includes('\0')) return null
    let resolved = parentPath(baseFile) + path
    // canonicalize on Windows returns a verbatim path: Win32 will not resolve
    // forward slashes or dot segments after \\?\, so resolve them before IO.
    if (baseFile.startsWith('\\\\?\\')) {
      const parts = resolved.slice(4).replace(/\//g, '\\').split('\\')
      const rootSize = parts[0] === 'UNC' ? 3 : 1
      const clean = parts.slice(0, rootSize)
      for (const part of parts.slice(rootSize)) {
        if (!part || part === '.') continue
        if (part === '..') { if (clean.length > rootSize) clean.pop() }
        else clean.push(part)
      }
      resolved = '\\\\?\\' + clean.join('\\')
    }
    return { path: resolved, hash: decodeURIComponent(hash) }
  } catch { return null }
}
