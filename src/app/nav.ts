import { CalendarCheck, ChartLine, FileText, ListTodo, type LucideIcon } from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
}

/** 主导航（设置入口在左上角应用图标） */
export const NAV_ITEMS: NavItem[] = [
  { path: '/today', label: '今日', icon: CalendarCheck },
  { path: '/tasks', label: '任务清单', icon: ListTodo },
  { path: '/docs', label: '文档工作站', icon: FileText },
  { path: '/stats', label: '统计', icon: ChartLine },
]

/** 页面标题映射（含非导航页） */
export const PAGE_TITLE: Record<string, string> = {
  '/today': '今日',
  '/tasks': '任务清单',
  '/stats': '统计',
  '/docs': '文档工作站',
  '/docs/new': '写文档',
  '/settings': '设置',
  '/ai': 'AI 助手',
  '/share': '分享接收',
}
