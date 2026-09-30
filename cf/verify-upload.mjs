/**
 * 商品图片上传（R2）验证
 *
 * 用法：
 *   # 本地（miniflare 模拟 R2，免账号）
 *   wrangler pages dev --port 8788 --r2 UPLOADS
 *   node cf/verify-upload.mjs
 *
 *   # 线上（需已启用 R2 并绑定）
 *   node cf/verify-upload.mjs https://inventory-b4k.pages.dev admin 密码
 *
 * 覆盖：正常上传 / 回读字节一致 / 中文文件名 / 类型白名单 /
 *       大小上限 / 空文件 / 缺字段 / 非法扩展名回退
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

// 1×1 透明 PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const PNG = Buffer.from(PNG_BASE64, 'base64')

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  if (res.status !== 200) {
    console.log(`登录失败（${res.status}）：${await res.text()}`)
    process.exit(1)
  }
  return (await res.json()).access_token
}

function upload(token, blob, filename, fieldName = 'file', omitFile = false) {
  const fd = new FormData()
  if (!omitFile) fd.append(fieldName, blob, filename)
  return fetch(`${BASE}/api/products/upload-image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  })
}

const T = await login()
console.log(`已登录 ${USER}\n`)

console.log('=== 1. 正常上传 PNG ===')
let url = null
let uploadedName = null
{
  const res = await upload(T, new Blob([PNG], { type: 'image/png' }), 'shot.png')
  const body = await res.json().catch(() => null)
  check('上传 200', res.status === 200, `status=${res.status} ${body?.detail || ''}`)
  check('返回 url', typeof body?.url === 'string' && body.url.startsWith('/uploads/products/'), body?.url)
  check('返回 name', /^\d{8}_[0-9a-f]{12}\.png$/.test(body?.name || ''), body?.name)
  check('返回 size 与实际一致', body?.size === PNG.length, `${body?.size} vs ${PNG.length}`)
  check('url 与 name 对应', body?.url === `/uploads/products/${body?.name}`, body?.url)
  url = body?.url
  uploadedName = body?.name
}

console.log('\n=== 2. 回读并比对字节 ===')
{
  const res = await fetch(BASE + url)
  const buf = Buffer.from(await res.arrayBuffer())
  check('GET 图片 200', res.status === 200, `status=${res.status}`)
  check('Content-Type = image/png', (res.headers.get('content-type') || '').includes('image/png'),
    res.headers.get('content-type'))
  check('字节完全一致', buf.equals(PNG), `${buf.length} vs ${PNG.length}`)
  const etag = res.headers.get('etag')
  check('有 ETag', !!etag, etag)
  check('有长缓存头', /max-age=\d+/.test(res.headers.get('cache-control') || ''),
    res.headers.get('cache-control'))

  // 条件请求应返回 304（省一次存储读取）
  const cond = await fetch(BASE + url, { headers: { 'If-None-Match': etag } })
  check('If-None-Match 命中 → 304', cond.status === 304, `status=${cond.status}`)
}

console.log('\n=== 3. 中文文件名 + JPG 类型 ===')
{
  const res = await upload(T, new Blob([PNG], { type: 'image/jpeg' }), '商品主图.jpg')
  const body = await res.json().catch(() => null)
  check('中文名上传 200', res.status === 200, `status=${res.status}`)
  check('扩展名保留 .jpg', /\.jpg$/.test(body?.name || ''), body?.name)
  const got = await fetch(BASE + body.url)
  check('回读类型为 image/jpeg', (got.headers.get('content-type') || '').includes('image/jpeg'),
    got.headers.get('content-type'))
}

console.log('\n=== 4. 非法扩展名按 MIME 回退 ===')
{
  const res = await upload(T, new Blob([PNG], { type: 'image/webp' }), 'noext')
  const body = await res.json().catch(() => null)
  check('无扩展名上传 200', res.status === 200, `status=${res.status}`)
  check('按 MIME 回退为 .webp', /\.webp$/.test(body?.name || ''), body?.name)
}

console.log('\n=== 5. 类型白名单 ===')
{
  const res = await upload(T, new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'a.txt')
  const body = await res.json().catch(() => null)
  check('text/plain → 400', res.status === 400, `status=${res.status}`)
  check('提示支持的格式', /仅支持 JPG \/ PNG/.test(body?.detail || ''), body?.detail)
}

console.log('\n=== 6. 大小上限（5 MB）===')
{
  const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 1)
  const res = await upload(T, new Blob([big], { type: 'image/png' }), 'big.png')
  const body = await res.json().catch(() => null)
  check('超 5MB → 400', res.status === 400, `status=${res.status}`)
  check('提示当前大小', /不能超过 5 MB/.test(body?.detail || ''), body?.detail)
}

console.log('\n=== 7. 空文件 ===')
{
  const res = await upload(T, new Blob([], { type: 'image/png' }), 'empty.png')
  const body = await res.json().catch(() => null)
  check('空文件 → 400', res.status === 400, `status=${res.status}`)
  check('提示内容为空', /内容为空/.test(body?.detail || ''), body?.detail)
}

console.log('\n=== 8. 缺 file 字段 ===')
{
  const res = await upload(T, null, null, 'file', true)
  const body = await res.json().catch(() => null)
  check('缺字段 → 400', res.status === 400, `status=${res.status}`)
  check('提示字段名', /字段名应为 file/.test(body?.detail || ''), body?.detail)
}

console.log('\n=== 9. 不存在的图片 → 404 ===')
{
  const res = await fetch(`${BASE}/uploads/products/20200101_deadbeef1234.png`)
  check('GET 不存在 → 404', res.status === 404, `status=${res.status}`)
}

console.log('\n=== 10. 未登录上传 → 401 ===')
{
  const res = await upload(null, new Blob([PNG], { type: 'image/png' }), 'a.png')
  check('无 token → 401', res.status === 401, `status=${res.status}`)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`  通过 ${pass}  失败 ${fail}`)
console.log(`  （上传的测试图片：${uploadedName}）`)
console.log('='.repeat(60))
process.exit(fail ? 1 : 0)
