import type { DocKind } from '@/db/db'
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
const SRC: Record<DocKind, string> = { pdf, epub, docx, pptx, txt, md }

export function FileTypeIcon({ kind, size = 28, className }: { kind: DocKind; size?: number; className?: string }) {
  return <img src={SRC[kind] ?? txt} width={size} height={size} alt="" aria-hidden draggable={false} className={className} />
}
