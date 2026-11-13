import { Copy, ListPlus, MessageSquareText, ScanText, Trash2 } from 'lucide-react'
import type { Annotation, Doc, Task } from '@/db/db'
import { Button } from '@/shared/ui/Button'
import { Dialog, Sheet } from '@/shared/ui/Sheet'
import type { TocItem } from '../PdfReader'
import { PanelHead, RightContent, TocContent } from './ReaderPanels'
import { HL_COLORS, type HlColor, type Selection } from './types'

/** 划词浮条（选区近顶部时自动翻转到下方，避免被裁切/遮挡） */
export function SelectionPopover({
  selection,
  onHighlight,
  onCopy,
}: {
  selection: Selection
  onHighlight: (color: HlColor, toTask?: boolean) => void
  onCopy: (text: string) => void
}) {
  return (
    <div
      className="sel-popover"
      style={{
        left: Math.min(Math.max(selection.popover.left, 104), window.innerWidth - 104),
        top: Math.max(selection.popover.y, 8),
        transform: selection.popover.below ? 'translate(-50%, 10px)' : 'translate(-50%, -100%)',
      }}
    >
      {HL_COLORS.map((c) => (
        <button
          key={c}
          aria-label={`高亮-${c}`}
          title={`高亮-${c}`}
          onClick={() => onHighlight(c)}
          className={`w-7 h-7 rounded-full hl-${c} border border-outline/60 hover:scale-110 transition-transform cursor-pointer`}
        />
      ))}
      <span className="w-px h-5 bg-outline mx-1" />
      <button
        aria-label="复制选中文本"
        title="复制选中文本"
        className="grid place-items-center w-7 h-7 rounded-lg text-on-surface-2 hover:bg-surface-3"
        onClick={() => onCopy(selection.text)}
      >
        <Copy size={15} />
      </button>
      <button
        aria-label="高亮并转为任务"
        title="高亮并转为任务"
        className="grid place-items-center w-7 h-7 rounded-lg text-primary hover:bg-primary-soft"
        onClick={() => onHighlight('yellow', true)}
      >
        <ListPlus size={15} />
      </button>
    </div>
  )
}

/** PDF 页内已存在批注的点击悬浮条 */
export function PdfAnnotationPopover({
  selected,
  ocrBusy,
  onRecolor,
  onOcr,
  onComment,
  onToTask,
  onDelete,
}: {
  selected: { ann: Annotation; popover: { left: number; y: number; below: boolean } }
  ocrBusy: boolean
  onRecolor: (id: string, color: HlColor) => void
  onOcr?: (ann: Annotation) => void
  onComment: (ann: Annotation) => void
  onToTask: (ann: Annotation) => void
  onDelete: (id: string) => void
}) {
  const { ann, popover } = selected
  return (
    <div
      className="sel-popover"
      style={{
        left: Math.min(Math.max(popover.left, 112), window.innerWidth - 112),
        top: Math.max(popover.y, 8),
        transform: popover.below ? 'translate(-50%, 10px)' : 'translate(-50%, -100%)',
      }}
    >
      {ann.kind !== 'shot' && HL_COLORS.map((c) => (
        <button
          key={c}
          aria-label={`改为${c}`}
          title={`改为${c}`}
          onClick={() => onRecolor(ann.id, c)}
          className={`w-6 h-6 rounded-full hl-${c} border ${ann.color === c ? 'border-on-surface ring-1 ring-on-surface' : 'border-outline/60'} hover:scale-110 transition-transform cursor-pointer`}
        />
      ))}
      {ann.kind !== 'shot' && <span className="w-px h-5 bg-outline mx-1" />}
      {ann.kind === 'shot' && ann.img && onOcr && (
        <button
          type="button"
          aria-label="OCR 识别截图文字"
          title="OCR 识别截图文字"
          disabled={ocrBusy}
          className="grid place-items-center h-7 px-2 rounded-lg text-[11.5px] font-medium text-primary hover:bg-primary-soft disabled:opacity-50 gap-1 inline-flex items-center cursor-pointer"
          onClick={() => onOcr(ann)}
        >
          <ScanText size={14} /> {ocrBusy ? '识别中…' : 'OCR'}
        </button>
      )}
      <button
        type="button"
        aria-label="评论此批注"
        title="评论"
        className="grid place-items-center w-7 h-7 rounded-lg text-on-surface-2 hover:bg-surface-3 cursor-pointer"
        onClick={() => onComment(ann)}
      >
        <MessageSquareText size={15} />
      </button>
      <button
        type="button"
        aria-label="转为任务"
        title="转为任务"
        className="grid place-items-center w-7 h-7 rounded-lg text-primary hover:bg-primary-soft cursor-pointer"
        onClick={() => onToTask(ann)}
      >
        <ListPlus size={15} />
      </button>
      <button
        type="button"
        aria-label="删除批注"
        title="删除"
        className="grid place-items-center w-7 h-7 rounded-lg text-on-surface-2 hover:text-danger hover:bg-surface-3 cursor-pointer"
        onClick={() => onDelete(ann.id)}
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

/** 读完提醒：把引用本文档的任务收尾 */
export function FinishReadingDialog({
  finishAsk,
  finishPicked,
  onTogglePick,
  onClose,
  onConfirm,
}: {
  finishAsk: Task[] | null
  finishPicked: Set<string>
  onTogglePick: (id: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={finishAsk != null}
      onOpenChange={(v) => !v && onClose()}
      title="这篇读完了"
      description="下面这些任务引用了本文档，要顺手标记完成吗？"
    >
      <div className="flex flex-col gap-1.5 max-h-[45dvh] overflow-y-auto">
        {finishAsk?.map((t) => {
          const checked = finishPicked.has(t.id)
          return (
            <label
              key={t.id}
              className="flex items-center gap-2.5 min-h-10 px-3 rounded-[10px] bg-surface-2 hover:bg-surface-3 transition-colors cursor-pointer"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onTogglePick(t.id)}
                className="w-4 h-4 shrink-0 accent-[var(--primary)]"
              />
              <span className="text-[13px] leading-snug">{t.title}</span>
            </label>
          )
        })}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button onClick={onClose}>稍后</Button>
        <Button variant="primary" disabled={finishPicked.size === 0} onClick={onConfirm}>
          完成所选
        </Button>
      </div>
    </Dialog>
  )
}

/** 移动端目录/批注抽屉 */
export function ReaderMobileSheets({
  mobilePanel,
  onClose,
  doc,
  docId,
  toc,
  mdHeadings,
  annotations,
  backlinks,
  leftTab,
  onLeftTabChange,
  rightTab,
  onRightTabChange,
  currentLocator,
  activeAnchor,
  onJump,
  onDeleteBookmark,
  onToTask,
  onDeleteAnnotation,
  onRecolorAnnotation,
  onCommentAnnotation,
  onOcrAnnotation,
  ocrBusyId,
  focusAnnId,
  anchorFor,
}: {
  mobilePanel: 'toc' | 'anns' | null
  onClose: () => void
  doc: Doc
  docId: string | undefined
  toc: TocItem[]
  mdHeadings: { level: number; text: string; blockIdx: number }[]
  annotations: Annotation[]
  backlinks: Task[]
  leftTab: 'toc' | 'marks'
  onLeftTabChange: (tab: 'toc' | 'marks') => void
  rightTab: 'anns' | 'backlinks'
  onRightTabChange: (tab: 'anns' | 'backlinks') => void
  currentLocator: string
  activeAnchor?: string
  onJump: (anchor: string, hlId?: string) => void
  onDeleteBookmark: (id: string) => void
  onToTask: (a: Annotation) => void
  onDeleteAnnotation: (id: string) => void
  onRecolorAnnotation: (id: string, c: HlColor) => void
  onCommentAnnotation: (id: string, comment?: string) => void
  onOcrAnnotation?: (a: Annotation) => void
  ocrBusyId?: string | null
  focusAnnId?: { id: string; ts: number } | null
  anchorFor: (a: Annotation) => string
}) {
  return (
    <>
      <Sheet open={mobilePanel === 'toc'} onOpenChange={(v) => !v && onClose()} title="目录与高亮">
        <PanelHead
          value={leftTab}
          onChange={onLeftTabChange}
          tabs={[
            { value: 'toc', label: '目录' },
            { value: 'marks', label: '高亮', count: annotations.length },
          ]}
          className="border-b-0 px-0"
        />
        <TocContent
          doc={doc}
          toc={toc}
          mdHeadings={mdHeadings}
          annotations={annotations}
          leftTab={leftTab}
          currentLocator={currentLocator}
          activeAnchor={activeAnchor}
          onJump={(a, hl) => {
            onJump(a, hl)
            onClose()
          }}
          onDeleteBookmark={onDeleteBookmark}
        />
      </Sheet>
      <Sheet open={mobilePanel === 'anns'} onOpenChange={(v) => !v && onClose()} title="批注与反链">
        <PanelHead
          value={rightTab}
          onChange={onRightTabChange}
          tabs={[
            { value: 'anns', label: '批注', count: annotations.length },
            { value: 'backlinks', label: '反链', count: backlinks.length },
          ]}
          className="border-b-0 px-0"
        />
        <RightContent
          annotations={annotations}
          backlinks={backlinks}
          rightTab={rightTab}
          onJump={(a, hl) => {
            onJump(a, hl)
            onClose()
          }}
          onToTask={onToTask}
          onDelete={onDeleteAnnotation}
          onRecolor={onRecolorAnnotation}
          onComment={onCommentAnnotation}
          onOcr={onOcrAnnotation}
          ocrBusyId={ocrBusyId}
          focusAnnId={focusAnnId}
          docId={docId}
          anchorFor={anchorFor}
        />
      </Sheet>
    </>
  )
}
