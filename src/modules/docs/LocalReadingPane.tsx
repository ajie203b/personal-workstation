import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Copy, ListPlus } from 'lucide-react'
import type { Doc } from '@/db/db'
import { db } from '@/db/db'
import { mdContentHash } from '@/db/docs'
import { useAnnotations } from '@/db/hooks'
import { useUi } from '@/stores/ui'
import type { LocalDocument } from '@/lib/localMarkdown'
import { MdReader, type MdSelectionInfo } from './MdReader'
import { linkLocalMarkdown } from './localMarkdownLibrary'
import { DEFAULT_SETTINGS, useReadingPosition, type JumpTarget } from './reader/useReadingPosition'
import { useDocAnnotations } from './reader/useDocAnnotations'
import { HL_COLORS, type Selection } from './reader/types'
import { ReaderSettingsPanel } from './reader/ReaderSettingsPanel'
import { AnnotationTaskDialog } from './reader/AnnotationTaskDialog'

export function LocalReadingPane({ document, onLink, renderImage, jump, settingsOpen, onCloseSettings }: {
  document: LocalDocument
  onLink: (href: string) => void
  renderImage: (src: string | undefined, alt: string | undefined) => React.ReactNode
  jump: JumpTarget | null
  settingsOpen: boolean
  onCloseSettings: () => void
}) {
  const navigate = useNavigate()
  const toast = useUi(s => s.toast)
  const [linked, setLinked] = useState<Doc>()
  const [selection, setSelection] = useState<Selection | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const localHash = useMemo(() => mdContentHash('local-position', document.path), [document.path])
  const annotations = useAnnotations(linked?.hash)
  const reading = useReadingPosition({ docHash: linked?.hash ?? localHash, paramP: null, paramHl: undefined })
  useEffect(() => {
    let alive = true
    void linkLocalMarkdown(document.path, document.markdown).then(doc => { if (alive) setLinked(doc ?? undefined) }).catch(() => { if (alive) toast('关联文档更新失败，请重试') })
    return () => { alive = false }
  }, [document.path, document.markdown, toast])
  const resolveDoc = useCallback(async () => {
    const saved = await linkLocalMarkdown(document.path, document.markdown, true)
    if (!saved) throw new Error('文档保存失败')
    const position = await db.positions.get(localHash)
    if (position && !(await db.positions.get(saved.hash))) await db.positions.put({ ...position, hash: saved.hash })
    setLinked(saved)
    return saved
  }, [document.path, document.markdown, localHash])
  const clearSelection = useCallback(() => setSelection(null), [])
  const onSelection = useCallback((selected: MdSelectionInfo | null) => setSelection(selected ? { ...selected, kind: 'md' } : null), [])
  const actions = useDocAnnotations({ doc: linked, resolveDoc, selection, clearSelection, toast, onExported: id => navigate(`/docs/${id}`) })
  const initialTarget = reading.initialTarget && 'blockIdx' in reading.initialTarget ? reading.initialTarget : null
  const restore = useCallback(() => {}, [])
  const closeSettings = onCloseSettings
  return <>
    <MdReader hash={linked?.hash ?? localHash} md={document.markdown} settings={reading.settings} annotations={annotations} jump={jump ?? reading.jump} onSelection={onSelection} onProgress={reading.setProgressPct} onRestored={restore} scrollRef={scrollRef} initialTarget={initialTarget} onLink={onLink} renderImage={renderImage} />
    {selection && <div className="sel-popover" style={{ left: Math.min(Math.max(selection.popover.left, 110), window.innerWidth - 110), top: Math.max(selection.popover.y, 8), transform: selection.popover.below ? 'translate(-50%, 10px)' : 'translate(-50%, -100%)' }}>
      {HL_COLORS.map(color => <button key={color} aria-label={`高亮-${color}`} title="高亮并保存到文档工作站" onMouseDown={e => e.preventDefault()} onClick={() => void actions.create(color).catch(() => toast('高亮保存失败，请重试'))} className={`w-7 h-7 rounded-full hl-${color} border border-outline/60 hover:scale-110 transition-transform`} />)}
      <span className="w-px h-5 bg-outline mx-1" />
      <button aria-label="复制选中文本" className="grid place-items-center w-8 h-8 rounded-lg hover:bg-surface-3" onMouseDown={e => e.preventDefault()} onClick={() => void navigator.clipboard.writeText(selection.text).then(() => toast('已复制')).catch(() => toast('复制失败'))}><Copy size={15} /></button>
      <button aria-label="高亮并转为任务" title="高亮并转为任务" className="grid place-items-center w-8 h-8 rounded-lg text-primary hover:bg-primary-soft" onMouseDown={e => e.preventDefault()} onClick={() => void actions.create('yellow', true).catch(() => toast('无法创建任务，请重试'))}><ListPlus size={15} /></button>
    </div>}
    <AnnotationTaskDialog task={actions.task} />
    {settingsOpen && <ReaderSettingsPanel doc={{ kind: 'md' }} settings={reading.settings} updateSettings={reading.updateSettings} placement="center" onClose={closeSettings} onResetLayout={() => reading.updateSettings({ ...DEFAULT_SETTINGS, theme: reading.settings.theme })} />}
  </>
}
