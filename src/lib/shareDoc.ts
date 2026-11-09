import { Capacitor, registerPlugin } from '@capacitor/core'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './native'
import { blobToBase64, saveBlob } from './saveFile'

interface SharePlugin {
  shareFile(options: { fileName: string; dataBase64: string; mimeType: string; title: string }): Promise<void>
}
const FileExport = registerPlugin<SharePlugin>('FileExport')

function safeName(title: string): string {
  return (title.trim() || '文档').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
}

/**
 * 把 Markdown 文档分享出去，返回一句可展示的落点说明；用户取消时返回空串。
 * - Windows 桌面：弹「另存为」导出 .md（系统没有通用分享面板）
 * - 安卓 App：调起系统分享面板，把 .md 作为附件发给其他应用
 * - 浏览器 / PWA：优先系统分享（文件或文本），都不支持时落到下载目录
 */
export async function shareMarkdown(title: string, markdown: string): Promise<string> {
  const name = safeName(title)
  const fileName = `${name}.md`
  if (isTauri()) {
    const path = await invoke<string | null>('save_text_file', { defaultName: fileName, content: markdown })
    return path ? `已导出到 ${path}` : ''
  }
  const blob = new Blob([markdown], { type: 'text/markdown' })
  if (Capacitor.isNativePlatform()) {
    await FileExport.shareFile({ fileName, dataBase64: await blobToBase64(blob), mimeType: 'text/markdown', title: name })
    return '已调起系统分享'
  }
  const file = new File([markdown], fileName, { type: 'text/markdown' })
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return '已分享' }
    if (navigator.share) { await navigator.share({ title: name, text: markdown }); return '已分享' }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return ''
    // 分享失败（如无权限）继续走下载兜底
  }
  return `已保存到${await saveBlob(blob, fileName)}`
}