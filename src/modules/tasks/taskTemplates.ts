import type { Priority, Task, Tier } from '@/db/db'

export interface TaskTemplate {
  id: string
  name: string
  title: string
  priority: Priority
  tier?: Tier
  tags: string[]
  subtasks: string[]
}

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  {
    id: 'weekly-report',
    name: '周报流程',
    title: '整理并提交本周工作周报',
    priority: 1,
    tier: 'today',
    tags: ['工作'],
    subtasks: [
      '汇总本周核心产出与关键数据',
      '整理阻塞问题与待协调事项',
      '列出下周重点计划与里程碑',
      '通读校对并提交发送',
    ],
  },
  {
    id: 'paper-submit',
    name: '论文投稿',
    title: '完成论文投稿前检查',
    priority: 1,
    tags: ['科研'],
    subtasks: [
      '核对模板排版、页数与摘要字数限制',
      '检查图表清晰度与公式/图表编号',
      '统一参考文献格式（GB/T 7714 / BibTeX）',
      '完成匿名化与 PDF 字体嵌入核验',
    ],
  },
  {
    id: 'exam-review',
    name: '考前复习',
    title: '完成本阶段考前冲刺复习',
    priority: 1,
    tags: ['学业'],
    subtasks: [
      '梳理全书知识导图与高频考点',
      '刷完近三年真题与课后核心题',
      '汇总错题与核心公式速记卡',
      '考前快速复盘薄弱章节',
    ],
  },
  {
    id: 'release-check',
    name: '发版核验',
    title: '执行版本发布前检查清单',
    priority: 0,
    tags: ['开发'],
    subtasks: [
      '跑通类型检查、Lint 与全量单元测试',
      '验证生产构建与关键端到端路径',
      '更新版本号与发布变更说明',
      '发版后线上抽测并确认回滚预案',
    ],
  },
]

export interface TaskFilterOptions {
  query?: string
  priority?: 'all' | Priority
  tag?: string
  onlyWithDoc?: boolean
}

export function filterTasks(tasks: readonly Task[], opts: TaskFilterOptions): Task[] {
  const kw = (opts.query ?? '').trim().toLowerCase()
  const prio = opts.priority ?? 'all'
  const tag = (opts.tag ?? '').trim()
  const onlyWithDoc = Boolean(opts.onlyWithDoc)

  if (!kw && prio === 'all' && !tag && !onlyWithDoc) return [...tasks]

  return tasks.filter((t) => {
    if (prio !== 'all' && t.priority !== prio) return false
    if (tag && !t.tags.includes(tag)) return false
    if (onlyWithDoc && !t.docRef && !t.folderId) return false
    if (kw) {
      const hay = `${t.title}\n${t.notes ?? ''}\n${t.tags.join(' ')}\n${(t.subtasks ?? []).map((s) => s.title).join(' ')}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
}
