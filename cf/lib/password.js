/**
 * 密码强度策略
 *
 * 与 backend/app/core/password_policy.py 和 frontend/src/utils/password.js
 * 三处保持同一套规则。
 */

export const MIN_LENGTH = 8
export const MAX_LENGTH = 64

/** 规则说明文案 */
export const RULES_TEXT = '至少 8 位，需含至少 1 个特殊字符（如 ! @ # $ % ^ & *），不能有空格'

/** 特殊字符：ASCII 可见标点 + 常见全角/中文标点 */
const SPECIAL_CHARS = new Set(
  Array.from(
    '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~' +
      '！？。，、；：“”‘’（）【】《》—…·￥±×÷≤≥≠∞§¶†‡•‰′″‹›«»–¡¿'
  )
)

export function specialCharsIn(password) {
  return Array.from(String(password ?? '')).filter((c) => SPECIAL_CHARS.has(c))
}

/** 校验密码强度；通过返回 null，否则返回中文错误提示 */
export function validatePassword(password) {
  if (password === null || password === undefined) return '请输入密码'
  const pw = String(password)

  if (pw === '') return '请输入密码'
  if (pw.length < MIN_LENGTH) return `密码至少 ${MIN_LENGTH} 位（当前 ${pw.length} 位）`
  if (pw.length > MAX_LENGTH) return `密码不能超过 ${MAX_LENGTH} 位（当前 ${pw.length} 位）`
  if (/\s/.test(pw)) return '密码不能包含空格'
  if (specialCharsIn(pw).length === 0) {
    return '密码必须包含至少 1 个特殊字符（如 ! @ # $ % ^ & *）'
  }
  return null
}

/** 管理员重置密码的默认值（符合策略） */
export const DEFAULT_RESET_PASSWORD = 'Aa123456!'
