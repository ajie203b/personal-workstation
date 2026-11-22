import { IconDocs, IconStats, IconTasks, IconToday, IconTools, type AppIcon } from '@/shared/icons'

export interface NavItem {
  path: string
  label: string
  icon: AppIcon
}

/** 主导航（设置在顶栏齿轮 / 侧栏底部） */
export const NAV_ITEMS: NavItem[] = [
  { path: '/today', label: '今日', icon: IconToday },
  { path: '/tasks', label: '任务清单', icon: IconTasks },
  { path: '/docs', label: '文档工作站', icon: IconDocs },
  { path: '/tools', label: '工具', icon: IconTools },
  { path: '/stats', label: '统计', icon: IconStats },
]

/** 页面标题映射（含非导航页） */
export const PAGE_TITLE: Record<string, string> = {
  '/today': '今日',
  '/tasks': '任务清单',
  '/stats': '统计',
  '/docs': '文档工作站',
  '/docs/new': '写文档',
  '/tools': '工具',
  '/tools/fanqie': '番茄小说',
  '/tools/archive': '安娜的档案',
  '/tools/njust-report': 'NJUST 报告排版',
  '/tools/media': '无水印下载',
  '/tools/qrcode': '二维码',
  '/tools/pdf': 'PDF 工具箱',
  '/tools/article': '文章离线',
  '/tools/idphoto': '证件照 / 报名照',
  '/tools/ocr': '本地 OCR',
  '/tools/math-notes': '手写计算',
  '/settings': '设置',
  '/share': '分享接收',
}

export const SETTINGS_TITLES = {
  appearance: '外观', data: '数据', sync: '同步', feedback: '建议', about: '关于',
} as const

export type SettingsSection = keyof typeof SETTINGS_TITLES

export function getSettingsSection(value: string | null): SettingsSection | null {
  return value && Object.hasOwn(SETTINGS_TITLES, value) ? value as SettingsSection : null
}
