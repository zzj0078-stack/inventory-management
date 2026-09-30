/**
 * 移动端 Service Worker
 *
 * 目标：让「添加到主屏幕」后能像原生 App 一样打开，并且重复访问更快。
 *
 * 策略刻意保守，避免出现「改了却看到旧页面」这类最难排查的问题：
 *   - 导航请求：**网络优先**，只有断网时才回退到缓存的 shell
 *   - /assets/* （文件名带 hash、内容永不变）：缓存优先
 *   - /api/*、/uploads/*：完全不接管，直接走网络
 *   - 非 GET、跨域：不接管
 *
 * 注意 scope：脚本放在根目录，默认 scope 为 /，能覆盖 /m/*；
 * 但它也会看到桌面端的请求 —— 所以上面明确排除了非 /assets 的资源。
 */

const CACHE = 'inv-mobile-v1'

// 用 /m/ 而不是 /mobile.html：
//   Pages 会把 /mobile.html 308 到 /mobile，而 /m/ 是 _redirects 里的直接改写（200），
//   缓存它更直接，也和 manifest 的 start_url / scope 保持一致。
const SHELL = [
  '/m/',
  '/mobile-manifest.json',
  '/mobile-icon-192.png',
  '/mobile-icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return

  // 导航：网络优先；断网时回退 shell
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/m/')))
    return
  }

  // 带 hash 的静态资源：内容不变，缓存优先
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit
        return fetch(request).then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
          }
          return res
        })
      })
    )
  }
})
