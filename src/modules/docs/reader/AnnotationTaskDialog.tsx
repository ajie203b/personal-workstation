import { Dialog } from '@/shared/ui/Sheet'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import type { useDocAnnotations } from './useDocAnnotations'

export function AnnotationTaskDialog({ task }: { task: ReturnType<typeof useDocAnnotations>['task'] }) {
  const save = useAsyncButton()
  return <Dialog open={task.seed != null} onOpenChange={v => { if (!v) task.close() }} title="从批注创建任务" description="勾选内容已放入任务笔记；任务标题自己起。">
    <div className="flex flex-col gap-3">
      <label className="block"><span className="block text-xs font-medium text-on-surface-2 mb-1">任务标题</span><input autoFocus value={task.title} onChange={e => task.setTitle(e.target.value)} placeholder="输入任务标题…" className="w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-sm outline-none focus:border-primary/60" /></label>
      <label className="block"><span className="block text-xs font-medium text-on-surface-2 mb-1">笔记内容（已预填勾选内容，可改）</span><textarea value={task.notes} onChange={e => task.setNotes(e.target.value)} rows={4} className="w-full rounded-[10px] bg-surface-2 border border-outline px-3 py-2 text-[13px] outline-none focus:border-primary/60 resize-none leading-relaxed" /></label>
      <div className="flex justify-end gap-2"><Button onClick={task.close}>取消</Button><Button variant="primary" state={save.state} disabled={!task.title.trim()} onClick={() => void save.run(task.submit)}>创建任务</Button></div>
    </div>
  </Dialog>
}
