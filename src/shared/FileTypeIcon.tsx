import type { DocKind } from '@/db/db'
import { FileCode2 } from 'lucide-react'
import pdf from '@/assets/filetypes/pdf.svg'
import epub from '@/assets/filetypes/epub.svg'
import docx from '@/assets/filetypes/docx.svg'
import pptx from '@/assets/filetypes/pptx.svg'
import txt from '@/assets/filetypes/txt.svg'
import md from '@/assets/filetypes/md.svg'

/**
 * 文件格式图标：一眼分清是哪类文件。
 * PDF / EPUB / TXT / MD 取自 Material Icon Theme（MIT），DOCX / PPTX 取自 vscode-icons（MIT）。
 * SVG 很小，构建时内联成 data URI，离线也能显示。
 */
const SRC: Record<Exclude<DocKind, 'html'>, string> = { pdf, epub, docx, pptx, txt, md }

export function FileTypeIcon({ kind, size = 28, className }: { kind: DocKind; size?: number; className?: string }) {
  if (kind === 'html') return <FileCode2 size={size} className={className} aria-hidden />
  return <img src={SRC[kind] ?? txt} width={size} height={size} alt="" aria-hidden draggable={false} className={className} />
}
