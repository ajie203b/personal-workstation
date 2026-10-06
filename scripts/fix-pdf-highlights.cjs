const fs = require('fs')

// ===== Fix 1: TasksPage 非列表视图隐藏 QuickAdd =====
let tp = fs.readFileSync('src/modules/tasks/TasksPage.tsx', 'utf8')
tp = tp.replace(
  '      <QuickAdd\n        defaultTier={tier}\n        placeholder={tier === \'today\' ? \'添加到今日…（明天14:00 交报告 P1 #工作）\' : undefined}\n      />',
  `      {view === 'list' && (
        <QuickAdd
          defaultTier={tier}
          placeholder={tier === 'today' ? '添加到今日…（明天14:00 交报告 P1 #工作）' : undefined}
        />
      )}`,
)
fs.writeFileSync('src/modules/tasks/TasksPage.tsx', tp)
console.log('✓ TasksPage (QuickAdd 条件渲染)')

// ===== Fix 2+3: PdfReader 高亮层 + --scale-factor =====
let pr = fs.readFileSync('src/modules/docs/PdfReader.tsx', 'utf8')

// Fix 2: 高亮颜色从外层 div 移到内层 span（外层只做定位容器）
pr = pr.replace(
  "                          className={`absolute inset-0 pointer-events-none ${colorCls} ${flashId === a.id ? 'ann-flash' : ''}`}\n                          style={{ ['--ann-opacity' as string]: '0.4' }}\n                        >\n                          {a.rects!.map((r, ri) => (\n                            <span\n                              key={ri}\n                              className={`absolute ${isShot ? 'border-2 border-primary' : ''}`}\n                              style={{\n                                left: `${r.x * 100}%`,\n                                top: `${r.y * 100}%`,\n                                width: `${r.w * 100}%`,\n                                height: `${r.h * 100}%`,\n                                ...(isShot ? { background: 'rgba(11, 87, 208, 0.08)' } : {}),\n                              }}\n                            />\n                          ))}\n                        </div>",
  `                          className={\`absolute inset-0 pointer-events-none \${flashId === a.id ? 'ann-flash' : ''}\`}\n                          style={{ ['--ann-opacity' as string]: '0.4' }}\n                        >\n                          {a.rects!.map((r, ri) => (\n                            <span\n                              key={ri}\n                              className={cn('absolute', isShot ? 'border-2 border-primary' : colorCls)}\n                              style={{\n                                left: \`\${r.x * 100}%\`,\n                                top: \`\${r.y * 100}%\`,\n                                width: \`\${r.w * 100}%\`,\n                                height: \`\${r.h * 100}%\`,\n                                ...(isShot ? { background: 'rgba(11, 87, 208, 0.08)' } : {}),\n                              }}\n                            />\n                          ))}\n                        </div>`,
)

// Fix 3: 移除自定义 --scale-factor（react-pdf 自动处理）
pr = pr.replace(
  "style={{ width: dispW, height: pageH(p - 1), ['--scale-factor' as string]: String(dispW / (baseWidths[p - 1] || 612)) }}",
  "style={{ width: dispW, height: pageH(p - 1) }}",
)
fs.writeFileSync('src/modules/docs/PdfReader.tsx', pr)
console.log('✓ PdfReader (高亮修正 + scale-factor)')
