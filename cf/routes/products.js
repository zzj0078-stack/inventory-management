/**
 * 商品 + 商品分类
 * 对应 backend/app/api/products.py
 */

import { bad, notFound, notImplemented, ok, json, paginated, paginationOf, intParam, boolParam, likeArg } from '../lib/http.js'
import { nowLocal, isoOf } from '../lib/time.js'
import { logOp } from '../lib/oplog.js'

/** 这些字段允许为空，空串要转成 NULL（sku 有唯一索引，多条空串会违反约束） */
const NULLABLE_IF_BLANK = new Set([
  'sku',
  'barcode',
  'spec',
  'color',
  'size',
  'weight',
  'image_url',
  'remark',
  'sub_unit',
])

const PRODUCT_FIELDS = [
  'name',
  'category_id',
  'sku',
  'barcode',
  'unit',
  'sub_unit',
  'sub_unit_ratio',
  'spec',
  'color',
  'size',
  'weight',
  'purchase_price',
  'sale_price',
  'min_stock',
  'image_url',
  'status',
  'remark',
]

const CREATE_FIELDS = PRODUCT_FIELDS.filter((f) => f !== 'status')

/** 空白字符串归一为 null */
function clean(data) {
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    out[k] = NULLABLE_IF_BLANK.has(k) && typeof v === 'string' ? v.trim() || null : v
  }
  return out
}

/** 把数据库完整性错误翻译成可读提示 */
function integrityMsg(e) {
  const text = String((e && e.message) || e)
  const low = text.toLowerCase()
  if (low.includes('unique')) {
    if (low.includes('sku')) return '商品编码已存在，请更换'
    if (low.includes('username')) return '用户名已存在'
    if (low.includes('email')) return '邮箱已被使用'
    return '存在重复数据，请检查唯一字段'
  }
  if (low.includes('foreign key')) return '关联的分类不存在'
  if (low.includes('not null')) return '必填字段不能为空'
  return `数据保存失败：${text}`
}

function toResponse(row, categoryName = undefined) {
  return {
    id: row.id,
    name: row.name,
    category_id: row.category_id ?? null,
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    unit: row.unit,
    sub_unit: row.sub_unit ?? null,
    sub_unit_ratio: row.sub_unit_ratio ?? 1,
    spec: row.spec ?? null,
    color: row.color ?? null,
    size: row.size ?? null,
    weight: row.weight ?? null,
    purchase_price: row.purchase_price ?? 0,
    sale_price: row.sale_price ?? 0,
    min_stock: row.min_stock ?? 0,
    image_url: row.image_url ?? null,
    status: row.status ?? 1,
    remark: row.remark ?? null,
    created_at: isoOf(row.created_at),
    updated_at: isoOf(row.updated_at),
    category_name: categoryName === undefined ? null : categoryName,
  }
}

// ==================== 分类 ====================

async function listCategories(ctx) {
  const rows = await ctx.db.all(
    'SELECT * FROM categories WHERE status = 1 ORDER BY sort_order, id'
  )
  return json(
    rows.map((c) => ({
      id: c.id,
      name: c.name,
      parent_id: c.parent_id ?? null,
      sort_order: c.sort_order ?? 0,
      status: c.status ?? 1,
      created_at: isoOf(c.created_at),
    }))
  )
}

async function createCategory(ctx) {
  const { db, body, user } = ctx
  const name = String(body?.name ?? '').trim()
  if (!name) bad('请输入分类名称')
  if (await db.first('SELECT id FROM categories WHERE name = ?', name)) bad('分类名称已存在')

  const id = await db.insert(
    'INSERT INTO categories (name, parent_id, sort_order, status, created_at) VALUES (?, ?, ?, 1, ?)',
    name,
    body?.parent_id ?? null,
    Number(body?.sort_order ?? 0),
    nowLocal(ctx.env)
  )
  await logOp(db, user, '分类管理', '新增分类', name)

  const row = await db.first('SELECT * FROM categories WHERE id = ?', id)
  return json({
    id: row.id,
    name: row.name,
    parent_id: row.parent_id ?? null,
    sort_order: row.sort_order ?? 0,
    status: row.status ?? 1,
    created_at: isoOf(row.created_at),
  })
}

async function updateCategory(ctx) {
  const { db, body, user, params } = ctx
  const id = Number(params.id)

  const cat = await db.first('SELECT * FROM categories WHERE id = ?', id)
  if (!cat) notFound('分类不存在')

  const name = String(body?.name ?? '').trim()
  if (!name) bad('请输入分类名称')
  if (await db.first('SELECT id FROM categories WHERE name = ? AND id != ?', name, id)) {
    bad('分类名称已存在')
  }

  await db.run(
    'UPDATE categories SET name = ?, sort_order = ? WHERE id = ?',
    name,
    Number(body?.sort_order ?? 0),
    id
  )
  await logOp(db, user, '分类管理', '编辑分类', name)

  const row = await db.first('SELECT * FROM categories WHERE id = ?', id)
  return json({
    id: row.id,
    name: row.name,
    parent_id: row.parent_id ?? null,
    sort_order: row.sort_order ?? 0,
    status: row.status ?? 1,
    created_at: isoOf(row.created_at),
  })
}

async function deleteCategory(ctx) {
  const { db, user, params } = ctx
  const id = Number(params.id)

  const cat = await db.first('SELECT * FROM categories WHERE id = ?', id)
  if (!cat) notFound('分类不存在')

  const used = await db.count('SELECT COUNT(*) AS n FROM products WHERE category_id = ?', id)
  if (used > 0) bad(`该分类下有 ${used} 个商品，无法删除`)

  await db.run('DELETE FROM categories WHERE id = ?', id)
  await logOp(db, user, '分类管理', '删除分类', cat.name)
  return ok('删除成功')
}

// ==================== 商品 ====================

async function list(ctx) {
  const { db, url } = ctx
  const { page, pageSize, offset } = paginationOf(url)

  const keyword = url.searchParams.get('keyword')
  const categoryId = intParam(url.searchParams.get('category_id'))
  const statusRaw = url.searchParams.get('status')
  const status = intParam(statusRaw)

  const where = []
  const params = []

  if (keyword) {
    const k = likeArg(keyword)
    where.push(
      `(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode LIKE ? ESCAPE '\\')`
    )
    params.push(k, k, k)
  }
  if (categoryId !== null && categoryId !== undefined) {
    where.push('p.category_id = ?')
    params.push(categoryId)
  }
  if (statusRaw !== null && statusRaw !== '' && status !== null) {
    where.push('p.status = ?')
    params.push(status)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = await db.count(`SELECT COUNT(*) AS n FROM products p ${whereSql}`, ...params)

  const rows = await db.all(
    `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${whereSql}
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset
  )

  return paginated(total, page, pageSize, rows.map((r) => toResponse(r, r.category_name ?? null)))
}

/** 按 id 取商品（连带分类名）。
 *  注意：Python 版只在「列表」接口填 category_name，新增/详情返回 null。
 *  这里统一为始终填充 —— 是超集，不会破坏任何调用方。 */
async function fetchProduct(db, id) {
  const row = await db.first(
    `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?`,
    id
  )
  return row ? toResponse(row, row.category_name ?? null) : null
}

async function get(ctx) {
  const { db, params } = ctx
  const data = await fetchProduct(db, Number(params.id))
  if (!data) notFound('商品不存在')
  return json(data)
}

async function create(ctx) {
  const { db, body, user } = ctx
  const data = clean(body || {})

  if (!data.name) bad('请输入商品名称')
  if (!data.unit) bad('请输入单位')

  if (data.sku && (await db.first('SELECT id FROM products WHERE sku = ?', data.sku))) {
    bad('商品编码已存在')
  }

  const now = nowLocal(ctx.env)
  const cols = [...CREATE_FIELDS, 'status', 'created_at', 'updated_at']
  const values = [
    ...CREATE_FIELDS.map((f) => (data[f] === undefined ? null : data[f])),
    1,
    now,
    now,
  ]

  let id
  try {
    id = await db.insert(
      `INSERT INTO products (${cols.map((c) => `"${c}"`).join(', ')})
       VALUES (${cols.map(() => '?').join(', ')})`,
      ...values
    )
  } catch (e) {
    bad(integrityMsg(e))
  }

  await logOp(db, user, '商品管理', '新增商品', data.name)

  return json(await fetchProduct(db, id))
}

async function update(ctx) {
  const { db, body, user, params } = ctx
  const id = Number(params.id)

  const existing = await db.first('SELECT * FROM products WHERE id = ?', id)
  if (!existing) notFound('商品不存在')

  // 只处理显式传入的字段（对应 exclude_unset）
  const incoming = {}
  for (const [k, v] of Object.entries(body || {})) {
    if (PRODUCT_FIELDS.includes(k)) incoming[k] = v
  }
  const data = clean(incoming)

  if (data.sku && data.sku !== existing.sku) {
    if (await db.first('SELECT id FROM products WHERE sku = ? AND id != ?', data.sku, id)) {
      bad('商品编码已存在')
    }
  }

  const sets = []
  const values = []
  for (const [k, v] of Object.entries(data)) {
    sets.push(`"${k}" = ?`)
    values.push(v === undefined ? null : v)
  }

  if (sets.length) {
    sets.push('updated_at = ?')
    values.push(nowLocal(ctx.env))
    try {
      await db.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, ...values, id)
    } catch (e) {
      bad(integrityMsg(e))
    }
  }

  await logOp(db, user, '商品管理', '编辑商品', existing.name || '')

  return json(await fetchProduct(db, id))
}

async function remove(ctx) {
  const { db, user, params, url } = ctx
  const id = Number(params.id)
  const force = boolParam(url.searchParams.get('force'))

  const product = await db.first('SELECT * FROM products WHERE id = ?', id)
  if (!product) notFound('商品不存在')

  // ---- 引用检查：防止产生孤儿数据 ----
  const refs = []
  const checks = [
    ['purchase_items', '条采购明细'],
    ['sales_items', '条销售明细'],
    ['sale_return_items', '条销售退货明细'],
    ['purchase_return_items', '条采购退货明细'],
  ]
  for (const [table, label] of checks) {
    const n = await db.count(`SELECT COUNT(*) AS n FROM ${table} WHERE product_id = ?`, id)
    if (n) refs.push(`${n} ${label}`)
  }

  if (refs.length) {
    bad(
      `该商品已被以下单据引用，无法删除：${refs.join('、')}。如需停用请改为「禁用」状态。`
    )
  }

  const invRows = await db.all('SELECT * FROM inventory WHERE product_id = ?', id)
  const nonzero = invRows.filter((r) => Number(r.quantity) !== 0)
  if (nonzero.length && !force) {
    const total = nonzero.reduce((s, r) => s + Number(r.quantity || 0), 0)
    bad(
      `该商品在 ${nonzero.length} 个仓库尚有库存共 ${total}，请先出库或盘点清零后再删除`
    )
  }

  await db.batch([
    db.raw.prepare('DELETE FROM inventory WHERE product_id = ?').bind(id),
    db.raw.prepare('DELETE FROM products WHERE id = ?').bind(id),
  ])

  await logOp(
    db,
    user,
    '商品管理',
    '删除商品',
    product.name,
    `清理库存 ${invRows.length} 条${force ? '(强制)' : ''}`
  )
  return ok('删除成功')
}

async function uploadImage(ctx) {
  // Cloudflare Workers 没有文件系统；图片需改用 R2 存储，属于阶段 2 的工作
  notImplemented('图片上传尚未移植到 Cloudflare（需改用 R2 存储）。可先填写外链图片地址。')
}

export const routes = [
  // 注意：categories 必须排在 /{id} 之前（\d+ 不会匹配 categories，实际无冲突）
  { method: 'GET', path: /^\/api\/products\/categories$/, perm: 'category:view', handler: listCategories },
  { method: 'POST', path: /^\/api\/products\/categories$/, perm: 'category:add', handler: createCategory },
  { method: 'PUT', path: /^\/api\/products\/categories\/(?<id>\d+)$/, perm: 'category:edit', handler: updateCategory },
  { method: 'DELETE', path: /^\/api\/products\/categories\/(?<id>\d+)$/, perm: 'category:delete', handler: deleteCategory },

  { method: 'POST', path: /^\/api\/products\/upload-image$/, perm: ['product:add', 'product:edit'], handler: uploadImage },

  { method: 'GET', path: /^\/api\/products$/, perm: 'product:view', handler: list },
  { method: 'POST', path: /^\/api\/products$/, perm: 'product:add', handler: create },
  { method: 'GET', path: /^\/api\/products\/(?<id>\d+)$/, perm: 'product:view', handler: get },
  { method: 'PUT', path: /^\/api\/products\/(?<id>\d+)$/, perm: 'product:edit', handler: update },
  { method: 'DELETE', path: /^\/api\/products\/(?<id>\d+)$/, perm: 'product:delete', handler: remove },
]
