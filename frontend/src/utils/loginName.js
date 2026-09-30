/**
 * 登录名自动生成
 *
 * 规则：
 *   1. 中文姓名转全拼（无声调），如 张三 -> zhangsan、吕不韦 -> lvbuwei
 *   2. 已是字母数字则直接小写去符号，如 Alice Wang -> alicewang
 *   3. 只保留 a-z 0-9（拼音里的 ü 统一写 v）
 *   4. 与已存在的登录名冲突时自动加序号：zhangwei -> zhangwei2 -> zhangwei3
 *
 * 生成的只是「建议值」，用户可以随时手动改成别的。
 */
import { pinyin } from 'pinyin-pro'

/** 把姓名转成可做登录名的 ASCII 小写串（可能返回空串） */
export function toLoginName(source) {
  const s = String(source == null ? '' : source).trim()
  if (!s) return ''

  let out = ''
  try {
    // surname:'head' 让首字按姓氏读音处理（单→shàn、曾→zēng、解→xiè、查→zhā、乐→yuè），
    // 否则「单田芳」会被读成 dantianfang。
    // 对纯 ASCII 输入 pinyin-pro 原样返回，所以英文名同样可用。
    out = pinyin(s, { toneType: 'none', type: 'array', surname: 'head' }).join('')
  } catch (e) {
    out = s
  }

  return out
    .toLowerCase()
    .replace(/ü/g, 'v')        // 吕 -> lv
    .replace(/[^a-z0-9]/g, '') // 去掉空格、标点、多音字分隔符等
}

/**
 * 从姓名推导登录名，并与已有登录名去重
 * @param {string} fullName   姓名
 * @param {Iterable<string>} taken 已被占用的登录名（小写比较）
 * @returns {string} 建议登录名；无法生成时返回空串
 */
export function suggestLoginName(fullName, taken = []) {
  const base = toLoginName(fullName)
  if (!base) return ''

  const used = new Set(
    Array.from(taken || [])
      .map((x) => String(x || '').toLowerCase())
      .filter(Boolean)
  )

  if (!used.has(base)) return base

  // 先看有没有空出来的号（如 zhangwei3 已删，可复用）
  let n = 2
  while (used.has(base + n)) n++
  return base + n
}

/**
 * 登录名合法性（与后端 app/api/users.py 的 USERNAME_RE 保持一致）
 * 首字符：字母或汉字；其余：字母数字、下划线、点、短横线、汉字
 */
export const LOGIN_NAME_PATTERN = /^[a-zA-Z\u4e00-\u9fa5][a-zA-Z0-9_.\-\u4e00-\u9fa5]*$/

export function validateLoginName(name) {
  const s = String(name == null ? '' : name).trim()
  if (!s) return '请输入登录名'
  if (!/^[a-zA-Z\u4e00-\u9fa5]/.test(s)) return '登录名需以字母或汉字开头'
  if (!LOGIN_NAME_PATTERN.test(s)) {
    return '登录名只能包含字母、数字、汉字、下划线、点和短横线'
  }
  if (s.length > 50) return '登录名不能超过 50 个字符'
  return null
}
