/**
 * 密码哈希 + JWT
 *
 * 密码格式与 backend/app/core/security.py 完全一致（可直接迁移历史数据）：
 *     password_hash = "<32位hex盐>:<sha256(盐 + 明文)的hex>"
 *
 * JWT 为 HS256 标准实现（WebCrypto HMAC），与 Python 端 PyJWT 产物格式相同。
 */

const encoder = new TextEncoder()

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------- 密码 ----------------

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

/** 生成 salt:sha256hex */
export async function hashPassword(plain) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)))
  return `${salt}:${await sha256Hex(salt + plain)}`
}

/** 校验密码。bcrypt 历史哈希在 Workers 上无法处理，直接判否 */
export async function verifyPassword(plain, hashed) {
  if (!hashed) return false
  if (hashed.startsWith('$2b$') || hashed.startsWith('$2a$')) return false

  const idx = hashed.indexOf(':')
  if (idx <= 0) return false

  const salt = hashed.slice(0, idx)
  const want = hashed.slice(idx + 1)
  const got = await sha256Hex(salt + plain)

  // 定长比较，避免时序泄漏
  if (got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i)
  return diff === 0
}

// ---------------- base64url ----------------

function bytesToB64url(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function strToB64url(str) {
  return bytesToB64url(encoder.encode(str))
}

function b64urlToStr(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

// ---------------- JWT ----------------

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

/**
 * 签发 token
 * @param {object} payload 载荷，如 { sub: '1' }
 * @param {string} secret  SECRET_KEY
 * @param {number} expireMinutes 有效期（分钟）
 */
export async function createToken(payload, secret, expireMinutes = 480) {
  const header = strToB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const body = strToB64url(
    JSON.stringify({ ...payload, iat: now, exp: now + Math.floor(expireMinutes) * 60 })
  )
  const data = `${header}.${body}`
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(data))
  return `${data}.${bytesToB64url(new Uint8Array(sig))}`
}

/** 校验并解出载荷；失败返回 null */
export async function decodeToken(token, secret) {
  if (!token || typeof token !== 'string') return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [h, b, s] = parts
  try {
    const expected = new Uint8Array(
      await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`${h}.${b}`))
    )
    const got = b64urlToBytes(s)
    if (got.length !== expected.length) return null

    let diff = 0
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ got[i]
    if (diff !== 0) return null

    const payload = JSON.parse(b64urlToStr(b))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}
