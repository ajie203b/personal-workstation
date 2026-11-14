import {
  ArrowLeft, BookDown, BookmarkPlus, Crop, FileDown, GraduationCap, List, MessageSquareText,
  MoreHorizontal, PanelLeft, PanelRight, PenLine, Quote, Search, Settings2, Share2,
} from 'lucide-react'
import type { Doc, DocSettings } from '@/db/db'
import { DOC_KIND_LABEL } from '@/db/db'
import { cn } from '@/lib/cn'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem, MenuSeparator } from '@/shared/ui/Menu'
import { IconBtn } from './ReaderPanels'
import { ReaderSettingsPanel } from './ReaderSettingsPanel'

export function ReaderToolbar({
  doc,
  numPages,
  progressPct,
  pct,
  chromeHidden,
  findOpen,
  onToggleFind,
  shotMode,
  onToggleShot,
  hasAnnotations,
  showSettings,
  onToggleSettings,
  onCloseSettings,
  settings,
  updateSettings,
  onResetLayout,
  leftCollapsed,
  rightCollapsed,
  onTogglePanel,
  mobilePanel,
  onOpenMobilePanel,
  onBack,
  onBookmark,
  onEdit,
  onShare,
  onExportNotes,
  onExportMdFile,
  onOpenCitation,
  onOpenReview,
  reviewDueCount = 0,
}: {
  doc: Doc
  numPages: number
  progressPct: number
  pct: number
  chromeHidden: boolean
  findOpen: boolean
  onToggleFind: () => void
  shotMode: boolean
  onToggleShot: () => void
  hasAnnotations: boolean
  showSettings: boolean
  onToggleSettings: () => void
  onCloseSettings: () => void
  settings: DocSettings
  updateSettings: (patch: Partial<DocSettings>, persist?: boolean) => void
  onResetLayout: () => void
  leftCollapsed: boolean
  rightCollapsed: boolean
  onTogglePanel: (side: 'left' | 'right') => void
  mobilePanel: 'toc' | 'anns' | null
  onOpenMobilePanel: (panel: 'toc' | 'anns') => void
  onBack: () => void
  onBookmark: () => void
  onEdit: () => void
  onShare: () => void
  onExportNotes: () => void
  onExportMdFile?: () => void
  onOpenCitation?: () => void
  onOpenReview?: () => void
  reviewDueCount?: number
}) {
  return (
    <header
      className={cn(
        'glass relative z-30 shrink-0 flex items-center gap-1 sm:gap-2 px-2.5 md:px-4 border-b border-outline/70 overflow-hidden',
        'transition-[height,opacity] duration-300 ease-standard',
        chromeHidden ? 'h-0 opacity-0 border-transparent pointer-events-none' : 'h-14 opacity-100',
      )}
    >
      <button
        onClick={onBack}
        aria-label="返回文档库"
        className="grid place-items-center shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-[10px] md:rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors"
      >
        <ArrowLeft size={19} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold truncate leading-tight">{doc.title}</p>
        <p className="text-[11px] text-on-surface-2 leading-tight truncate">
          {doc.kind === 'pdf'
            ? (numPages ? `PDF · ${numPages} 页` : 'PDF')
            : doc.kind === 'pptx'
              ? (numPages ? `PPT · ${numPages} 片` : 'PPT')
              : doc.kind === 'epub'
                ? (numPages ? `EPUB · ${numPages} 章` : 'EPUB')
                : DOC_KIND_LABEL[doc.kind]}
          {progressPct > 0 && ` · 已读 ${pct}%`}
        </p>
      </div>

      {/* 手机上低频文档动作收进「更多」，把标题从 7 个图标里解放出来 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="更多文档操作"
            title="更多"
            className="sm:hidden grid place-items-center shrink-0 w-9 h-9 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
          >
            <MoreHorizontal size={18} />
          </button>
        </DropdownMenuTrigger>
        <MenuContent>
          <MenuItem active={findOpen} onSelect={onToggleFind}>
            <Search size={15} /> 页内查找
          </MenuItem>
          <MenuItem onSelect={onBookmark}>
            <BookmarkPlus size={15} /> 添加书签
          </MenuItem>
          {doc.kind === 'md' && (
            <MenuItem onSelect={onEdit}>
              <PenLine size={15} /> 继续写作
            </MenuItem>
          )}
          {doc.kind === 'md' && (
            <MenuItem onSelect={onShare}>
              <Share2 size={15} /> 分享 / 导出
            </MenuItem>
          )}
          {doc.kind === 'pdf' && (
            <MenuItem active={shotMode} onSelect={onToggleShot}>
              <Crop size={15} /> {shotMode ? '退出截图模式' : '区域截图批注'}
            </MenuItem>
          )}
          {hasAnnotations && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={onExportNotes}>
                <BookDown size={15} /> 导出批注到文档库
              </MenuItem>
              {onExportMdFile && (
                <MenuItem onSelect={onExportMdFile}>
                  <FileDown size={15} /> 导出批注 .md 文件
                </MenuItem>
              )}
              {onOpenReview && (
                <MenuItem onSelect={onOpenReview}>
                  <GraduationCap size={15} /> 复习批注{reviewDueCount > 0 ? ` (${reviewDueCount})` : ''}
                </MenuItem>
              )}
            </>
          )}
          {onOpenCitation && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={onOpenCitation}><Quote size={15} /> 引用…</MenuItem>
            </>
          )}
        </MenuContent>
      </DropdownMenu>

      <IconBtn label="页内查找 (Ctrl+F)" active={findOpen} className="hidden sm:grid" onClick={onToggleFind}><Search size={18} /></IconBtn>
      <IconBtn label="添加书签" className="hidden sm:grid" onClick={onBookmark}><BookmarkPlus size={18} /></IconBtn>
      {doc.kind === 'md' && (
        <IconBtn label="继续写作" className="hidden sm:grid" onClick={onEdit}>
          <PenLine size={18} />
        </IconBtn>
      )}
      {doc.kind === 'md' && (
        <IconBtn label="分享 / 导出 Markdown" className="hidden sm:grid" onClick={onShare}>
          <Share2 size={18} />
        </IconBtn>
      )}
      {doc.kind === 'pdf' && (
        <IconBtn label={shotMode ? '退出截图模式' : '区域截图批注（拖拽框选）'} className="hidden sm:grid" active={shotMode} onClick={onToggleShot}>
          <Crop size={18} />
        </IconBtn>
      )}
      {hasAnnotations && onOpenReview && (
        <button
          type="button"
          aria-label={reviewDueCount > 0 ? `复习待回顾批注 (${reviewDueCount})` : '间隔复习本文档批注'}
          title={reviewDueCount > 0 ? `复习待回顾批注 (${reviewDueCount})` : '间隔复习本文档批注'}
          onClick={onOpenReview}
          className="hidden md:grid relative place-items-center shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-[10px] md:rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
        >
          <GraduationCap size={18} />
          {reviewDueCount > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[14px] h-3.5 px-1 rounded-full bg-primary text-on-primary text-[9px] font-semibold leading-none grid place-items-center tabular-nums">
              {reviewDueCount > 99 ? '99+' : reviewDueCount}
            </span>
          )}
        </button>
      )}
      {(hasAnnotations || onOpenCitation) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="导出与引用"
              title="导出与引用"
              className="hidden sm:grid place-items-center shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-[10px] md:rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
            >
              <BookDown size={18} />
            </button>
          </DropdownMenuTrigger>
          <MenuContent>
            {hasAnnotations && <MenuItem onSelect={onExportNotes}><BookDown size={15} /> 导出批注到文档库</MenuItem>}
            {hasAnnotations && onExportMdFile && <MenuItem onSelect={onExportMdFile}><FileDown size={15} /> 导出批注 .md 文件</MenuItem>}
            {onOpenCitation && <MenuItem onSelect={onOpenCitation}><Quote size={15} /> 引用…</MenuItem>}
          </MenuContent>
        </DropdownMenu>
      )}

      {/* 排版设置（弹层） */}
      <div className="relative">
        <IconBtn label="排版设置" active={showSettings} aria-expanded={showSettings} aria-controls="reader-settings" aria-haspopup="dialog" onClick={onToggleSettings}><Settings2 size={18} /></IconBtn>
        {showSettings && (
          <ReaderSettingsPanel
            doc={doc}
            settings={settings}
            updateSettings={updateSettings}
            onClose={onCloseSettings}
            onResetLayout={onResetLayout}
          />
        )}
      </div>

      <span className="hidden md:block w-px h-5 bg-outline/80 mx-0.5" aria-hidden />
      <IconBtn
        label={leftCollapsed ? '展开目录栏' : '收起目录栏'}
        active={!leftCollapsed}
        className="hidden lg:grid"
        onClick={() => onTogglePanel('left')}
      >
        <PanelLeft size={18} />
      </IconBtn>
      <IconBtn
        label={rightCollapsed ? '展开批注栏' : '收起批注栏'}
        active={!rightCollapsed}
        className="hidden xl:grid"
        onClick={() => onTogglePanel('right')}
      >
        <PanelRight size={18} />
      </IconBtn>
      <IconBtn label="目录与高亮" className="lg:hidden" active={mobilePanel === 'toc'} onClick={() => onOpenMobilePanel('toc')}><List size={18} /></IconBtn>
      <IconBtn label="批注与反链" className="xl:hidden" active={mobilePanel === 'anns'} onClick={() => onOpenMobilePanel('anns')}><MessageSquareText size={18} /></IconBtn>
    </header>
  )
}
