/**
 * 手机自动跳转的本地验收
 *
 * 覆盖：手机/平板/桌面 UA、根路径与深链接、接口不受影响、
 *       ?desktop=1 逃生口与 Cookie 记忆、有无重定向循环。
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/$/, '')

const UA = {
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  wechat:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40',
  iPad: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  desktopWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  desktopMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
}

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

async function get(path, { ua, cookie } = {}) {
  const headers = {}
  if (ua) headers['User-Agent'] = ua
  if (cookie) headers['Cookie'] = cookie
  const res = await fetch(BASE + path, { headers, redirect: 'manual' })
  const text = res.status === 200 ? await res.text() : ''
  const isMobileHtml = text.includes('mobile-manifest')
  const isDesktopHtml = text.includes('id="app"') && text.includes('assets/main-')
  return { status: res.status, location: res.headers.get('location'), setCookie: res.headers.get('set-cookie'), isMobileHtml, isDesktopHtml, vary: res.headers.get('vary'), len: text.length }
}

console.log('=== 1. 手机访问根路径 → 跳转 /m ===')
for (const [name, ua] of [['iPhone', UA.iPhone], ['Android', UA.android], ['微信内置', UA.wechat], ['iPad', UA.iPad]]) {
  const r = await get('/', { ua })
  check(`${name} → 302 /m`, r.status === 302 && r.location === '/m', `status=${r.status} location=${r.location}`)
  check(`${name} 带 Vary: User-Agent`, /User-Agent/i.test(r.vary || ''), r.vary || '(无)')
}

console.log('\n=== 2. 桌面浏览器访问根路径 → 正常桌面端，不跳转 ===')
for (const [name, ua] of [['Windows Chrome', UA.desktopWin], ['macOS Safari', UA.desktopMac]]) {
  const r = await get('/', { ua })
  check(`${name} → 200 桌面端`, r.status === 200 && r.isDesktopHtml, `status=${r.status} desktopHtml=${r.isDesktopHtml}`)
}

console.log('\n=== 3. 手机访问 /m → 不跳转（防死循环）===')
{
  const r = await get('/m', { ua: UA.iPhone })
  check('/m → 200 移动端', r.status === 200 && r.isMobileHtml, `status=${r.status} mobileHtml=${r.isMobileHtml}`)
  const r2 = await get('/m/sales', { ua: UA.android })
  check('/m/sales → 200 移动端', r2.status === 200 && r2.isMobileHtml, `status=${r2.status}`)
}

console.log('\n=== 4. 手机访问接口/资源 → 不受影响 ===')
{
  const h = await get('/api/health', { ua: UA.iPhone })
  check('/api/health → 200（不是 302）', h.status === 200, `status=${h.status} location=${h.location || '无'}`)
  const mf = await get('/mobile-manifest.json', { ua: UA.iPhone })
  check('/mobile-manifest.json → 200', mf.status === 200, `status=${mf.status}`)
  const sw = await get('/mobile-sw.js', { ua: UA.android })
  check('/mobile-sw.js → 200', sw.status === 200, `status=${sw.status}`)
}

console.log('\n=== 5. 手机访问桌面端深链接 → 暂不映射（保守）===')
for (const p of ['/sales', '/products', '/report']) {
  const r = await get(p, { ua: UA.iPhone })
  check(`${p} → ${r.status}（保持桌面端，无需 302）`, r.status === 200, `status=${r.status} location=${r.location || '无'}`)
}

console.log('\n=== 6. ?desktop=1 逃生口 ===')
{
  const r = await get('/?desktop=1', { ua: UA.iPhone })
  check('?desktop=1 → 200 桌面端', r.status === 200 && r.isDesktopHtml, `status=${r.status}`)
  check('下发 prefer_desktop Cookie', /prefer_desktop=1/.test(r.setCookie || ''), r.setCookie || '(无)')
}

console.log('\n=== 7. 记住「用桌面版」的选择 ===')
{
  const r = await get('/', { ua: UA.iPhone, cookie: 'prefer_desktop=1' })
  check('带 Cookie 再访问 → 200 桌面端（不再跳）', r.status === 200 && r.isDesktopHtml, `status=${r.status}`)
}

console.log('\n=== 8. 桌面端带 ?desktop=1 也正常 ===')
{
  const r = await get('/?desktop=1', { ua: UA.desktopWin })
  check('桌面 + ?desktop=1 → 200', r.status === 200 && r.isDesktopHtml, `status=${r.status}`)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`  通过 ${pass}  失败 ${fail}`)
console.log('='.repeat(60))
process.exit(fail ? 1 : 0)
