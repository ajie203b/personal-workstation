import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router'
import { liveQuery } from 'dexie'
import { AppShell } from './app/AppShell'
import { KeyboardShortcutsDialog } from '@/shared/KeyboardShortcuts'
import { ToastHost } from '@/shared/ui/Toast'
import { GlobalHotkeys } from './GlobalHotkeys'
import { AddTaskSheet } from '@/modules/tasks/AddTaskSheet'
import { TodayPage } from '@/modules/today/TodayPage'
import { db } from '@/db/db'
import { getNotifyEnabled, syncAllTaskNotifications } from '@/lib/notify'
import { ShareInbound } from '@/shared/ShareInbound'
import { Spotlight } from '@/shared/Spotlight'
import { PageSkeleton } from '@/shared/ui/Skeleton'
import { useUi } from '@/stores/ui'
import { useTasksUi } from '@/stores/tasks'
import { initAppActions } from '@/lib/appActions'
import { completeById } from '@/modules/tasks/taskActions'
import { pruneTombstones } from '@/lib/tombstones'
import { maybeAutoSync } from '@/lib/sync'
import { initTaskWidgetActions, syncTaskWidget } from '@/lib/taskWidget'
import { AppUpdateHost } from '@/shared/AppUpdate'
import { isMainWindow } from '@/lib/native'

// 重资源页面按路由分包：任务多视图/文档渲染库/编辑器/工具页仅在访问对应页面或弹窗时加载
const TasksPage = lazy(() => import('@/modules/tasks/TasksPage').then((m) => ({ default: m.TasksPage })))
const TaskDetail = lazy(() => import('@/modules/tasks/TaskDetail').then((m) => ({ default: m.TaskDetail })))
const CommandPalette = lazy(() => import('@/shared/CommandPalette').then((m) => ({ default: m.CommandPalette })))
const DocsPage = lazy(() => import('@/modules/docs/DocsPage').then((m) => ({ default: m.DocsPage })))
const DocReaderPage = lazy(() => import('@/modules/docs/DocReaderPage').then((m) => ({ default: m.DocReaderPage })))
const MdEditorPage = lazy(() => import('@/modules/docs/MdEditorPage').then((m) => ({ default: m.MdEditorPage })))
const LocalMarkdownPage = lazy(() => import('@/modules/docs/LocalMarkdownPage').then(m => ({ default: m.LocalMarkdownPage })))
const SettingsPage = lazy(() => import('@/modules/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const StatsPage = lazy(() => import('@/modules/stats/StatsPage').then((m) => ({ default: m.StatsPage })))
const ToolsPage = lazy(() => import('@/modules/tools/ToolsPage').then((m) => ({ default: m.ToolsPage })))
const FanqiePage = lazy(() => import('@/modules/tools/FanqiePage').then((m) => ({ default: m.FanqiePage })))
const ArchivePage = lazy(() => import('@/modules/tools/ArchivePage').then((m) => ({ default: m.ArchivePage })))
const MediaParsePage = lazy(() => import('@/modules/tools/MediaParsePage').then((m) => ({ default: m.MediaParsePage })))
const QrPage = lazy(() => import('@/modules/tools/qr/QrPage').then((m) => ({ default: m.QrPage })))
const PdfToolPage = lazy(() => import('@/modules/tools/pdf/PdfToolPage').then((m) => ({ default: m.PdfToolPage })))
const ArticleToolPage = lazy(() => import('@/modules/tools/article/ArticleToolPage').then((m) => ({ default: m.ArticleToolPage })))
const IdPhotoPage = lazy(() => import('@/modules/tools/idphoto/IdPhotoPage').then((m) => ({ default: m.IdPhotoPage })))
const OcrPage = lazy(() => import('@/modules/tools/ocr/OcrPage').then((m) => ({ default: m.OcrPage })))
const MathNotesPage = lazy(() => import('@/modules/tools/mathnotes/MathNotesPage').then((m) => ({ default: m.MathNotesPage })))
const NjustReportPage = lazy(() => import('@/modules/tools/njust/NjustReportPage').then((m) => ({ default: m.NjustReportPage })))

const RouteLoader = <PageSkeleton />

/**
 * 按文档重挂载阅读器 / 编辑器。
 * 同一路由换 :docId 时 React 会复用组件实例，而 PdfReader 的 numPages / ratios / center /
 * restoredRef 和滚动容器的 scrollTop 都是「这一篇」的状态 —— 复用就会拿上一篇的版面先画一帧
 * （实测：打开 300 页时首帧总高还是上一篇的 7178、scrollTop 停在 4182，1.4s 后才重排成 153494），
 * 这就是连续开文件时那下抖动。给 key 让每篇从干净状态挂载，顺带把排版设置、目录、进度一起归零。
 */
function DocReaderRoute() {
  const { docId } = useParams()
  return <DocReaderPage key={docId} />
}

function MdEditorRoute() {
  const { docId } = useParams()
  return <MdEditorPage key={docId ?? 'new'} />
}

/**
 * 全局「添加任务」抽屉：手机悬浮按钮、任务页快捷键 N、桌面快捷方式深链共用同一个实例，
 * 省掉每个页面各自挂一份 sheet（以前看板/日历/四象限根本没有入口）。
 */
function GlobalAddSheet() {
  const { open, tier, todayContext } = useUi((s) => s.addSheet)
  const close = useUi((s) => s.closeAddSheet)
  return <AddTaskSheet open={open} onOpenChange={(v) => { if (!v) close() }} defaultTier={tier} todayContext={todayContext} />
}

/**
 * 无 UI 的任务同步桥接：通过 Dexie liveQuery 直接驱动桌面小组件与首次通知重排，
 * 避免在 <App> 根组件订阅全表而在每次勾选/编辑任务时触发整棵路由树重渲染。
 */
function NativeSyncBridge() {
  useEffect(() => {
    let timer: number | undefined
    let notificationSynced = false
    const sub = liveQuery(() => db.tasks.orderBy('updatedAt').reverse().toArray()).subscribe({
      next(rows) {
        if (!notificationSynced) {
          notificationSynced = true
          void getNotifyEnabled().then((on) => {
            if (on) void syncAllTaskNotifications(rows)
          })
        }
        window.clearTimeout(timer)
        timer = window.setTimeout(() => syncTaskWidget(rows), 400)
      },
    })
    return () => {
      window.clearTimeout(timer)
      sub.unsubscribe()
    }
  }, [])
  return null
}

function TaskDetailHost() {
  const detailId = useTasksUi((s) => s.detailId)
  if (!detailId) return null
  return (
    <Suspense fallback={null}>
      <TaskDetail />
    </Suspense>
  )
}

function CommandPaletteHost() {
  const open = useUi((s) => s.paletteOpen)
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <CommandPalette />
    </Suspense>
  )
}

export default function App() {
  const navigate = useNavigate()
  // 桌面快捷方式 / 通知点击 / 小组件勾选 / 冷启动深链（原生壳内才有）
  // 独立文档窗口不跑这些全局副作用，避免和主窗口重复同步、抢深链
  useEffect(() => {
    if (!isMainWindow()) return
    let dispose: (() => void) | undefined
    void initAppActions(
      (route) => navigate(route),
      (action) => {
        if (action.type === 'complete') void completeById(action.id)
      },
    ).then((d) => { dispose = d })
    void pruneTombstones()
    void maybeAutoSync()
    return () => dispose?.()
  }, [navigate])
  useEffect(() => {
    if (!isMainWindow()) return
    const check = () => { if (document.visibilityState === 'visible') void maybeAutoSync() }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
    const timer = window.setInterval(check, 10 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', check)
      window.clearInterval(timer)
    }
  }, [])
  // 小组件内的原生添加/完成先落在本地队列，启动和回前台时并进 IndexedDB
  useEffect(() => {
    let dispose: (() => void) | undefined
    void initTaskWidgetActions().then((d) => { dispose = d })
    return () => dispose?.()
  }, [])

  return (
    <>
      <NativeSyncBridge />
      <GlobalHotkeys />
      <Suspense fallback={RouteLoader}>
        <Routes>
          <Route path="local-markdown" element={<LocalMarkdownPage />} />
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/today" replace />} />
            <Route path="today" element={<TodayPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="tools" element={<ToolsPage />} />
            <Route path="tools/fanqie" element={<FanqiePage />} />
            <Route path="tools/archive" element={<ArchivePage />} />
            <Route path="tools/media" element={<MediaParsePage />} />
            <Route path="tools/qrcode" element={<QrPage />} />
            <Route path="tools/pdf" element={<PdfToolPage />} />
            <Route path="tools/article" element={<ArticleToolPage />} />
            <Route path="tools/idphoto" element={<IdPhotoPage />} />
            <Route path="tools/ocr" element={<OcrPage />} />
            <Route path="tools/math-notes" element={<MathNotesPage />} />
            <Route path="tools/njust-report" element={<NjustReportPage />} />
            <Route path="review" element={<Navigate to="/docs" replace />} />
            <Route path="docs" element={<DocsPage />} />
            <Route path="docs/new" element={<MdEditorRoute />} />
            <Route path="docs/edit/:docId" element={<MdEditorRoute />} />
            <Route path="docs/:docId" element={<DocReaderRoute />} />
            {/* AI 助手已移除：旧链接跳设置（资产仍在设置的「AI 资产」页） */}
            <Route path="ai" element={<Navigate to="/settings" replace />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="share" element={<ShareInbound />} />
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Route>
        </Routes>
      </Suspense>
      {/* 详情面板按需加载：未打开任务详情时不挂载、不拉取全表/子分包 */}
      <TaskDetailHost />
      <GlobalAddSheet />
      <CommandPaletteHost />
      <Spotlight />
      <ToastHost />
      <KeyboardShortcutsDialog />
      {/* 应用内更新：仅安卓 App / 桌面主窗口，网页版和独立文档窗口不渲染 */}
      {isMainWindow() && <AppUpdateHost />}
    </>
  )
}
