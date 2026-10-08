/**
 * 移动端公共小工具与文案映射
 * 只依赖纯函数，不引任何 UI 库。
 */

export const num = (n) => Number(n) || 0

/** ¥1,234.50 */
export const money = (n) => '¥' + num(n).toFixed(2)

/** ¥1,235（大额概览用，不显示分） */
export const money0 = (n) =>
  '¥' + Math.round(num(n)).toLocaleString('zh-CN')

/** 2026-09-30 14:00:00 → 09-30 */
export const shortDate = (s) => (s ? String(s).replace('T', ' ').slice(5, 10) : '')

/** 统一成 2026-09-30 14:00 */
export const dateTime = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '')

/** 今天（业务时区） */
export function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * 报表用的日期区间。
 *
 * 全部基于 `today()`（业务时区）做纯日期加减，再用 UTC 计算 ——
 * 这样不会因为手机本地时区与业务时区差一天而把区间算错。
 */
const asDate = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const fmt = (dt) => dt.toISOString().slice(0, 10)

/** 本月 1 号 → 今天 */
export function thisMonth() {
  const t = today()
  return { start: t.slice(0, 8) + '01', end: t }
}

/** 上月 1 号 → 上月最后一天 */
export function lastMonth() {
  const t = today()
  const [y, m] = t.split('-').map(Number)
  return {
    start: fmt(new Date(Date.UTC(y, m - 2, 1))),
    end: fmt(new Date(Date.UTC(y, m - 1, 0))),
  }
}

/** 近 n 天（含今天）：起始日 → 今天 */
export function recentDays(n) {
  const t = asDate(today())
  t.setUTCDate(t.getUTCDate() - (n - 1))
  return { start: fmt(t), end: today() }
}

/** 销售单状态 → 文案 + 标签配色 */
export const SALE_STATUS = {
  0: { t: '草稿', c: 'gray' },
  1: { t: '已审核', c: '' },
  2: { t: '部分发货', c: 'orange' },
  3: { t: '已发货', c: 'green' },
  4: { t: '已关闭', c: 'gray' },
  5: { t: '部分退货', c: 'red' },
  6: { t: '已退货', c: 'red' },
}

/** 采购单状态 → 文案 + 标签配色 */
export const PURCHASE_STATUS = {
  0: { t: '草稿', c: 'gray' },
  1: { t: '已审核', c: '' },
  2: { t: '部分收货', c: 'orange' },
  3: { t: '已收货', c: 'green' },
  4: { t: '已关闭', c: 'gray' },
  5: { t: '部分退货', c: 'red' },
  6: { t: '已退货', c: 'red' },
}

export const PAY_METHODS = ['现金', '银行转账', '微信', '支付宝', '银行承兑']

/** 出入库流水的类型 → 中文 */
export const STOCK_LOG_TYPE = {
  purchase_in: '采购入库',
  sale_out: '销售出库',
  sale_return_in: '销售退货入库',
  purchase_return_out: '采购退货出库',
  transfer_in: '调拨入库',
  transfer_out: '调拨出库',
  adjust_in: '盘盈',
  adjust_out: '盘亏',
  init: '期初',
}
