import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from './app/AppShell'
import { KeyboardShortcutsDialog } from '@/shared/KeyboardShortcuts'
import { ToastHost } from '@/shared/ui/Toast'
import { GlobalHotkeys } from './GlobalHotkeys'
import { TaskDetail } from '@/modules/tasks/TaskDetail'
import { TodayPage } from '@/modules/today/TodayPage'
import { TasksPage } from '@/modules/tasks/TasksPage'
import { DocsPage } from '@/modules/docs/DocsPage'
import { DocReaderPage } from '@/modules/docs/DocReaderPage'
import { AiPage } from '@/modules/ai/AiPage'
import { SettingsPage } from '@/modules/settings/SettingsPage'

export default function App() {
  return (
    <>
      <GlobalHotkeys />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/today" replace />} />
          <Route path="today" element={<TodayPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="docs/:docId" element={<DocReaderPage />} />
          <Route path="ai" element={<AiPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Route>
      </Routes>
      {/* 详情面板全局挂载：今日页/任务页的任务卡点击都可打开 */}
      <TaskDetail />
      <ToastHost />
      <KeyboardShortcutsDialog />
    </>
  )
}
