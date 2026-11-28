/**
 * 内存交接队列：供 PDF 转图等工具把渲染好的图片直接送入「本地 OCR」自动批量识别，
 * 避免先导出 ZIP 再手动解压上传。
 */

let pendingOcrFiles: File[] = []

export function setPendingOcrFiles(files: File[]): void {
  pendingOcrFiles = files.slice()
}

export function takePendingOcrFiles(): File[] {
  if (!pendingOcrFiles.length) return []
  const out = pendingOcrFiles
  pendingOcrFiles = []
  return out
}
