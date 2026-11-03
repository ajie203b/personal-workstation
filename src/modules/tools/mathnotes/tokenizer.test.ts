import { describe, expect, it } from 'vitest'
import { decodeIds, parseTokenizer, postProcessLatex } from './tokenizer'
import { lastStepArgmax } from './pix2textMfr'
import { modelFileUrls } from './recognizer'

// 迷你版 tokenizer.json：结构与 Pix2Text MFR 1.5 一致（ByteLevel BPE，Ġ 表示前导空格）
const MINI = JSON.stringify({
  added_tokens: [
    { id: 0, content: '<pad>', special: true },
    { id: 1, content: '<s>', special: true },
    { id: 2, content: '</s>', special: true },
  ],
  model: { type: 'BPE', vocab: { '<pad>': 0, '<s>': 1, '</s>': 2, x: 3, '^': 4, '{': 5, '2': 6, '}': 7, 'Ġ+': 8, 'Ġ1': 9, '\\frac': 10, 'Ġ=': 11 } },
})

describe('MFR 分词器解码', () => {
  const tok = parseTokenizer(MINI)
  it('跳过特殊 token、Ġ 还原为空格', () => {
    expect(decodeIds(tok, [1, 3, 4, 5, 6, 7, 8, 9, 2])).toBe('x^{2} + 1')
  })
  it('post_process 去掉多余空格与空上下标', () => {
    expect(postProcessLatex('x ^ { 2 } + 1 _ { }')).toBe('x^{2}+1')
    expect(postProcessLatex('\\frac { 1 } { 2 } \\,')).toBe('\\frac{1}{2}')
  })
})

describe('贪心解码取最后一步', () => {
  it('argmax 与 softmax 概率', () => {
    // seqLen=2, vocab=3：只看第二行
    const logits = new Float32Array([9, 0, 0, 0, 0, Math.log(8)])
    const { id, prob } = lastStepArgmax(logits, 2, 3)
    expect(id).toBe(2)
    expect(prob).toBeCloseTo(0.8)
  })
})

describe('模型下载源', () => {
  it('首选源在前，其余作为回退', () => {
    const urls = modelFileUrls({ preferred: 'hf-mirror' }, 'breezedeus/pix2text-mfr-1.5', 'abc', 'encoder_model.onnx')
    expect(urls).toEqual([
      'https://hf-mirror.com/breezedeus/pix2text-mfr-1.5/resolve/abc/encoder_model.onnx',
      'https://huggingface.co/breezedeus/pix2text-mfr-1.5/resolve/abc/encoder_model.onnx',
    ])
    expect(modelFileUrls({ preferred: 'hf' }, 'r', 'v', 'f')[0]).toBe('https://huggingface.co/r/resolve/v/f')
    expect(modelFileUrls({ preferred: 'custom', customBase: 'http://192.168.1.2:8000/' }, 'r', 'v', 'f')[0]).toBe('http://192.168.1.2:8000/f')
  })
})
