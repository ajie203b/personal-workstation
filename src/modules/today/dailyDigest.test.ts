import { describe, expect, it } from 'vitest'
import type { Annotation, Doc, FocusSession, Task } from '@/db/db'
import type { QuotaRecord } from '@/modules/stats/aiQuota'
import { filterTasks, TASK_TEMPLATES } from '@/modules/tasks/taskTemplates'
import { buildDailyDigestMarkdown, findExpiringQuotas } from './dailyDigest'

describe('dailyDigest & quota expiry alerts', () => {
  it('汇总今日完成任务、番茄时长、阅读批注与待推进事项为 Markdown 日报', () => {
    const doneTasks: Task[] = [
      { id: 't1', title: '完成论文实验', tier: 'today', priority: 1, status: 'done', tags: ['科研'], createdAt: 1, updatedAt: 2, doneAt: 3 },
    ]
    const pendingTasks: Task[] = [
      { id: 't2', title: '整理图表', tier: 'today', priority: 2, status: 'todo', tags: [], createdAt: 1, updatedAt: 1 },
    ]
    const focusSessions: FocusSession[] = [
      { id: 'f1', day: '2026-11-28', ts: 10, minutes: 25, taskId: 't1' },
      { id: 'f2', day: '2026-11-28', ts: 20, minutes: 20 },
    ]
    const docs: Doc[] = [
      { id: 'd1', hash: 'h1', title: '实验方法论', kind: 'pdf', size: 100, addedAt: 1 },
    ]
    const annotations: Annotation[] = [
      { id: 'a1', docHash: 'h1', page: 4, text: '消融实验证实模块有效', comment: '写进第4节', color: 'yellow', createdAt: 50 },
    ]

    const md = buildDailyDigestMarkdown({
      day: '2026-11-28',
      doneTasks,
      pendingTasks,
      focusSessions,
      annotations,
      docs,
    })

    expect(md).toContain('# 今日日报 · 2026-11-28')
    expect(md).toContain('完成 **1** 项任务 · 专注 **45** 分钟（2 个番茄）· 新增 **1** 条阅读批注')
    expect(md).toContain('- [x] 完成论文实验 #科研')
    expect(md).toContain('- 完成论文实验：**25** 分钟')
    expect(md).toContain('- 自由专注：**20** 分钟')
    expect(md).toContain('《实验方法论》：消融实验证实模块有效 · [原文](#/docs/d1?p=p4&hl=a1)')
    expect(md).toContain('  - 思考：写进第4节')
    expect(md).toContain('- [ ] 整理图表')
  })

  it('准确筛出 3 天内即将到期及已过期的模型额度并按紧迫度排序', () => {
    const records: QuotaRecord[] = [
      { id: 'del', deleted: true, updatedAt: 1 },
      { id: 'q-ok', provider: 'OpenAI', name: '远期套餐', account: '', kind: '会员', expiresAt: '2026-12-20', resetAt: '', total: null, used: null, unit: 'Token', note: '' },
      { id: 'q-soon', provider: 'Claude', name: 'Claude Pro', account: '', kind: '会员', expiresAt: '2026-11-30', resetAt: '', total: null, used: null, unit: 'Token', note: '' },
      { id: 'q-exp', provider: 'DeepSeek', name: 'API 余额', account: '', kind: 'API', expiresAt: '2026-11-26', resetAt: '', total: null, used: null, unit: 'Token', note: '' },
    ]
    const hits = findExpiringQuotas(records, '2026-11-28', 3)
    expect(hits.map((h) => h.entry.id)).toEqual(['q-exp', 'q-soon'])
    expect(hits[0].tone).toBe('expired')
    expect(hits[1].tone).toBe('soon')
  })
})

describe('taskTemplates & filterTasks', () => {
  it('按关键词（含子任务）、优先级、标签与关联文档多维过滤任务', () => {
    const tasks: Task[] = [
      {
        id: '1',
        title: '提交论文',
        tier: 'today',
        priority: 0,
        status: 'todo',
        tags: ['科研'],
        docRef: { docId: 'd1' },
        subtasks: [{ id: 's1', title: '核对 GB/T 7714 引文', done: false }],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: '2',
        title: '买咖啡',
        tier: 'anytime',
        priority: 3,
        status: 'todo',
        tags: ['生活'],
        createdAt: 2,
        updatedAt: 2,
      },
    ]

    expect(TASK_TEMPLATES.length).toBeGreaterThanOrEqual(4)
    expect(filterTasks(tasks, { query: '7714' }).map((t) => t.id)).toEqual(['1'])
    expect(filterTasks(tasks, { priority: 3 }).map((t) => t.id)).toEqual(['2'])
    expect(filterTasks(tasks, { tag: '科研', onlyWithDoc: true }).map((t) => t.id)).toEqual(['1'])
    expect(filterTasks(tasks, { onlyWithDoc: true, priority: 3 })).toEqual([])
  })
})
