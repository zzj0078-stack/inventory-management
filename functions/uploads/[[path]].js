/**
 * 提供上传的商品图片
 *
 * 路由：GET /uploads/<key>   （如 /uploads/products/20260930_ab12cd34ef56.jpg）
 *
 * 存储：Cloudflare KV（binding IMAGES）
 *
 * 为什么走这个 Function 而不是对象存储的公开域名：
 *   - 同源，前端 <img src="/uploads/..."> 一行都不用改，也没有跨域问题
 *   - Python 版返回的就是 /uploads/products/<名>，历史 image_url 值可直接沿用
 *   - 不用额外绑自定义域名，也不用开任何「公开访问」
 *
 * 为什么用 KV 不用 R2：R2 需先在控制台启用（还要绑支付方式），KV 开箱即用。
 */

export async function onRequestGet(context) {
  const { params, env } = context

  const store = env.IMAGES
  if (!store) {
    return new Response('图片存储未配置（KV 绑定 IMAGES 缺失）', { status: 501 })
  }

  const key = Array.isArray(params.path) ? params.path.join('/') : params.path
  if (!key) return new Response('Not Found', { status: 404 })

  let value = null
  let metadata = null
  try {
    const res = await store.getWithMetadata(key, 'arrayBuffer')
    value = res ? res.value : null
    metadata = res ? res.metadata : null
  } catch {
    return new Response('读取图片失败', { status: 500 })
  }

  if (value === null || value === undefined) {
    return new Response('Not Found', { status: 404 })
  }

  // KV 不提供 httpEtag（那是 R2 的特性）。文件名本身是「日期 + 随机串」，
  // 内容永不改变，所以直接用 key 当 ETag —— 支持条件请求，复访可省一次 KV 读取。
  const etag = `"${key}"`
  const cacheControl = 'public, max-age=31536000, immutable'

  if (context.request.headers.get('If-None-Match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': cacheControl },
    })
  }

  const headers = new Headers()
  headers.set('Content-Type', (metadata && metadata.contentType) || 'application/octet-stream')
  if (metadata && metadata.size) headers.set('Content-Length', String(metadata.size))
  headers.set('ETag', etag)
  // 文件名含日期 + 随机串，内容永不改变，可长缓存（减少 KV 读取次数）
  headers.set('Cache-Control', cacheControl)

  return new Response(value, { headers })
}
