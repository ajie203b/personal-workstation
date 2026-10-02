import { Bot, CalendarCheck, FileText, ListTodo, Settings2, type LucideIcon } from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  /** 完成前显示的阶段徽标 */
  milestone?: 'M2' | 'M3'
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/today', label: '今日', icon: CalendarCheck },
  { path: '/tasks', label: '任务清单', icon: ListTodo },
  { path: '/docs', label: '文档工作站', icon: FileText, milestone: 'M2' },
  { path: '/ai', label: 'AI 助手', icon: Bot, milestone: 'M3' },
  { path: '/settings', label: '设置', icon: Settings2 },
]
