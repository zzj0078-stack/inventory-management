/** 转义 HTML，防止打印内容被注入 */
export function escapeHtml(s) {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const UNITS = ['', '拾', '佰', '仟']
const BIG_UNITS = ['', '万', '亿', '兆']

/** 数字转人民币大写 */
export function amountInChinese(num) {
  const n0 = Number(num)
  if (!isFinite(n0) || n0 === 0) return '零元整'

  const negative = n0 < 0
  const n = Math.round(Math.abs(n0) * 100)
  const jiao = Math.floor(n / 10) % 10
  const fen = n % 10
  const intPart = Math.floor(n / 100)

  let result = ''
  if (intPart > 0) {
    let intStr = String(intPart)
    const groupCount = Math.ceil(intStr.length / 4)
    intStr = intStr.padStart(groupCount * 4, '0')

    for (let i = 0; i < groupCount; i++) {
      const group = intStr.substr(i * 4, 4)
      let segment = ''
      let zeroFlag = false
      for (let j = 0; j < 4; j++) {
        const d = parseInt(group[j], 10)
        if (d === 0) {
          zeroFlag = true
        } else {
          if (zeroFlag && segment) segment += '零'
          zeroFlag = false
          segment += DIGITS[d] + UNITS[3 - j]
        }
      }
      if (segment) {
        result += segment + BIG_UNITS[groupCount - 1 - i]
      } else if (result && !result.endsWith('零')) {
        result += '零'
      }
    }
    result += '元'
  }

  if (jiao === 0 && fen === 0) {
    result += intPart > 0 ? '整' : '零元整'
  } else {
    if (jiao > 0) result += DIGITS[jiao] + '角'
    else if (intPart > 0) result += '零'
    if (fen > 0) result += DIGITS[fen] + '分'
  }

  return (negative ? '负' : '') + result
}

/** 日期格式化 */
export function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt)) return ''
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`
}

export function fmtDateTime(d) {
  if (!d) return '-'
  const dt = new Date(d)
  if (isNaN(dt)) return '-'
  return dt.toLocaleString('zh-CN')
}

/** 紧凑时间：2026/9/20 07:52（省略秒，节省列宽） */
export function fmtShort(d) {
  if (!d) return '-'
  const dt = new Date(d)
  if (isNaN(dt)) return '-'
  const p = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()} ${p(dt.getHours())}:${p(dt.getMinutes())}`
}

export function money(v) {
  const n = Number(v || 0)
  return n.toFixed(2)
}
