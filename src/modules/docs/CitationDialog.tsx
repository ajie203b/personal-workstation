import { Copy } from 'lucide-react'
import type { Doc } from '@/db/db'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { formatCitation, type CitationStyle } from './citation'

export function CitationDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const toast = useUi((state) => state.toast)

  async function copy(style: CitationStyle, label: string) {
    try {
      await navigator.clipboard.writeText(formatCitation(doc, style))
      toast(`已复制 ${label} 引文`)
      onClose()
    } catch {
      toast('复制失败，请重试')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }} title="引用" description={doc.title}>
      <div className="flex flex-wrap gap-2">
        {([['bibtex', 'BibTeX'], ['ris', 'RIS'], ['markdown', 'Markdown']] as const).map(([style, label]) => (
          <Button key={style} variant="outline" onClick={() => void copy(style, label)}><Copy size={14} />复制 {label}</Button>
        ))}
      </div>
    </Dialog>
  )
}
