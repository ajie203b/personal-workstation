// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Markdown } from 'tiptap-markdown'
import { createHashRouter, createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findMatchesInDoc, findTextMatches, replaceAllInEditor, replaceOneInEditor, EditorFindExtension } from './editor/editorFind'
import { EditorFocusExtension } from './editor/editorFocus'
import { InlineMath, MathBlock, MermaidCodeBlock } from './editor/mdMath'
import { MD_TABLE_EXTENSIONS, isCursorInTable } from './editor/mdTable'
import { MdOutlinePanel } from './editor/MdOutlinePanel'
import { SLASH_COMMANDS, detectSlashTrigger, filterSlashCommands } from './editor/SlashCommandMenu'
import { executeSlashCommand } from './editor/typoraCommands'
import { MdEditorPage } from './MdEditorPage'
import { mdDraftKey, readMdDraft } from './mdDraft'

vi.mock('./MermaidBlock', () => ({
  MermaidBlock: ({ chart }: { chart: string }) => <div data-testid="mermaid-preview">{chart}</div>,
}))

function createHeadlessEditor(content = '') {
  return new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      MermaidCodeBlock,
      TaskList,
      TaskItem.configure({ nested: true }),
      ...MD_TABLE_EXTENSIONS,
      InlineMath,
      MathBlock,
      EditorFindExtension,
      EditorFocusExtension,
      Markdown.configure({ html: false, breaks: true }),
    ],
    content,
  })
}

function getMd(editor: Editor): string {
  return (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? ''
}

describe('Typora P1 extensions', () => {
  it('round-trips GFM tables, supports row/column mutations, and serializes back to pipe syntax', () => {
    const editor = createHeadlessEditor('| 列A | 列B |\n| --- | --- |\n| 1 | 2 |')
    // 光标定位到首格内
    editor.commands.setTextSelection(4)
    expect(isCursorInTable(editor.state)).toBe(true)
    editor.commands.addTableRowAfter()
    editor.commands.addTableColumnAfter()
    const out = getMd(editor)
    expect(out).toContain('| 列A')
    expect(out).toContain('| --- | --- | --- |')
    editor.destroy()
  })

  it('moves Enter to the same column in the next row without losing inline formatting or pipes', () => {
    const editor = createHeadlessEditor('| A | **B** |\n| --- | --- |\n| X | a\\|b |')
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'B') editor.commands.setTextSelection(pos)
    })
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', cancelable: true }))

    expect(editor.state.selection.$from.parent.type.name).toBe('tableCell')
    expect(editor.state.selection.$from.parent.textContent).toBe('a|b')
    expect(getMd(editor)).toBe('| A | **B** |\n| --- | --- |\n| X | a\\|b |\n')
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', cancelable: true }))
    expect(editor.state.doc.firstChild!.childCount).toBe(3)
    expect(editor.state.selection.$from.index(-1)).toBe(1)
    editor.destroy()
  })

  it('parses and round-trips inline math ($...$), block math ($$...$$), and task lists', () => {
    const source = '- [ ] 待办任务\n- [x] 已完成任务\n\n行内 $E=mc^2$ 测试\n\n$$\n\\frac{a}{b}\n$$'
    const editor = createHeadlessEditor(source)
    const md = getMd(editor)
    expect(md).toContain('- [ ] 待办任务')
    expect(md).toContain('- [x] 已完成任务')
    expect(md).toContain('$E=mc^2$')
    expect(md).toContain('$$\n\\frac{a}{b}\n$$')
    editor.destroy()
  })

  it('types an inline formula as soon as the closing dollar is entered', () => {
    const editor = createHeadlessEditor('公式 $x^2')
    const end = editor.state.doc.content.size - 1
    editor.commands.setTextSelection(end)
    const { view } = editor
    const handled = view.someProp('handleTextInput', handler => handler(view, end, end, '$', () => view.state.tr))
    expect(handled).toBe(true)
    expect(editor.state.doc.firstChild?.lastChild?.type.name).toBe('inlineMath')
    expect(editor.state.doc.firstChild?.lastChild?.attrs.latex).toBe('x^2')
    expect(getMd(editor)).toBe('公式 $x^2$')
    editor.destroy()
  })

  it('starts in the first cell and keeps typing in the table after Tab on the last cell', () => {
    const editor = createHeadlessEditor('')
    editor.commands.insertGfmTable({ rows: 2, cols: 2 })
    expect(editor.state.selection.$from.parent.textContent).toBe('列 1')
    for (let i = 0; i < 4; i++) {
      const key = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
      editor.view.dom.dispatchEvent(key)
      expect(key.defaultPrevented).toBe(true)
    }
    editor.commands.insertContent('保留正文')
    expect(getMd(editor)).toContain('| 保留正文 |  |')
    expect(editor.state.doc.firstChild?.childCount).toBe(3)
    editor.destroy()
  })

  it('finds and replaces matches across multiple paragraphs safely in reverse order', () => {
    const editor = createHeadlessEditor('Alpha beta alpha\n\nSecond alpha line')
    const csMatches = findMatchesInDoc(editor.state.doc, 'alpha', true)
    expect(csMatches).toHaveLength(2)

    const ciMatches = findMatchesInDoc(editor.state.doc, 'alpha', false)
    expect(ciMatches).toHaveLength(3)

    replaceOneInEditor(editor, ciMatches[0], 'Gamma')
    expect(getMd(editor)).toContain('Gamma beta alpha')

    const rest = findMatchesInDoc(editor.state.doc, 'alpha', false)
    const count = replaceAllInEditor(editor, rest, 'Omega')
    expect(count).toBe(2)
    expect(getMd(editor)).toBe('Gamma beta Omega\n\nSecond Omega line')

    expect(findTextMatches('abc ABC abc', 'abc', false)).toHaveLength(3)
    expect(findTextMatches('abc ABC abc', 'abc', true)).toHaveLength(2)
    editor.destroy()
  })

  it('detects and executes Typora slash commands', () => {
    const editor = createHeadlessEditor('')
    editor.commands.insertContent('/table')
    const trigger = detectSlashTrigger(editor)
    expect(trigger?.query).toBe('table')
    const matched = filterSlashCommands(SLASH_COMMANDS, trigger!.query)
    expect(matched.map((m) => m.id)).toContain('table')

    executeSlashCommand(editor, 'table', trigger!.range)
    expect(getMd(editor)).toContain('| 列 1 | 列 2 | 列 3 |')

    editor.commands.setContent('https://example.com')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    expect(detectSlashTrigger(editor)).toBeNull()
    editor.destroy()
  })
})

describe('MdOutlinePanel & MdEditorPage Typora UI', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    HTMLElement.prototype.scrollIntoView = () => {}
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    localStorage.clear()
  })

  it('renders real-time heading outline and forwards click selection', async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <MdOutlinePanel
          markdown={'# 第一章\n\n```md\n# 代码里不算\n```\n\n## 1.1 小节'}
          onSelectHeading={onSelect}
        />,
      )
    })
    const buttons = [...host.querySelectorAll('nav button')]
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent).toContain('第一章')
    expect(buttons[1].textContent).toContain('1.1 小节')
    await act(async () => {
      ;(buttons[1] as HTMLButtonElement).click()
    })
    expect(onSelect).toHaveBeenCalledWith(1, '1.1 小节')
  })

  it('supports Typora outline, table insertion, find-and-replace, and rich<->source round-trip in MdEditorPage', async () => {
    const router = createMemoryRouter([
      { path: '/docs/new', element: <MdEditorPage /> },
    ], { initialEntries: ['/docs/new'] })
    await act(async () => {
      root.render(<RouterProvider router={router} />)
    })

    // 打开大纲并插入 3x3 表格
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="更多编辑工具"]')!.click()
      host.querySelector<HTMLButtonElement>('[aria-label="展开实时大纲"]')!.click()
    })
    expect(host.querySelector('[aria-label="文档大纲"]')).not.toBeNull()

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="插入表格 (3×3)"]')!.click()
    })
    expect(host.querySelector('.tiptap table')).not.toBeNull()

    // 切换源码模式后应直接看到序列化后的 GFM 表格语法
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="切换源码模式"]')!.click()
    })
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown 源码编辑器"]')!
    expect(textarea.value).toContain('| 列 1 | 列 2 | 列 3 |')

    // Ctrl+H 打开查找替换并在源码模式下全部替换
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true }))
    })
    const searchInput = host.querySelector<HTMLInputElement>('input[aria-label="查找文本"]')!
    const replaceInput = host.querySelector<HTMLInputElement>('input[aria-label="替换为"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(searchInput, '列 1')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      setter.call(replaceInput, 'ColumnA')
      replaceInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      const replaceAllBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === '全部替换')!
      replaceAllBtn.click()
    })
    expect(textarea.value).toContain('| ColumnA | 列 2 | 列 3 |')
    // 在 500ms 草稿计时器触发前移走编辑器。
    await act(async () => { root.render(null) })
    expect(readMdDraft(mdDraftKey())?.markdown).toContain('| ColumnA | 列 2 | 列 3 |')
  })

  it('offers to stay or discard when the browser goes back from a dirty editor', async () => {
    window.history.replaceState(null, '', '#/docs')
    const router = createHashRouter([
      { path: '/docs', element: <div>文档库</div> },
      { path: '/docs/new', element: <MdEditorPage /> },
    ])
    try {
      await act(async () => { root.render(<RouterProvider router={router} />) })
      await act(async () => { await router.navigate('/docs/new') })
      const titleInput = host.querySelector<HTMLInputElement>('input[placeholder="文档标题"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(titleInput, '新标题')
        titleInput.dispatchEvent(new Event('input', { bubbles: true }))
      })

      async function goBack() {
        await act(async () => {
          for (const waitForRestoredEntry of [false, true]) {
            await new Promise<void>((resolve) => {
              window.addEventListener('popstate', () => resolve(), { once: true })
              if (!waitForRestoredEntry) window.history.back()
            })
            if (router.state.location.pathname === '/docs') break
          }
        })
      }

      await goBack()
      expect(window.location.hash).toBe('#/docs/new')
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('有未保存的修改')
      const clickDialogButton = async (name: string) => {
        const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
          .find((element) => element.textContent === name)!
        await act(async () => { button.click() })
      }
      await clickDialogButton('继续编辑')
      expect(titleInput.value).toBe('新标题')

      await goBack()
      await clickDialogButton('放弃修改')
      await act(async () => {
        if (router.state.location.pathname !== '/docs') {
          await new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }))
        }
      })
      expect(host.textContent).toBe('文档库')
      expect(readMdDraft(mdDraftKey())).toBeNull()
    } finally {
      router.dispose()
    }
  })

  it('adds Typora Find/Replace and Focus/Typewriter modes to LocalRichEditor without breaking table preservation', async () => {
    const { LocalRichEditor } = await import('./LocalRichEditor')
    let currentMd = '# 标题\n\n第一段示例内容\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n'
    const scrollRef = { current: null as HTMLElement | null }
    await act(async () => {
      root.render(
        <LocalRichEditor
          markdown={currentMd}
          onChange={(next) => { currentMd = next }}
          scrollRef={scrollRef}
        />,
      )
    })
    await act(async () => { await Promise.resolve() })

    const focusBtn = host.querySelector<HTMLButtonElement>('button[aria-label="专注段落"]')!
    const typewriterBtn = host.querySelector<HTMLButtonElement>('button[aria-label="打字机居中"]')!
    expect(focusBtn).not.toBeNull()
    expect(typewriterBtn).not.toBeNull()

    await act(async () => { focusBtn.click() })
    expect(host.querySelector('.typora-focus-mode')).not.toBeNull()

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="查找替换"]')!.click()
    })
    expect(host.querySelector('[role="search"][aria-label="编辑器查找与替换"]')).not.toBeNull()
    expect(currentMd).toContain('| 列A | 列B |')
  })
})
