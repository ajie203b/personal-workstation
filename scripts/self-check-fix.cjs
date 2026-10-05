const fs = require('fs')

// ===== 1. Menu.tsx: 去死类 + 补实际动画 =====
let menu = fs.readFileSync('src/shared/ui/Menu.tsx', 'utf8')
menu = menu.replace(
  "          'data-[state=open]:animate-in data-[state=closed]:animate-out',\n",
  '',
)
fs.writeFileSync('src/shared/ui/Menu.tsx', menu)
console.log('✓ Menu.tsx (死类清除)')

// ===== 2. CSS 清理：删死类 .pri-bar + .list-item-enter =====
let css2 = fs.readFileSync('src/styles/index.css', 'utf8')
css2 = css2.replace(
  /\/\* 优先级左色条.*?\n\.pri-bar \{[\s\S]*?\n\}\n\n/,
  '',
)
css2 = css2.replace(
  /\/\* 列表项进入\/离开动画 \*\/\n\.list-item-enter \{[\s\S]*?\n\}\n\n/,
  '',
)
fs.writeFileSync('src/styles/index.css', css2)
console.log('✓ index.css (死类清理)')

// ===== 3. DeepLink.ts: 移除死导出 =====
let dl = fs.readFileSync('src/shared/DeepLink.ts', 'utf8')
dl = dl.replace(
  /\/\*\* 文档批注 → 任务清单：预填标题 \+ 挂载 docRef \*\/\nexport function openTaskWithRef[\s\S]*?\n}\n\n/,
  '',
)
dl = dl.replace(
  /\/\*\* 任务 → AI 面板：带来源上下文发起会话 \*\/\nexport function openAiWithSource[\s\S]*?\n}\n\n/,
  '',
)
dl = dl.replace(
  /\/\*\* AI 运行卡片 → 回到来源 \*\/\nexport function openSource[\s\S]*?\n}\n/,
  '',
)
fs.writeFileSync('src/shared/DeepLink.ts', dl)
console.log('✓ DeepLink.ts (死导出清理)')

// ===== 4. Toast 退场动画 =====
let toast = fs.readFileSync('src/shared/ui/Toast.tsx', 'utf8')
// 添加 leave 动画 CSS keyframe 到 index.css
let css = fs.readFileSync('src/styles/index.css', 'utf8')
if (!css.includes('fade-out-down')) {
  css2 = css2.replace(
    '@keyframes fade-in {',
    '@keyframes fade-out-down {\n  from { opacity: 1; transform: translateY(0); }\n  to { opacity: 0; transform: translateY(8px); }\n}\n@keyframes fade-in {',
  )
  // Toast 容器改为状态驱动退场
  fs.writeFileSync('src/styles/index.css', css)
}
// Toast 组件：加 leaving 状态
let toastStore2 = fs.readFileSync('src/stores/ui.ts', 'utf8')
if (!toastStore.includes('leaving')) {
  toastStore2 = toastStore2.replace(
    "interface ToastItem {\n  id: string\n  message: string\n  action?: { label: string; run: () => void }\n}",
    "interface ToastItem {\n  id: string\n  message: string\n  leaving?: boolean\n  action?: { label: string; run: () => void }\n}",
  )
  toastStore2 = toastStore2.replace(
    "      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),",
    `      dismissToast: (id) => {
        // 先标记 leaving 触发退场动画，再从数组移除
        set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }))
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 160)
      },`,
  )
  fs.writeFileSync('src/stores/ui.ts', toastStore2)
}
let toastComp2 = fs.readFileSync('src/shared/ui/Toast.tsx', 'utf8')
toastComp2 = toastComp2.replace(
  "          className=\"pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-[14px] shadow-lg max-w-full md:max-w-sm\"",
  "          className={`pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-[14px] shadow-lg max-w-full md:max-w-sm ${t.leaving ? 'opacity-0 translate-y-2' : ''} transition-all duration-150`}",
)
fs.writeFileSync('src/shared/ui/Toast.tsx', toastComp2)
console.log('✓ Toast.tsx + ui.ts (退场动画)')

// ===== 5. 滚动进度隔离：进度条拆独立组件防整页重渲染 =====
// DocReaderPage 的 setProgressPct 触发整页重渲染 — 拆出
let dp2 = fs.readFileSync('src/modules/docs/DocReaderPage.tsx', 'utf8')
if (!dp.includes('ProgressBar')) {
  // 在文件末尾添加独立进度条组件
  dp += `

/** 独立进度条组件：避免滚动 setState 触发整页重渲染 */
function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1 rounded-full bg-surface-3 overflow-hidden">
      <div className="h-full rounded-full bg-primary origin-left" style={{ transform: \`scaleX(\${pct})\` }} />
    </div>
  )
}
`
  fs.writeFileSync('src/modules/docs/DocReaderPage.tsx', dp2)
  console.log('✓ DocReaderPage.tsx (ProgressBar 组件)')
}

// ===== 6. TaskItem 悬停阴影增强 =====
let ti2 = fs.readFileSync('src/modules/tasks/TaskItem.tsx', 'utf8')
if (!ti.includes('hover:shadow-sm')) {
  ti2 = ti2.replace(
    "'card card-hover relative px-4 py-3 cursor-pointer select-none',",
    "'card card-hover relative px-4 py-3 cursor-pointer select-none hover:shadow-sm',",
  )
  fs.writeFileSync('src/modules/tasks/TaskItem.tsx', ti2)
  console.log('✓ TaskItem.tsx (hover 阴影)')
}

// ===== 7. 空状态插图画改进（圆形背景改品牌色浅底） =====
let es2 = fs.readFileSync('src/shared/ui/EmptyState.tsx', 'utf8')
es2 = es2.replace(
  'className="grid place-items-center w-16 h-16 rounded-full bg-surface-3/70 text-on-surface-2 mb-4"',
  'className="grid place-items-center w-16 h-16 rounded-full bg-primary-soft text-primary mb-4"',
)
fs.writeFileSync('src/shared/ui/EmptyState.tsx', es2)
console.log('✓ EmptyState.tsx (视觉)')

console.log('\\nSelf-check fixes done!')
