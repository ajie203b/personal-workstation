/**
 * 手写签名库（db.signatures）：透明 PNG dataURL + 像素尺寸，跨会话复用。
 * 表结构见 db.ts 的 SignatureRow（v3.3 已建好），这里只是薄封装。
 */
import { db, type SignatureRow } from '@/db/db'
import { uid } from '@/lib/id'

export type { SignatureRow }

export async function listSignatures(): Promise<SignatureRow[]> {
  const rows = await db.signatures.orderBy('createdAt').reverse().toArray()
  return rows
}

export async function addSignature(input: {
  name: string
  dataUrl: string
  width: number
  height: number
}): Promise<SignatureRow> {
  const row: SignatureRow = {
    id: uid(),
    name: input.name.trim() || '签名',
    dataUrl: input.dataUrl,
    width: input.width,
    height: input.height,
    createdAt: Date.now(),
  }
  await db.signatures.add(row)
  return row
}

export async function removeSignature(id: string): Promise<void> {
  await db.signatures.delete(id)
}
