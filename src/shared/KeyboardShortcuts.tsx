import { useUi } from '@/stores/ui'
import { Dialog } from '@/shared/ui/Sheet'

const ROWS: [string, string][] = [
  ['n 或 /', '聚焦快速添加'],
  ['Enter', '保存任务'],
  ['↑ ↓ 或 J K', '在列表中移动选择'],
  ['空格 / X', '勾选完成 / 恢复'],
  ['Enter', '打开任务详情'],
  ['?', '打开本帮助'],
  ['Esc', '关闭弹层'],
]

export function KeyboardShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useUi()
  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} title="键盘快捷键" description="全键盘完成「录入 → 勾选 → 归档」一天循环。">
      <div className="divide-y divide-outline">
        {ROWS.map(([k, label]) => (
          <div key={k + label} className="flex items-center justify-between py-2.5">
            <span className="text-[13.5px]">{label}</span>
            <span className="kbd">{k}</span>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
