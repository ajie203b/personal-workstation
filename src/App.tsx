import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from './app/AppShell'
import { KeyboardShortcutsDialog } from '@/shared/KeyboardShortcuts'
import { CommandPalette } from '@/shared/CommandPalette'
import { ToastHost } from '@/shared/ui/Toast'
import { GlobalHotkeys } from './GlobalHotkeys'
import { TaskDetail } from '@/modules/tasks/TaskDetail'
import { TodayPage } from '@/modules/today/TodayPage'
import { TasksPage } from '@/modules/tasks/TasksPage'

// 重资源页面按路由分包：PDF/Markdown 渲染库、TipTap 编辑器只在进入文档模块时加载
const DocsPage = lazy(() => import('@/modules/docs/DocsPage').then((m) => ({ default: m.DocsPage })))
const DocReaderPage = lazy(() => import('@/modules/docs/DocReaderPage').then((m) => ({ default: m.DocReaderPage })))
const MdEditorPage = lazy(() => import('@/modules/docs/MdEditorPage').then((m) => ({ default: m.MdEditorPage })))
const AiPage = lazy(() => import('@/modules/ai/AiPage').then((m) => ({ default: m.AiPage })))
const SettingsPage = lazy(() => import('@/modules/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))

const RouteLoader = (
  <div className="h-full grid place-items-center text-on-surface-2 text-[13px]">
    <span className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
  </div>
)

export default function App() {
  return (
    <>
      <GlobalHotkeys />
      <Suspense fallback={RouteLoader}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/today" replace />} />
            <Route path="today" element={<TodayPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="docs" element={<DocsPage />} />
            <Route path="docs/new" element={<MdEditorPage />} />
            <Route path="docs/edit/:docId" element={<MdEditorPage />} />
            <Route path="docs/:docId" element={<DocReaderPage />} />
            <Route path="ai" element={<AiPage />} />
            <Route path="settings" element={<SettingsPage />} />
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
