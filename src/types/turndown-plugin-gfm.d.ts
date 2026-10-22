/** turndown-plugin-gfm 没有官方类型声明，这里补一份最小的 */
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown'
  export const gfm: (turndown: TurndownService) => void
  export const strikethrough: (turndown: TurndownService) => void
  export const tables: (turndown: TurndownService) => void
  export const taskListItems: (turndown: TurndownService) => void
}
