import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router'
import { AppShell } from './app/AppShell'
import { KeyboardShortcutsDialog } from '@/shared/KeyboardShortcuts'
import { CommandPalette } from '@/shared/CommandPalette'
import { ToastHost } from '@/shared/ui/Toast'
import { GlobalHotkeys } from './GlobalHotkeys'
import { TaskDetail } from '@/modules/tasks/TaskDetail'
import { TodayPage } from '@/modules/today/TodayPage'
import { TasksPage } from '@/modules/tasks/TasksPage'
import { useAllTasks } from '@/db/hooks'
import { getNotifyEnabled, syncAllTaskNotifications } from '@/lib/notify'
import { maybeAutoBackup } from '@/lib/autoBackup'
import { ShareInbound } from '@/shared/ShareInbound'

// 重资源页面按路由分包：PDF/Office/EPUB 渲染库、TipTap 编辑器只在进入文档模块时加载
const DocsPage = lazy(() => import('@/modules/docs/DocsPage').then((m) => ({ default: m.DocsPage })))
const DocReaderPage = lazy(() => import('@/modules/docs/DocReaderPage').then((m) => ({ default: m.DocReaderPage })))
const MdEditorPage = lazy(() => import('@/modules/docs/MdEditorPage').then((m) => ({ default: m.MdEditorPage })))
const SettingsPage = lazy(() => import('@/modules/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const StatsPage = lazy(() => import('@/modules/stats/StatsPage').then((m) => ({ default: m.StatsPage })))

const RouteLoader = (
  <div className="h-full grid place-items-center text-on-surface-2 text-[13px]">
    <span className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
  </div>
)

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

export default function App() {
  // 提醒开关打开时，启动即全量重排通知（覆盖导入备份/离线变更的场景）
  const all = useAllTasks()
  useEffect(() => {
    void getNotifyEnabled().then((on) => {
      if (on) void syncAllTaskNotifications(all)
    })
    void maybeAutoBackup()
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
      <CommandPalette />
      <ToastHost />
      <KeyboardShortcutsDialog />
    </>
  )
}
