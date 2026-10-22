import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router'
import { AppShell } from './app/AppShell'
import { KeyboardShortcutsDialog } from '@/shared/KeyboardShortcuts'
import { CommandPalette } from '@/shared/CommandPalette'
import { ToastHost } from '@/shared/ui/Toast'
import { GlobalHotkeys } from './GlobalHotkeys'
import { TaskDetail } from '@/modules/tasks/TaskDetail'
import { AddTaskSheet } from '@/modules/tasks/AddTaskSheet'
import { TodayPage } from '@/modules/today/TodayPage'
import { TasksPage } from '@/modules/tasks/TasksPage'
import { useAllTasks } from '@/db/hooks'
import { getNotifyEnabled, syncAllTaskNotifications } from '@/lib/notify'
import { maybeAutoBackup, scrubSnapshotSecrets } from '@/lib/autoBackup'
import { ShareInbound } from '@/shared/ShareInbound'
import { Spotlight } from '@/shared/Spotlight'
import { PageSkeleton } from '@/shared/ui/Skeleton'
import { useUi } from '@/stores/ui'
import { initAppActions } from '@/lib/appActions'
import { completeById } from '@/modules/tasks/taskActions'
import { pruneTombstones } from '@/lib/tombstones'
import { maybeAutoSync } from '@/lib/sync'
import { syncTaskWidget } from '@/lib/taskWidget'

// 重资源页面按路由分包：PDF/Office/EPUB 渲染库、TipTap 编辑器只在进入文档模块时加载
const DocsPage = lazy(() => import('@/modules/docs/DocsPage').then((m) => ({ default: m.DocsPage })))
const DocReaderPage = lazy(() => import('@/modules/docs/DocReaderPage').then((m) => ({ default: m.DocReaderPage })))
const MdEditorPage = lazy(() => import('@/modules/docs/MdEditorPage').then((m) => ({ default: m.MdEditorPage })))
const SettingsPage = lazy(() => import('@/modules/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const StatsPage = lazy(() => import('@/modules/stats/StatsPage').then((m) => ({ default: m.StatsPage })))
const ReviewPage = lazy(() => import('@/modules/review/ReviewPage').then((m) => ({ default: m.ReviewPage })))
const ToolsPage = lazy(() => import('@/modules/tools/ToolsPage').then((m) => ({ default: m.ToolsPage })))
const FanqiePage = lazy(() => import('@/modules/tools/FanqiePage').then((m) => ({ default: m.FanqiePage })))

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

export default function App() {
  const navigate = useNavigate()
  // 桌面快捷方式 / 通知点击 / 小组件勾选 / 冷启动深链（原生壳内才有）
  useEffect(() => {
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
  // 提醒开关打开时，启动即全量重排通知（覆盖导入备份/离线变更的场景）
  const all = useAllTasks()
  // 任务变化后 400ms 同步一次桌面/负一屏小组件（native 才有实际动作）
  useEffect(() => {
    const id = window.setTimeout(() => syncTaskWidget(all), 400)
    return () => window.clearTimeout(id)
  }, [all])
  useEffect(() => {
    void getNotifyEnabled().then((on) => {
      if (on) void syncAllTaskNotifications(all)
    })
    void maybeAutoBackup()
    // 老快照里可能还带着 AI 服务商的明文 Key，启动时顺手清一次（只摘那个字段）
    void scrubSnapshotSecrets()
    // 只需在会话启动时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <GlobalHotkeys />
      <Suspense fallback={RouteLoader}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/today" replace />} />
            <Route path="today" element={<TodayPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="tools" element={<ToolsPage />} />
            <Route path="tools/fanqie" element={<FanqiePage />} />
            <Route path="review" element={<ReviewPage />} />
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
      {/* 详情面板全局挂载：今日页/任务页的任务卡点击都可打开 */}
      <TaskDetail />
      <GlobalAddSheet />
      <CommandPalette />
      <Spotlight />
      <ToastHost />
      <KeyboardShortcutsDialog />
    </>
  )
}
