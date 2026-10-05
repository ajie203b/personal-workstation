import { useCallback, useEffect, useRef, useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X, Trash2 } from 'lucide-react'
import { PRIORITY_VAR, TIERS, TIER_LABEL, type Priority, type Task, type Tier } from '@/db/db'
import { deleteTask, restoreTask, toggleDone, updateTask } from '@/db/tasks'
import { useAllTasks } from '@/db/hooks'
import { useTasksUi } from '@/stores/tasks'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { Segmented } from '@/shared/ui/Segmented'
import { cn } from '@/lib/cn'

const FIELD = 'text-[12px] font-medium text-on-surface-2 mb-1.5 block'
const INPUT =
  'w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[14px] outline-none focus:border-primary/70 transition-colors'

/** 任务详情：居中弹窗（点任务卡右半区打开） */
export function TaskDetail() {
  const { detailId, openDetail } = useTasksUi()
  const task = useAllTasks().find((t) => t.id === detailId) ?? null
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  // 标题/笔记本地态 + 400ms 防抖写库 + 关闭/切任务时立即 flush（防丢最后输入）
  const [titleDraft, setTitleDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const pendingRef = useRef<{ id: string; title: string; notes: string } | null>(null)

  const flushSave = useCallback(() => {
    const p = pendingRef.current
    if (p) {
      void updateTask(p.id, { title: p.title, notes: p.notes })
      pendingRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!detailId) { flushSave(); setConfirmDelete(false) }
  }, [detailId, flushSave])

  useEffect(() => {
    if (task) {
      setTitleDraft(task.title)
      setNotesDraft(task.notes ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id])

  useEffect(() => {
    if (!task || task.id !== detailId) return
    if (titleDraft === task.title && notesDraft === (task.notes ?? '')) { pendingRef.current = null; return }
    pendingRef.current = { id: task.id, title: titleDraft, notes: notesDraft }
    const timer = setTimeout(() => {
      void updateTask(task.id, {
        ...(titleDraft !== task.title ? { title: titleDraft } : {}),
        ...(notesDraft !== (task.notes ?? '') ? { notes: notesDraft } : {}),
      })
      pendingRef.current = null
    }, 400)
    return () => clearTimeout(timer)
  }, [titleDraft, notesDraft, task, detailId])

  // 页面关闭/刷新前 flush
  useEffect(() => {
    const onBeforeUnload = () => flushSave()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => { window.removeEventListener('beforeunload', onBeforeUnload); flushSave() }
  }, [flushSave])

  if (!task) return null

  const patch = (p: Partial<Task>) => void updateTask(task.id, p)

  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, '')
    if (t && !task.tags.includes(t)) patch({ tags: [...task.tags, t] })
    setTagDraft('')
  }

  const remove = async () => {
    await deleteTask(task)
    openDetail(null)
    useUi.getState().toast('已删除任务', { label: '撤销', run: () => void restoreTask(task) })
  }

  const done = task.status === 'done'

  return (
    <RadixDialog.Root open onOpenChange={(v) => !v && openDetail(null)}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <RadixDialog.Content
          className="pop fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(600px,92vw)] max-h-[86dvh] flex flex-col rounded-[20px]"
          style={{ animation: 'fade-up var(--dur-1) var(--ease-standard)' }}
        >
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-outline">
            <RadixDialog.Title className="text-[16px] font-semibold">任务详情</RadixDialog.Title>
            <RadixDialog.Close
              aria-label="关闭"
              className="grid place-items-center w-9 h-9 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
            >
              <X size={18} />
            </RadixDialog.Close>
          </div>

          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto p-5">
            <div className="flex flex-col gap-5">
              <div>
                <label className={FIELD}>标题</label>
                <textarea
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  rows={2}
                  className={cn(INPUT, 'h-auto py-2.5 resize-none leading-relaxed text-[15px]')}
                />
              </div>

              <div>
                <label className={FIELD}>笔记</label>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={4}
                  placeholder="补充说明、链接…"
                  className={cn(INPUT, 'h-auto py-2.5 resize-none leading-relaxed')}
                />
              </div>

              <div>
                <label className={FIELD}>所属清单</label>
                <Segmented
                  size="sm"
                  value={task.tier}
                  onChange={(v) => patch({ tier: v as Tier })}
                  options={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
                />
              </div>

              <div>
                <label className={FIELD}>优先级</label>
                <Segmented
                  size="sm"
                  value={String(task.priority)}
                  onChange={(v) => patch({ priority: Number(v) as Priority })}
                  options={([0, 1, 2, 3] as const).map((p) => ({
                    value: String(p),
                    label: ['紧急', '重要', '常规', '低'][p],
                    dot: PRIORITY_VAR[p],
                  }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={FIELD}>截止日期</label>
                  <input
                    type="date"
                    value={task.due ?? ''}
                    onChange={(e) => patch({ due: e.target.value || undefined })}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={FIELD}>时间</label>
                  <input
                    type="time"
                    value={task.dueTime ?? ''}
                    onChange={(e) => patch({ dueTime: e.target.value || undefined })}
                    className={INPUT}
                  />
                </div>
              </div>

              <div>
                <label className={FIELD}>标签</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {task.tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => patch({ tags: task.tags.filter((x) => x !== t) })}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-surface-3 text-[12px] hover:bg-danger/10 hover:text-danger transition-colors cursor-pointer"
                      title="点击移除"
                    >
                      #{t} ×
                    </button>
                  ))}
                  {task.tags.length === 0 && <span className="text-[12.5px] text-on-surface-2">无标签</span>}
                </div>
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTag()
                    }
                  }}
                  placeholder="输入标签后回车添加"
                  className={INPUT}
                />
              </div>

              {task.repeat && (
                <p className="text-[12.5px] text-on-surface-2">
                  重复：{{ daily: '每天', weekly: '每周', weekdays: '工作日' }[task.repeat]}（打卡任务：完成后自动生成下一次）
                </p>
              )}

              <div className="flex items-center gap-2 pt-1">
                {done ? (
                  <Button variant="primary" className="flex-1 justify-center" onClick={() => void toggleDone(task)}>
                    恢复为未完成
                  </Button>
                ) : (
                  <Button variant="primary" className="flex-1 justify-center" onClick={() => void toggleDone(task)}>
                    ✓ 完成并归档
                  </Button>
                )}
              </div>

              <div className="pt-2 border-t border-outline">
                {confirmDelete ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-danger">确认删除这条任务？</span>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setConfirmDelete(false)}>取消</Button>
                      <Button size="sm" variant="danger" onClick={() => void remove()}>删除</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={14} /> 删除任务
                  </Button>
                )}
              </div>

              <p className="text-[11px] text-on-surface-2">
                创建于 {new Date(task.createdAt).toLocaleString('zh-CN')} · 更新于 {new Date(task.updatedAt).toLocaleString('zh-CN')}
              </p>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
