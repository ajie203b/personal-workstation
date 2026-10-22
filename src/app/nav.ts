import { IconDocs, IconStats, IconTasks, IconToday, IconTools, type AppIcon } from '@/shared/icons'

export interface NavItem {
  path: string
  label: string
  icon: AppIcon
  /** 新手引导锚点（data-tour），没有就不挂 */
  tour?: string
}

/** 主导航（设置在顶栏齿轮 / 侧栏底部） */
export const NAV_ITEMS: NavItem[] = [
  { path: '/today', label: '今日', icon: IconToday },
  { path: '/tasks', label: '任务清单', icon: IconTasks, tour: 'nav-tasks' },
  { path: '/docs', label: '文档工作站', icon: IconDocs, tour: 'nav-docs' },
  { path: '/stats', label: '统计', icon: IconStats },
  { path: '/tools', label: '工具', icon: IconTools },
]

/** 页面标题映射（含非导航页） */
export const PAGE_TITLE: Record<string, string> = {
  '/today': '今日',
  '/tasks': '任务清单',
  '/stats': '统计',
  '/review': '高亮复习',
  '/docs': '文档工作站',
  '/docs/new': '写文档',
  '/tools': '工具',
  '/tools/fanqie': '番茄小说',
  '/settings': '设置',
  '/ai': 'AI 助手',
  '/share': '分享接收',
}
