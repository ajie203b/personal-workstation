/**
 * 输出出口（PDF 工具箱共用）：
 * - saveBlob → 存「下载/个人工作站」（安卓走原生，浏览器走 <a download>）
 * - importDoc → 进文档库（只收文档类，PDF 产物才行）
 * 另外集中放：多文件打 zip、大文件警告、长任务让出主线程的小工具。
 */
import JSZip from 'jszip'
import { importDoc } from '@/db/docs'
import { saveBlob } from '@/lib/saveFile'
import { safeOutputName } from './outputName'

/** 单个产物 */
export interface ToolOutput {
  blob: Blob
  filename: string
  /** 是否 PDF（可进文档库） */
  isPdf: boolean
}

/** 超过约 100MB 的文件提示一次（不拦截，只是提醒会慢/占内存） */
export const BIG_FILE_BYTES = 100 * 1024 * 1024

export function isBigFile(size: number): boolean {
  return size > BIG_FILE_BYTES
}

/** 多个文件 → zip（jszip） */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const zip = new JSZip()
  for (const f of files) zip.file(safeOutputName(f.name), await f.blob.arrayBuffer())
  return zip.generateAsync({ type: 'blob' })
}

/** 存到「下载/个人工作站」 */
export async function exportToDownloads(out: ToolOutput, toast: (msg: string) => void): Promise<void> {
  const where = await saveBlob(out.blob, safeOutputName(out.filename))
  toast(`已保存 → ${where}`)
}

/** 进文档库（PDF 产物；同内容重复导入会被去重，提示里说清楚） */
export async function exportToLibrary(out: ToolOutput, toast: (msg: string) => void): Promise<void> {
  if (!out.isPdf) {
    toast('只有 PDF 结果能进文档库')
    return
  }
  const file = new File([out.blob], safeOutputName(out.filename), { type: 'application/pdf' })
  const { duplicated } = await importDoc(file)
  toast(duplicated ? '文档库里已有这份内容' : '已进文档库')
}

/** 让出一帧主线程，长循环里调用避免界面卡死 */
export function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}
