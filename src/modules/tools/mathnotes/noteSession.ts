import { commitPage, type CommitOutcome } from './store'
import type { BlockResult, MathNotePage, Stroke } from './types'

/**
 * 编辑器里「当前打开的这一页」与库之间的同步状态（不依赖 React，便于单测）。
 *
 * 要解决的问题：编辑器打开时读一次库，之后内容都在内存里。若期间 WebDAV 同步把另一台设备的
 * 新版本写进库，旧做法离开页面时把内存内容整页写回、updatedAt 盖成「现在」——对方的新内容被覆盖，
 * 而且因为时间戳更新，这个旧版本还会被同步出去，把对方设备上的也盖掉。
 *
 * 规则：
 * - dirty：只有真正改过内容才写库；没编辑就离开，一个字节都不写
 * - updatedAt 取最后一次编辑的时间，不是保存时间
 * - 写入走 commitPage 的乐观并发（baseline = 载入时库里的 updatedAt）：
 *     库没变 → 写入；库变了 + 本地只有自动识别结果 → 丢弃本地，换成库里的新版本；
 *     库变了 + 用户编辑过 → 不覆盖对方，另存冲突副本，编辑器切到副本继续写
 * - 页面打开期间库里这一页变了（onExternal，由 liveQuery 推来）：本地没编辑 → 直接刷新；
 *   编辑过 → 立刻保存一次，按上面的规则落成冲突副本
 *
 * 写入与外部变更串行处理，避免「自己刚写入触发的 liveQuery」被误认成别人的修改。
 */

export type EditKind =
  /** 用户亲手改的：笔画增删、撤销重做、清空、手动改识别结果 */
  | 'user'
  /** 由笔迹派生的：自动识别写回的结果。和库里的新版本冲突时可以直接丢弃 */
  | 'derived'

export interface NoteDraft {
  strokes: Stroke[]
  results: BlockResult[]
}

export interface NoteSessionHooks {
  /** 库里的新版本替换了编辑器内容（本地没有需要保留的编辑） */
  onReplaced(page: MathNotePage): void
  /** 本地编辑与库里的新版本冲突：本地版本已另存为 copy，编辑器应切到 copy（离开页面后落成的副本同样回调，只用于提示） */
  onConflict(copy: MathNotePage, latest: MathNotePage | undefined): void
  /** 这一页已被删除（同步来的墓碑），本地没有需要保留的编辑 */
  onDeleted(): void
  /** 写库失败 */
  onError?(e: unknown): void
}

export class NoteSession {
  /** 库里最后一次确认的版本（baseline） */
  private page: MathNotePage
  private dirty = false
  private userEdited = false
  private editedAt = 0
  private seq = 0
  private chain: Promise<unknown> = Promise.resolve()
  private closed = false
  private closingDraft: NoteDraft | undefined

  constructor(
    page: MathNotePage,
    private readonly getDraft: () => NoteDraft,
    private readonly hooks: NoteSessionHooks,
    private readonly clock: () => number = Date.now,
  ) {
    this.page = page
  }

  get current(): MathNotePage {
    return this.page
  }

  get id(): string {
    return this.page.id
  }

  get baseline(): number {
    return this.page.updatedAt
  }

  get isDirty(): boolean {
    return this.dirty
  }

  get hasUserEdits(): boolean {
    return this.userEdited
  }

  markEdited(kind: EditKind): void {
    this.dirty = true
    if (kind === 'user') this.userEdited = true
    this.editedAt = this.clock()
    this.seq++
  }

  /** 没有改动时什么都不写；有改动时按乐观并发写入（串行） */
  save(): Promise<CommitOutcome | null> {
    const run = this.chain.then(() => this.doSave())
    this.chain = run.catch(() => undefined)
    return run
  }

  /** 库里这一页变了（含被删）。row 为库中当前值 */
  onExternal(row: MathNotePage | undefined): Promise<void> {
    const run = this.chain.then(() => this.doExternal(row))
    this.chain = run.catch(() => undefined)
    return run
  }

  /** 离开页面 / 换页：有改动就保存，之后不再响应外部变更 */
  async close(): Promise<CommitOutcome | null> {
    // 切页时编辑器的共享 refs 会立即换成新页，先固定旧页草稿。
    if (this.dirty) this.closingDraft = this.getDraft()
    const r = await this.save()
    this.closed = true
    return r
  }

  private async doSave(): Promise<CommitOutcome | null> {
    if (!this.dirty) return null
    const seq = this.seq
    const draft = this.closingDraft ?? this.getDraft()
    let out: CommitOutcome
    try {
      out = await commitPage(
        { ...this.page, strokes: draft.strokes, results: draft.results },
        this.page.updatedAt,
        { editedAt: this.editedAt, userEdited: this.userEdited, now: this.clock() },
      )
    } catch (e) {
      this.hooks.onError?.(e)
      throw e
    }
    const settled = seq === this.seq
    if (out.kind === 'saved') {
      this.page = out.page
      if (settled) this.reset()
    } else if (out.kind === 'stale') {
      // 保存途中用户又动了笔：这些编辑不能丢，按「双方都改过」再走一次（落成冲突副本）
      if (this.userEdited) return this.doSave()
      // 本地只有派生改动：以库里为准
      this.reset()
      if (out.latest) {
        this.page = out.latest
        if (!this.closed) this.hooks.onReplaced(out.latest)
      } else if (!this.closed) this.hooks.onDeleted()
    } else {
      this.page = out.copy
      if (settled) this.reset()
      // 离开页面时落成的副本也要告诉用户（提示用），编辑器是否切过去由调用方决定
      this.hooks.onConflict(out.copy, out.latest)
    }
    return out
  }

  private async doExternal(row: MathNotePage | undefined): Promise<void> {
    if (this.closed) return
    if (row && row.id !== this.page.id) return
    if (row && row.updatedAt === this.page.updatedAt) return // 自己写入的回声 / 没变化
    if (this.dirty && this.userEdited) {
      // 用户编辑过：立刻保存，commitPage 会发现库已变并另存冲突副本
      await this.doSave()
      return
    }
    // 没编辑（或只有自动识别结果）：直接换成库里的新版本
    this.reset()
    if (row) {
      this.page = row
      this.hooks.onReplaced(row)
    } else {
      this.hooks.onDeleted()
    }
  }

  private reset(): void {
    this.dirty = false
    this.userEdited = false
  }
}
