/**
 * 密码强度策略（与后端 backend/app/core/password_policy.py 保持一致）
 *
 * 规则：
 *   1. 长度 8 - 64 位
 *   2. 至少 1 个特殊字符
 *   3. 不能含空格
 *
 * 这里只做即时提示，真正生效的是后端校验。
 */

export const MIN_LENGTH = 8
export const MAX_LENGTH = 64

/** 规则说明文案（表单提示用，保持紧凑以免撑宽弹窗） */
export const PASSWORD_RULES_TEXT =
  '至少 8 位，需含至少 1 个特殊字符（如 ! @ # $ % ^ & *），不能有空格'

/** 特殊字符：ASCII 可见标点 + 常见全角/中文标点 */
const SPECIAL_CHARS = new Set(
  Array.from(
    '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~' +
    '！？。，、；：“”‘’（）【】《》—…·￥±×÷≤≥≠∞§¶†‡•‰′″‹›«»–¡¿'
  )
)

/** 密码中出现过的特殊字符 */
export function specialCharsIn(password) {
  return Array.from(String(password || '')).filter(c => SPECIAL_CHARS.has(c))
}

/**
 * 校验密码强度
 * @returns {string|null} null 表示通过，否则返回错误提示
 */
export function validatePassword(password) {
  const pw = password === null || password === undefined ? '' : String(password)

  if (pw === '') return '请输入密码'
  if (pw.length < MIN_LENGTH) return `密码至少 ${MIN_LENGTH} 位（当前 ${pw.length} 位）`
  if (pw.length > MAX_LENGTH) return `密码不能超过 ${MAX_LENGTH} 位（当前 ${pw.length} 位）`
  if (/\s/.test(pw)) return '密码不能包含空格'
  if (specialCharsIn(pw).length === 0) {
    return '密码必须包含至少 1 个特殊字符（如 ! @ # $ % ^ & *）'
  }
  return null
}

/** 校验是否达标 */
export function isStrongPassword(password) {
  return validatePassword(password) === null
}

/**
 * 生成 Element Plus 表单 rule（自带 required + 强度校验）
 * @param {boolean} required 是否必填
 */
export function passwordRule(required = true) {
  return {
    validator: (rule, value, callback) => {
      if (!value) {
        callback(required ? new Error('请输入密码') : undefined)
        return
      }
      const err = validatePassword(value)
      callback(err ? new Error(err) : undefined)
    },
    trigger: 'blur'
  }
}
