import { describe, expect, it } from 'vitest'
import {
  decryptSyncText,
  encryptSyncText,
  isEncryptedEnvelope,
  maybeEncryptSyncText,
} from './syncCrypto'

describe('syncCrypto (optional WebDAV E2EE)', () => {
  it('使用 PBKDF2 + AES-256-GCM 往返加解密中文 JSON 与大文本载荷', async () => {
    const plain = JSON.stringify({ tasks: [{ title: '端到端加密测试 🔒', notes: '敏感笔记'.repeat(200) }] })
    const encrypted = await encryptSyncText(plain, 'my-strong-passphrase')

    expect(isEncryptedEnvelope(encrypted)).toBe(true)
    expect(encrypted).not.toContain('端到端加密测试')

    const decrypted = await decryptSyncText(encrypted, 'my-strong-passphrase')
    expect(decrypted).toBe(plain)
  })

  it('明文远端数据在未加密与升级加密时均可透传读取，未设口令时 maybeEncrypt 不改动原文', async () => {
    const plain = '{"app":"personal-workstation","tasks":[]}'
    expect(isEncryptedEnvelope(plain)).toBe(false)
    expect(await maybeEncryptSyncText(plain, '')).toBe(plain)
    expect(await decryptSyncText(plain, '')).toBe(plain)
    expect(await decryptSyncText(plain, 'new-pass')).toBe(plain)
  })

  it('缺少口令、口令错误或密文被篡改时明确报错拒绝解密', async () => {
    const encrypted = await encryptSyncText('secret-payload', 'correct-pass')

    await expect(decryptSyncText(encrypted, '')).rejects.toThrow('端到端加密')
    await expect(decryptSyncText(encrypted, 'wrong-pass')).rejects.toThrow('口令不正确')

    const parsed = JSON.parse(encrypted) as { ct: string }
    const tampered = JSON.stringify({ ...parsed, ct: `${parsed.ct.slice(0, -4)}AAAA` })
    await expect(decryptSyncText(tampered, 'correct-pass')).rejects.toThrow('口令不正确')
  })
})
