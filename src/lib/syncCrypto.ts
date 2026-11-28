import { base64ToBytes, bytesToBase64 } from './http'

/**
 * 可选 WebDAV 端到端加密（Phase 4）：
 * - 基于 Web Crypto API（PBKDF2-SHA256 100,000 次迭代 + AES-256-GCM 认证加密）
 * - 仅在用户主动填写「同步加密口令」时生效，未填写时 100% 保持既有明文格式兼容
 * - 自动识别密文信封：旧明文远端升级到 E2EE 时可无缝读取合并并加密回写
 */

const ENVELOPE_VERSION = 1
const ENVELOPE_ALG = 'PBKDF2-AES-256-GCM'
const DEFAULT_ITERATIONS = 100_000

interface EncryptedEnvelope {
  kairosEnc: number
  alg: string
  iter: number
  salt: string
  iv: string
  ct: string
}

function parseEnvelope(raw: string): EncryptedEnvelope | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') || !trimmed.includes('"kairosEnc"')) return null
  try {
    const obj = JSON.parse(trimmed) as Partial<EncryptedEnvelope>
    if (
      obj.kairosEnc === ENVELOPE_VERSION
      && obj.alg === ENVELOPE_ALG
      && typeof obj.iter === 'number'
      && obj.iter >= 10_000
      && typeof obj.salt === 'string'
      && typeof obj.iv === 'string'
      && typeof obj.ct === 'string'
    ) {
      return obj as EncryptedEnvelope
    }
  } catch {
    return null
  }
  return null
}

export function isEncryptedEnvelope(raw: string): boolean {
  return parseEnvelope(raw) !== null
}

function requireSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('当前环境不支持 Web Crypto 加密接口（请使用 HTTPS 或桌面/安卓客户端）')
  }
  return subtle
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const subtle = requireSubtle()
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  const saltBuf = new Uint8Array(salt.byteLength)
  saltBuf.set(salt)
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuf, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

export async function encryptSyncText(plaintext: string, passphrase: string): Promise<string> {
  const pass = passphrase.trim()
  if (!pass) throw new Error('同步加密口令不能为空')
  const subtle = requireSubtle()
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveAesKey(pass, salt, DEFAULT_ITERATIONS, 'encrypt')
  const plainBytes = new TextEncoder().encode(plaintext)
  const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes)
  const env: EncryptedEnvelope = {
    kairosEnc: ENVELOPE_VERSION,
    alg: ENVELOPE_ALG,
    iter: DEFAULT_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(cipherBuf)),
  }
  return JSON.stringify(env)
}

export async function decryptSyncText(payload: string, passphrase?: string): Promise<string> {
  const env = parseEnvelope(payload)
  if (!env) return payload
  const pass = passphrase?.trim() ?? ''
  if (!pass) {
    throw new Error('远端同步数据已开启端到端加密，请先在同步设置中填写加密口令')
  }
  try {
    const subtle = requireSubtle()
    const salt = base64ToBytes(env.salt)
    const ivBytes = base64ToBytes(env.iv)
    const iv = new Uint8Array(ivBytes.byteLength)
    iv.set(ivBytes)
    const ctBytes = base64ToBytes(env.ct)
    const ct = new Uint8Array(ctBytes.byteLength)
    ct.set(ctBytes)
    const key = await deriveAesKey(pass, salt, env.iter, 'decrypt')
    const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return new TextDecoder().decode(plainBuf)
  } catch {
    throw new Error('端到端加密口令不正确或远端密文已损坏，请核对加密口令')
  }
}

export async function maybeEncryptSyncText(plaintext: string, passphrase?: string): Promise<string> {
  const pass = passphrase?.trim() ?? ''
  return pass ? encryptSyncText(plaintext, pass) : plaintext
}
