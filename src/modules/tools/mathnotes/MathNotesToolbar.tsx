import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  FilePlus2,
  FileX2,
  Hand,
  LassoSelect,
  MoreHorizontal,
  PenLine,
  Redo2,
  Settings2,
  Sigma,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { BackButton } from '@/shared/ui/BackButton'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator } from '@/shared/ui/Menu'
import { MAX_ZOOM, MIN_ZOOM, PEN_COLORS, PEN_WIDTHS, type PenColorId, type Tool } from './canvasDraw'
import type { AngleMode, MathNotePage } from './types'

function toolBtn(active: boolean) {
  return cn(
    'grid place-items-center min-w-8 w-8 h-9 sm:min-w-9 sm:w-9 rounded-[10px] transition-colors cursor-pointer shrink-0',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
    'disabled:opacity-35 disabled:cursor-default',
    active ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
  )
}

function ColorSwatchDot({ colorId }: { colorId: PenColorId }) {
  const entry = PEN_COLORS.find((c) => c.id === colorId) ?? PEN_COLORS[0]
  if (colorId === 'auto') {
    return (
      <span
        aria-hidden
        className="size-4 rounded-full border border-outline bg-on-surface inline-block shrink-0"
      />
    )
  }
  return (
    <>
      <span aria-hidden className="size-4 rounded-full border border-black/15 dark:hidden inline-block shrink-0" style={{ backgroundColor: entry.light }} />
      <span aria-hidden className="size-4 rounded-full border border-white/25 hidden dark:inline-block shrink-0" style={{ backgroundColor: entry.dark }} />
    </>
  )
}

export function MathNotesToolbar({
  pages,
  pageIndex,
  pageCount,
  canUndo,
  canRedo,
  tool,
  penColor,
  penWidth,
  zoom,
  angleMode,
  penLocked,
  showLatex,
  onBack,
  onGoPage,
  onSelectPage,
  onUndo,
  onRedo,
  onSelectTool,
  onSelectPenColor,
  onSelectPenWidth,
  onZoomChange,
  onToggleAngleMode,
  onUnlockFinger,
  onToggleLatex,
  onAddPage,
  onClearAll,
  onOpenPlot,
  onOpenSettings,
  onOpenDelete,
}: {
  pages: MathNotePage[]
  pageIndex: number
  pageCount: number
  canUndo: boolean
  canRedo: boolean
  tool: Tool
  penColor: PenColorId
  penWidth: number
  zoom: number
  angleMode: AngleMode
  penLocked: boolean
  showLatex: boolean
  onBack: () => void
  onGoPage: (delta: number) => void
  onSelectPage: (page: MathNotePage) => void
  onUndo: () => void
  onRedo: () => void
  onSelectTool: (tool: Tool) => void
  onSelectPenColor: (color: PenColorId) => void
  onSelectPenWidth: (width: number) => void
  onZoomChange: (zoom: number) => void
  onToggleAngleMode: () => void
  onUnlockFinger: () => void
  onToggleLatex: () => void
  onAddPage: () => void
  onClearAll: () => void
  onOpenPlot: () => void
  onOpenSettings: () => void
  onOpenDelete: () => void
}) {
  const zoomPct = Math.round(zoom * 100)

  const renderMoreMenu = (extraClass?: string) => (
    /* modal={false}：从菜单里打开 Dialog 时避免 Radix 残留 pointer-events: none */
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="更多" title="更多" className={cn(toolBtn(false), extraClass)}>
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
  )

  return (
    <header className="flex flex-col lg:flex-row lg:items-center lg:h-12 px-1.5 lg:px-2 border-b border-outline/70 bg-surface/85 backdrop-blur shrink-0">
      {/* 第 1 排（桌面同排左侧）：返回、页导航（支持快捷选页）、撤销重做、移动端识别原文与更多 */}
      <div className="flex items-center gap-0.5 h-11 lg:h-auto lg:mr-auto min-w-0">
        <BackButton label="返回工具" onClick={onBack} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60" />
        <div className="flex items-center min-w-0 mr-auto lg:mr-1">
          <button type="button" aria-label="上一页" className={toolBtn(false)} disabled={pageIndex <= 0} onClick={() => onGoPage(-1)}>
            <ChevronLeft size={17} />
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="页面列表"
                title="点击快速切换页面"
                className="inline-flex items-center gap-0.5 h-8 px-1.5 rounded-[8px] text-[13px] font-medium tabular-nums whitespace-nowrap hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 cursor-pointer"
              >
                <span>{pageIndex >= 0 ? `${pageIndex + 1} / ${pageCount}` : '…'}</span>
                <ChevronDown size={13} className="text-on-surface-2" />
              </button>
            </DropdownMenuTrigger>
            <MenuContent className="max-h-72 overflow-y-auto min-w-[200px]">
              <MenuLabel>笔记页面</MenuLabel>
              {pages.map((p, idx) => (
                <MenuItem key={p.id} active={idx === pageIndex} onSelect={() => onSelectPage(p)}>
                  <span className="flex-1 truncate">{p.title}</span>
                  <span className="text-[11px] text-on-surface-2 tabular-nums">{p.results.length ? `${p.results.length} 项` : p.strokes.length ? '手写' : '空白'}</span>
                  {idx === pageIndex && <Check size={14} className="text-primary shrink-0" />}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onSelect={onAddPage}>
                <FilePlus2 size={15} /> 新建一页
              </MenuItem>
            </MenuContent>
          </DropdownMenu>
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

        <button type="button" aria-label="撤销" title="撤销 (Ctrl+Z)" className={toolBtn(false)} onClick={onUndo} disabled={!canUndo}>
          <Undo2 size={17} />
        </button>
        <button type="button" aria-label="重做" title="重做 (Ctrl+Shift+Z)" className={toolBtn(false)} onClick={onRedo} disabled={!canRedo}>
          <Redo2 size={17} />
        </button>

        {/* 移动端放第 1 排末尾，桌面端放最右侧 */}
        <button
          type="button"
          aria-label="显示识别结果"
          title="显示识别结果（点公式可修改）"
          aria-pressed={showLatex}
          className={cn(toolBtn(showLatex), 'lg:hidden')}
          onClick={onToggleLatex}
        >
          <Sigma size={17} />
        </button>
        {renderMoreMenu('lg:hidden')}
      </div>

      {/* 第 2 排（桌面同排右侧）：工具、笔色/笔宽、角度制、缩放、解锁手指 */}
      <div className="flex items-center justify-between lg:justify-end gap-1 h-11 lg:h-auto border-t border-outline/50 lg:border-t-0">
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label="笔" title="笔" aria-pressed={tool === 'pen'} className={toolBtn(tool === 'pen')} onClick={() => onSelectTool('pen')}>
            <PenLine size={17} />
          </button>
          <button type="button" aria-label="橡皮" title="橡皮（整笔擦除）" aria-pressed={tool === 'eraser'} className={toolBtn(tool === 'eraser')} onClick={() => onSelectTool('eraser')}>
            <Eraser size={17} />
          </button>
          <button type="button" aria-label="套索选择" title="圈选笔迹后可移动、复制和缩放" aria-pressed={tool === 'lasso'} className={toolBtn(tool === 'lasso')} onClick={() => onSelectTool('lasso')}>
            <LassoSelect size={17} />
          </button>
          <button type="button" aria-label="抓手平移" title="抓手平移画布" aria-pressed={tool === 'hand'} className={toolBtn(tool === 'hand')} onClick={() => onSelectTool('hand')}>
            <Hand size={17} />
          </button>

          {/* 桌面端直接显示 4 色墨迹点 */}
          <div className="hidden md:flex items-center gap-0.5 px-1 border-l border-outline/60 ml-0.5" role="group" aria-label="墨迹颜色">
            {PEN_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={`墨迹颜色：${c.label}`}
                title={c.label}
                aria-pressed={penColor === c.id}
                onClick={() => {
                  onSelectPenColor(c.id)
                  if (tool !== 'pen') onSelectTool('pen')
                }}
                className={cn(
                  'grid place-items-center size-8 rounded-[9px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                  penColor === c.id ? 'bg-surface-3 ring-1 ring-primary/50' : 'hover:bg-surface-3/70',
                )}
              >
                <ColorSwatchDot colorId={c.id} />
              </button>
            ))}
          </div>

          {/* 移动端颜色 & 桌面/移动端笔宽选择菜单 */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="笔迹颜色与粗细"
                title="调整墨迹颜色与粗细"
                className={cn(toolBtn(false), 'w-auto px-1.5 gap-1')}
              >
                <span className="md:hidden"><ColorSwatchDot colorId={penColor} /></span>
                <span className="text-[11px] font-medium text-on-surface-2">
                  {PEN_WIDTHS.find((w) => Math.abs(w.value - penWidth) < 0.2)?.label ?? '中'}
                </span>
              </button>
            </DropdownMenuTrigger>
            <MenuContent>
              <MenuLabel>墨迹颜色</MenuLabel>
              {PEN_COLORS.map((c) => (
                <MenuItem
                  key={c.id}
                  active={penColor === c.id}
                  onSelect={() => {
                    onSelectPenColor(c.id)
                    if (tool !== 'pen') onSelectTool('pen')
                  }}
                >
                  <ColorSwatchDot colorId={c.id} />
                  <span className="flex-1">{c.label}</span>
                  {penColor === c.id && <Check size={14} className="text-primary" />}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuLabel>笔迹粗细</MenuLabel>
              {PEN_WIDTHS.map((w) => (
                <MenuItem
                  key={w.id}
                  active={Math.abs(penWidth - w.value) < 0.2}
                  onSelect={() => onSelectPenWidth(w.value)}
                >
                  <span className="flex-1">{w.label}</span>
                  {Math.abs(penWidth - w.value) < 0.2 && <Check size={14} className="text-primary" />}
                </MenuItem>
              ))}
            </MenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1">
          {penLocked && (
            <button
              type="button"
              onClick={onUnlockFinger}
              aria-label="允许手指书写"
              title="检测到触控笔后已锁定手指为平移，点击允许手指书写"
              className="hidden md:inline-flex items-center h-8 px-2.5 rounded-[9px] border border-primary/40 bg-primary-soft text-primary text-[11.5px] font-medium whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              允许手指书写
            </button>
          )}

          <button
            type="button"
            onClick={onToggleAngleMode}
            aria-label={`角度单位：${angleMode === 'deg' ? '角度 DEG' : '弧度 RAD'}，点击切换`}
            title={angleMode === 'deg' ? '当前：角度制 (DEG)，点击切为弧度制 (RAD)' : '当前：弧度制 (RAD)，点击切为角度制 (DEG)'}
            className="h-8 px-2 rounded-[9px] border border-outline bg-surface-2 hover:bg-surface-3 text-[11.5px] font-semibold tracking-wide text-on-surface cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 shrink-0"
          >
            {angleMode === 'deg' ? 'DEG' : 'RAD'}
          </button>

          <div className="flex items-center rounded-[9px] border border-outline bg-surface-2 h-8 px-0.5 shrink-0" role="group" aria-label="画布缩放">
            <button
              type="button"
              aria-label="缩小画布"
              title="缩小画布"
              disabled={zoom <= MIN_ZOOM + 0.01}
              onClick={() => onZoomChange(Math.max(MIN_ZOOM, Math.round((zoom - 0.15) * 100) / 100))}
              className="grid place-items-center w-7 h-7 rounded-[7px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface disabled:opacity-35 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              aria-label="重置画布缩放为 100%"
              title="点击重置为 100%"
              onClick={() => onZoomChange(1)}
              className="px-1.5 h-7 text-[11.5px] font-medium tabular-nums text-on-surface hover:bg-surface-3 rounded-[7px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              {zoomPct}%
            </button>
            <button
              type="button"
              aria-label="放大画布"
              title="放大画布"
              disabled={zoom >= MAX_ZOOM - 0.01}
              onClick={() => onZoomChange(Math.min(MAX_ZOOM, Math.round((zoom + 0.15) * 100) / 100))}
              className="grid place-items-center w-7 h-7 rounded-[7px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface disabled:opacity-35 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <ZoomIn size={14} />
            </button>
          </div>

          <button
            type="button"
            aria-label="显示识别结果"
            title="显示识别结果（点公式可修改）"
            aria-pressed={showLatex}
            className={cn(toolBtn(showLatex), 'hidden lg:grid')}
            onClick={onToggleLatex}
          >
            <Sigma size={17} />
          </button>
          {renderMoreMenu('hidden lg:grid')}
        </div>
      </div>
    </header>
  )
}
