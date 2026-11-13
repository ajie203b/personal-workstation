import { ChevronLeft, ChevronRight, Eraser, FilePlus2, FileX2, LassoSelect, MoreHorizontal, PenLine, Redo2, Settings2, Sigma, Trash2, Undo2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { BackButton } from '@/shared/ui/BackButton'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem, MenuSeparator } from '@/shared/ui/Menu'
import type { Tool } from './canvasDraw'

function toolBtn(active: boolean) {
  return cn(
    'grid place-items-center w-8 h-9 sm:w-9 rounded-[10px] transition-colors cursor-pointer shrink-0 disabled:opacity-35 disabled:cursor-default',
    active ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
  )
}

export function MathNotesToolbar({
  pageIndex,
  pageCount,
  canUndo,
  canRedo,
  tool,
  showLatex,
  onBack,
  onGoPage,
  onUndo,
  onRedo,
  onSelectTool,
  onToggleLatex,
  onAddPage,
  onClearAll,
  onOpenPlot,
  onOpenSettings,
  onOpenDelete,
}: {
  pageIndex: number
  pageCount: number
  canUndo: boolean
  canRedo: boolean
  tool: Tool
  showLatex: boolean
  onBack: () => void
  onGoPage: (delta: number) => void
  onUndo: () => void
  onRedo: () => void
  onSelectTool: (tool: Tool) => void
  onToggleLatex: () => void
  onAddPage: () => void
  onClearAll: () => void
  onOpenPlot: () => void
  onOpenSettings: () => void
  onOpenDelete: () => void
}) {
  return (
    <header className="flex items-center gap-0.5 h-12 px-1.5 border-b border-outline/70 bg-surface/80 backdrop-blur shrink-0">
      <BackButton label="返回工具" onClick={onBack} />
      <div className="flex items-center min-w-0 mr-auto">
        <button type="button" aria-label="上一页" className={toolBtn(false)} disabled={pageIndex <= 0} onClick={() => onGoPage(-1)}>
          <ChevronLeft size={17} />
        </button>
        <span className="text-[13px] font-medium tabular-nums px-0.5 whitespace-nowrap">
          {pageIndex >= 0 ? `${pageIndex + 1} / ${pageCount}` : '…'}
        </span>
        <button
          type="button"
          aria-label="下一页"
          className={toolBtn(false)}
          disabled={pageIndex < 0 || pageIndex >= pageCount - 1}
          onClick={() => onGoPage(1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <button type="button" aria-label="撤销" title="撤销" className={toolBtn(false)} onClick={onUndo} disabled={!canUndo}>
        <Undo2 size={17} />
      </button>
      <button type="button" aria-label="重做" title="重做" className={toolBtn(false)} onClick={onRedo} disabled={!canRedo}>
        <Redo2 size={17} />
      </button>
      <button type="button" aria-label="笔" title="笔" aria-pressed={tool === 'pen'} className={toolBtn(tool === 'pen')} onClick={() => onSelectTool('pen')}>
        <PenLine size={17} />
      </button>
      <button type="button" aria-label="橡皮" title="橡皮（整笔擦除）" aria-pressed={tool === 'eraser'} className={toolBtn(tool === 'eraser')} onClick={() => onSelectTool('eraser')}>
        <Eraser size={17} />
      </button>
      <button type="button" aria-label="套索选择" title="圈选笔迹后可移动、复制和缩放" aria-pressed={tool === 'lasso'} className={toolBtn(tool === 'lasso')} onClick={() => onSelectTool('lasso')}>
        <LassoSelect size={17} />
      </button>
      <button type="button" aria-label="显示识别结果" title="显示识别结果（点公式可修改）" aria-pressed={showLatex} className={toolBtn(showLatex)} onClick={onToggleLatex}>
        <Sigma size={17} />
      </button>
      {/* modal={false}：从菜单里打开 Dialog 时避免 Radix 残留 pointer-events: none */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="更多" title="更多" className={toolBtn(false)}>
            <MoreHorizontal size={17} />
          </button>
        </DropdownMenuTrigger>
        <MenuContent>
          <MenuItem onSelect={onAddPage}>
            <FilePlus2 size={15} /> 新建一页
          </MenuItem>
          <MenuItem onSelect={onClearAll}>
            <Trash2 size={15} /> 清空本页
          </MenuItem>
          <MenuItem onSelect={onOpenPlot}>
            <Sigma size={15} /> 函数图像
          </MenuItem>
          <MenuItem onSelect={onOpenSettings}>
            <Settings2 size={15} /> 识别设置
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={onOpenDelete}>
            <FileX2 size={15} /> 删除本页
          </MenuItem>
        </MenuContent>
      </DropdownMenu>
    </header>
  )
}
