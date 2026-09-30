/**
 * 验证「数据自检 + 一键修复」的 fixable 分支
 *
 * 正常流程下系统不会产生脏数据（接口不允许），所以需要先用 SQL 人为制造
 * 金额不一致，再验证：
 *   1. 自检能报出来，且标记 fixable
 *   2. 一键修复按「Σ明细 + 运费」重算（不能丢掉运费）
 *
 * 用法：node cf/verify-healthfix.mjs [base] [user] [pass]
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/$/, '')
const USER = process.argv[3] || 'admin'
const PASS = process.argv[4] || 'admin123'

let pass = 0
let fail = 0
function check(label, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  OK   ${label}${extra ? '  ' + extra : ''}`)
  } else {
    fail++
    console.log(`  FAIL ${label}${extra ? '  ' + extra : ''}`)
  }
}

async function call(method, path, { token, body } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, data }
}

const login = await call('POST', '/api/auth/login', { body: { username: USER, password: PASS } })
if (login.status !== 200) {
  console.log(`登录失败（${login.status}）：${JSON.stringify(login.data)}`)
  process.exit(1)
}
const T = login.data.access_token
console.log(`已登录 ${USER}\n`)

console.log('=== 1. 自检应报出金额不一致 ===')
const h1 = await call('GET', '/api/ext/health-check', { token: T })
check('自检 200', h1.status === 200, `status=${h1.status}`)
check('错误数 = 0（只是警告）', h1.data?.error_count === 0, String(h1.data?.error_count))
check('警告数 = 1', h1.data?.warn_count === 1, String(h1.data?.warn_count))
check('可修复数 = 1', h1.data?.fixable_count === 1, String(h1.data?.fixable_count))

const warn = (h1.data?.issues || []).find((i) => i.level === 'warn')
check('问题表 = purchase_orders', warn?.table === 'purchase_orders', warn?.table)
check('标记为可修复', warn?.fixable === true)
check('修复动作 = recalc_order_amount', warn?.fix_action === 'recalc_order_amount', warn?.fix_action)
check('提示含「运费」（口径正确）', /运费/.test(warn?.message || ''), warn?.message)
check('提示里重算值 = 110.00', /110\.00/.test(warn?.fix || ''), warn?.fix)
check('message 说明差异 9999.00', /9999\.00/.test(warn?.message || ''), warn?.message)

console.log('\n=== 2. 一键修复 ===')
const f = await call('POST', '/api/ext/health-check/fix', { token: T })
check('修复 200', f.status === 200, `status=${f.status}`)
check('修复数 = 1', f.data?.fixed_count === 1, String(f.data?.fixed_count))
check('修复明细提到 110.00', /110\.00/.test((f.data?.fixed || []).join('')), (f.data?.fixed || []).join(''))
check('修复后无待人工处理项', f.data?.manual_count === 0, String(f.data?.manual_count))
check('修复后 ok = true', f.data?.ok === true)

console.log('\n=== 3. 复检应完全干净 ===')
const h2 = await call('GET', '/api/ext/health-check', { token: T })
check('错误数 = 0', h2.data?.error_count === 0, String(h2.data?.error_count))
check('警告数 = 0', h2.data?.warn_count === 0, String(h2.data?.warn_count))
check('可修复数 = 0', h2.data?.fixable_count === 0, String(h2.data?.fixable_count))
check('ok = true', h2.data?.ok === true)

console.log(`\n  通过 ${pass}  失败 ${fail}`)
process.exit(fail ? 1 : 0)
