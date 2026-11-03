/**
 * Pix2Text MFR 1.5 的分词器只用来「解码」：tokenizer.json 是 ByteLevel BPE
 * （XLMRobertaTokenizerFast 外壳，vocab 1868，0~4 为 <pad> <s> </s> <unk> <mask>）。
 * 解码 = id → 词片 → GPT-2 bytes_to_unicode 反查回字节 → UTF-8。
 * 然后照 Pix2Text 的 post_process 做最基础的清理（去多余空格、空上下标）。
 */

export interface MfrTokenizer {
  vocab: string[]
  specialIds: Set<number>
}

/** GPT-2 的 bytes_to_unicode：可见字节映射到自身，其余映射到 256 起的码位 */
function byteDecoder(): Map<string, number> {
  const bs: number[] = []
  for (let i = 33; i <= 126; i++) bs.push(i)
  for (let i = 161; i <= 172; i++) bs.push(i)
  for (let i = 174; i <= 255; i++) bs.push(i)
  const cs = [...bs]
  let n = 0
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b)
      cs.push(256 + n)
      n++
    }
  }
  const map = new Map<string, number>()
  bs.forEach((b, i) => map.set(String.fromCharCode(cs[i]), b))
  return map
}

const BYTE_DECODER = byteDecoder()

/** 解析 tokenizer.json（只取 vocab 与特殊 token） */
export function parseTokenizer(json: string): MfrTokenizer {
  const data = JSON.parse(json) as {
    model?: { vocab?: Record<string, number> }
    added_tokens?: { id: number; content: string; special?: boolean }[]
  }
  const vocabMap = data.model?.vocab
  if (!vocabMap) throw new Error('tokenizer.json 缺少 vocab')
  const vocab: string[] = []
  for (const [piece, id] of Object.entries(vocabMap)) vocab[id] = piece
  const specialIds = new Set<number>()
  for (const t of data.added_tokens ?? []) {
    vocab[t.id] = t.content
    if (t.special) specialIds.add(t.id)
  }
  return { vocab, specialIds }
}

/** id 序列 → 原始文本（跳过特殊 token） */
export function decodeIds(tok: MfrTokenizer, ids: ArrayLike<number>): string {
  const bytes: number[] = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    if (tok.specialIds.has(id)) continue
    const piece = tok.vocab[id]
    if (piece == null) continue
    for (const ch of piece) {
      const b = BYTE_DECODER.get(ch)
      if (b != null) bytes.push(b)
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** Pix2Text post_process 的精简版：去空上下标、去末尾空白命令、压缩多余空格 */
export function postProcessLatex(text: string): string {
  let s = text.trim()
  for (let k = 0; k < 5; k++) {
    const next = s.replace(/\^\s*\{\s*\}/g, '').replace(/_\s*\{\s*\}/g, '')
    if (next === s) break
    s = next
  }
  s = s.replace(/(?:\\ +|\\quad\s*|\\qquad\s*|\\,\s*|\\:\s*|\\;\s*|\\!\s*)+$/, '').trim()
  // 命令后跟非字母时去掉空格；花括号内侧空格；运算符两边空格；上下标符号两边空格
  s = s.replace(/\\([a-zA-Z]+)\s+(?![a-zA-Z])/g, '\\$1')
  s = s.replace(/\{\s+/g, '{').replace(/\s+\}/g, '}').replace(/\}\s+\{/g, '}{')
  s = s.replace(/(?<=[^\\])\s*([+\-=])\s*/g, '$1')
  s = s.replace(/\s*(\^|_)\s*/g, '$1')
  return s.replace(/\s{2,}/g, ' ').trim()
}
