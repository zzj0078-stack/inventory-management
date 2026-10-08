/**
 * 统一 Service Worker —— 桌面端与移动端共用一份。
 *
 * 为什么只有一个：
 *   SW 的默认 scope 是「脚本所在目录」。两个脚本都放在根目录时 scope 都是 `/`，
 *   而**同一 scope 只能存在一个注册** —— 桌面端注册 /sw.js、移动端注册
 *   /mobile-sw.js 会互相覆盖，最终生效的是「最后访问的那个页面」，行为不确定。
 *   所以合并成一份，两个入口都注册它。
 *
 * 缓存策略刻意保守，避免出现「改了却看到旧页面」这类最难排查的问题
 * （沿用原移动端 SW 的口径）：
 *   - 导航请求：**网络优先**，只有断网时才回退缓存的 shell
 *   - /assets/*（文件名带 hash、内容永不变）：缓存优先
 *   - /api/*、/uploads/*：完全不接管，直接走网络
 *   - 非 GET、跨域：不接管
 */

const CACHE = 'inv-shell-v2'

// 需要预缓存的 shell。桌面端 / 移动端都要，
// 这样任意一端「添加到主屏幕」后断网也能打开。
const SHELL = [
  '/',
  '/index.html',
  '/m/',
  '/manifest.json',
  '/mobile-manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/mobile-icon-192.png',
  '/mobile-icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        // 逐条 add，单条失败不影响整体（本地 dev 下有些路径不存在）
        Promise.all(
          SHELL.map((url) => cache.add(url).catch(() => {}))
        )
      )
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE) // 含旧版 inv-mobile-v1 / inventory-pwa-v1
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // 只处理同源 GET
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // 动态数据不缓存：图片、接口每次都走网络
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return

  // 导航：网络优先；断网才回退 shell（移动端回退移动 shell，桌面端回退桌面 shell）
  if (request.mode === 'navigate') {
    const fallback = url.pathname.startsWith('/m') ? '/m/' : '/index.html'
    event.respondWith(fetch(request).catch(() => caches.match(fallback)))
    return
  }

  // 带 hash 的静态资源：内容不变，缓存优先，省一次往返
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
