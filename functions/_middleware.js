/**
 * 全局中间件：手机访问根路径时自动跳到移动端
 *
 * 需求：手机上打开裸域名（https://xxx.pages.dev）直接进手机版，
 *      不用手动加 /m 后缀。
 *
 * 为什么放在边缘而不是前端 JS：
 *   index.html 只有 0.4 KB，但它的 <script> 会拉 1.2 MB 的桌面端主包。
 *   靠前端 JS 判断再跳转，手机得先把整个桌面包下完 —— 在边缘直接 302
 *   省掉这一整轮下载。而且无 JS 环境（部分内置浏览器）也能生效。
 *
 * 只处理**根路径**，其余一律放行：
 *   - /m*        手机版自身，绝不能重定向（否则死循环）
 *   - /api/*     接口
 *   - /uploads/* 图片
 *   - 其它路径   桌面端深链接（各页面在移动端没有一一对应，不做映射更安全）
 *
 * 逃生口：带 ?desktop=1 强制用桌面端并记 Cookie，之后不再打扰，
 *        避免手机用户被「锁」在手机版里出不去。
 *
 * 排查备忘：如果加上中间件后**所有请求都超时**（连 /api/health 都没响应，
 * 服务端日志里也没有请求记录），先别怀疑业务代码 —— 多半是本地同时跑着
 * 好几个 `wrangler pages dev`（每次只杀「占用 8788 的进程」会留下 workerd 子进程，
 * 请求打到半死的实例上就卡住）。彻底清理：
 *     Get-Process workerd | Stop-Process -Force
 *     Get-NetTCPConnection -LocalPort 8788 -State Listen   # 确认端口已空
 * 这次就是这么误判了一轮。
 */

// 手机/平板识别。注意别把桌面 Mac 匹配进来
// （iPadOS 13+ 的 Safari 会自称 Macintosh，但仍带 Mobile 标记，所以能匹配到）
const MOBILE_UA =
  /Android|iPhone|iPod|iPad|Windows Phone|IEMobile|Opera Mini|BlackBerry|webOS|Mobile/i

const DESKTOP_COOKIE = 'prefer_desktop'

export async function onRequest(context) {
  const url = new URL(context.request.url)

  // 只有根路径需要判断，其它请求立刻放行。
  // （中间件对每个请求都会跑，这里尽早 return，别给接口和静态资源添开销）
  if (url.pathname !== '/') return context.next()

  // 主动要求桌面版：下发 Cookie 记住选择
  if (url.searchParams.get('desktop') === '1') {
    const res = await context.next()
    const headers = new Headers(res.headers)
    headers.append('Set-Cookie', `${DESKTOP_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax`)
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    })
  }

  // 之前选过桌面版就一直给桌面版
  const cookie = context.request.headers.get('Cookie') || ''
  if (new RegExp(`(^|;\\s*)${DESKTOP_COOKIE}=1(;|$)`).test(cookie)) {
    return context.next()
  }

  const ua = context.request.headers.get('User-Agent') || ''
  if (!MOBILE_UA.test(ua)) return context.next()

  // 用 302 而不是 301：
  //   同一个 URL 对桌面端仍要返回桌面版，301 会被浏览器永久缓存，
  //   导致这台手机以后再也进不了桌面版。
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/m',
      // 响应取决于 UA，避免被缓存成对所有 UA 都跳转
      Vary: 'User-Agent',
      'Cache-Control': 'no-store',
    },
  })
}
