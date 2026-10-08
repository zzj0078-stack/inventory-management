/**
 * 操作日志 / 数据自检 / CSV 导出
 * 对应 backend/app/api/extended.py 的 logs、health-check、export 段
 */

import { bad, notFound, ok, json, paginated, paginationOf, likeArg } from '../lib/http.js'
import { nowLocal, isoOf } from '../lib/time.js'
import { logOp } from '../lib/oplog.js'
import { chunk } from '../lib/db.js'
import { canSeeCost } from '../lib/perms.js'
import { buildStatementData } from './statements.js'

// ==================== 操作日志 ====================

async function listLogs(ctx) {
  const { db, url } = ctx
  const { page, pageSize, offset } = paginationOf(url)

  const where = []
  const params = []

  const module = url.searchParams.get('module')
  if (module) {
    where.push('module = ?')
    params.push(module)
  }

  const keyword = url.searchParams.get('keyword')
  if (keyword) {
    const k = likeArg(keyword)
    where.push(
      `(target LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\')`
    )
    params.push(k, k, k)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = await db.count(`SELECT COUNT(*) AS n FROM operation_logs ${whereSql}`, ...params)
  const rows = await db.all(
    `SELECT * FROM operation_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset
  )

  const items = rows.map((r) => ({
    id: r.id,
    user_id: r.user_id ?? null,
    username: r.username || 'anonymous',
    module: r.module,
    action: r.action,
    target: r.target || '',
    detail: r.detail || '',
    ip: r.ip || '',
    created_at: isoOf(r.created_at),
  }))

  return paginated(total, page, pageSize, items)
}

// ==================== 数据自检 ====================

/**
 * 收集全部数据问题。每条带 fixable 标记与 fix_action。
 *
 * 比 Python 版少很多 N+1：单据金额核对用一条 JOIN 聚合搞定，
 * Python 是逐单取 items 再求和。
 */
async function collectIssues(db) {
  const issues = []

  /**
   * 用 anti-join 只查出「孤儿」记录。
   *
   * 之前的写法是把整张表读进内存再逐行比对（还要先加载 4 张主表的全部 id），
   * 数据一多就非常慢 —— 自检跑到 5 秒以上，/fix 因为要跑两遍直接把连接拖断。
   * 改成 LEFT JOIN ... IS NULL + GROUP BY 后，返回的只有问题行，且能走外键索引。
   */
  const checkRefs = async (table, field, refTable, label, fixable = false, action = null) => {
    const rows = await db.all(
      `SELECT t.${field} AS ref_id, COUNT(*) AS n, GROUP_CONCAT(t.id) AS ids
         FROM ${table} t
         LEFT JOIN ${refTable} r ON r.id = t.${field}
        WHERE t.${field} IS NOT NULL AND r.id IS NULL
        GROUP BY t.${field}
        ORDER BY t.${field}`
    )
    for (const row of rows) {
      const ids = String(row.ids || '')
        .split(',')
        .map((x) => Number.parseInt(x, 10))
        .filter((x) => Number.isFinite(x))
      issues.push({
        level: 'error',
        table,
        field,
        ref_id: row.ref_id,
        row_ids: ids,
        message:
          `${label} #${row.ref_id} 已不存在，${row.n} 条记录引用它` +
          `（ID: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? '...' : ''}）`,
        fix: fixable ? '删除这些孤儿记录' : `该${table}记录的${field}需重新指定，或恢复对应主数据`,
        fixable,
        fix_action: action,
      })
    }
  }

  // 单据引用已删除的往来单位 —— 不能自动删，涉及业务数据
  await checkRefs('purchase_orders', 'supplier_id', 'suppliers', '供应商')
  await checkRefs('sales_orders', 'customer_id', 'customers', '客户')
  await checkRefs('sale_returns', 'customer_id', 'customers', '客户')
  await checkRefs('purchase_returns', 'supplier_id', 'suppliers', '供应商')

  // 库存指向已删除的商品/仓库 —— 可自动清理
  await checkRefs('inventory', 'product_id', 'products', '商品', true, 'delete_orphan_inventory')
  await checkRefs('inventory', 'warehouse_id', 'warehouses', '仓库', true, 'delete_orphan_inventory')

  // 库存流水是历史留痕，不自动删
  await checkRefs('stock_logs', 'product_id', 'products', '商品')
  await checkRefs('stock_logs', 'warehouse_id', 'warehouses', '仓库')

  // 负库存
  const negRows = await db.all('SELECT id FROM inventory WHERE quantity < 0')
  if (negRows.length) {
    issues.push({
      level: 'error',
      table: 'inventory',
      message: `${negRows.length} 条库存记录为负数（ID: ${negRows.map((r) => r.id).slice(0, 8).join(', ')}）`,
      fix: '执行库存盘点调整',
      fixable: false,
      fix_action: null,
    })
  }

  // 单据金额与明细合计不符 —— 可自动重算
  // 注意：整单合计 = Σ明细金额 + 运费（价内税口径下税额是内含的，不参与合计），
  // Python 版只比 Σ明细，运费非 0 就误报，且「修复」会把运费抹掉。这里已修正。
  const amountChecks = [
    ['purchase_orders', 'purchase_items', '采购单'],
    ['sales_orders', 'sales_items', '销售单'],
  ]
  for (const [orders, items, label] of amountChecks) {
    const rows = await db.all(
      `SELECT o.id, o.order_no, o.total_amount, COALESCE(o.freight, 0) AS freight,
              COALESCE(SUM(i.amount), 0) AS items_sum,
              COUNT(i.id) AS item_count
         FROM ${orders} o
         LEFT JOIN ${items} i ON i.order_id = o.id
        GROUP BY o.id`
    )
    for (const r of rows) {
      if (Number(r.item_count) === 0) continue
      const freight = Number(r.freight || 0)
      const expect = Number(r.items_sum || 0) + freight
      const total = Number(r.total_amount || 0)
      if (Math.abs(expect - total) > 0.01) {
        const freightTip = freight ? ` + 运费 ${freight.toFixed(2)}` : ''
        issues.push({
          level: 'warn',
          table: orders,
          message:
            `${label} ${r.order_no} 明细合计 ${Number(r.items_sum || 0).toFixed(2)}${freightTip}` +
            ` = ${expect.toFixed(2)} ≠ 单据金额 ${total.toFixed(2)}`,
          fix: `按明细重算为 ${expect.toFixed(2)}`,
          fixable: true,
          fix_action: 'recalc_order_amount',
          row_ids: [r.id],
        })
      }
    }
  }

  // 无仓库
  const warehouseCount = await db.count('SELECT COUNT(*) AS n FROM warehouses')
  if (warehouseCount === 0) {
    issues.push({
      level: 'error',
      table: 'warehouses',
      message: '系统无仓库记录，入库/出库将失败',
      fix: '新增至少一个仓库',
      fixable: false,
      fix_action: null,
    })
  }

  // ---------------- 核销数据（收付款分配） ----------------
  //
  // 这块以前完全没有检查。payment_allocations 是判断单据是否结清的唯一依据，
  // 一旦出现孤儿或超额，单据的结清状态就是错的，而且界面上看不出来。

  // 1) 核销记录指向已删除的收付款 —— 可自动清理
  await checkRefs(
    'payment_allocations',
    'payment_id',
    'payments',
    '收付款',
    true,
    'delete_orphan_allocations'
  )

  // 2) 核销记录指向已删除的单据 —— 可自动清理
  //    这类孤儿最危险：单据没了，分配还在，会一直虚增该单的已结金额
  for (const [rt, table, label] of [
    ['sales_order', 'sales_orders', '销售单'],
    ['purchase_order', 'purchase_orders', '采购单'],
  ]) {
    const rows = await db.all(
      `SELECT pa.related_id AS rid, COUNT(*) AS n, GROUP_CONCAT(pa.id) AS ids
         FROM payment_allocations pa
         LEFT JOIN ${table} o ON o.id = pa.related_id
        WHERE pa.related_type = ? AND o.id IS NULL
        GROUP BY pa.related_id`,
      rt
    )
    for (const r of rows) {
      const ids = String(r.ids || '')
        .split(',')
        .map((x) => Number.parseInt(x, 10))
        .filter((x) => Number.isFinite(x))
      issues.push({
        level: 'error',
        table: 'payment_allocations',
        ref_id: r.rid,
        row_ids: ids,
        message: `${label} #${r.rid} 已不存在，但有 ${r.n} 条核销记录指向它（核销 ID: ${ids.slice(0, 8).join(', ')}）`,
        fix: '删除这些孤儿核销记录',
        fixable: true,
        fix_action: 'delete_orphan_allocations',
      })
    }
  }

  // 3) 核销金额超过应结金额 —— 结清状态会失真，但不自动改业务数据
  //    应结 = 单据金额 − 已退货；与单据列表的口径保持一致
  const overAlloc = [
    ['sales_order', 'sales_orders', 'sale_returns', 'sales_order_id', '销售单'],
    ['purchase_order', 'purchase_orders', 'purchase_returns', 'purchase_order_id', '采购单'],
  ]
  for (const [rt, ordersTable, retTable, retFk, label] of overAlloc) {
    const rows = await db.all(
      `SELECT o.id, o.order_no, o.total_amount,
              COALESCE((SELECT SUM(total_amount) FROM ${retTable}
                         WHERE ${retFk} = o.id AND status IN (1,2)), 0) AS returned,
              COALESCE((SELECT SUM(amount) FROM payment_allocations
                         WHERE related_type = ? AND related_id = o.id), 0) AS allocated
         FROM ${ordersTable} o
        WHERE o.status IN (1,2,3,5,6)`,
      rt
    )
    for (const r of rows) {
      const payable = Math.round((Number(r.total_amount || 0) - Number(r.returned || 0)) * 100) / 100
      const allocated = Math.round(Number(r.allocated || 0) * 100) / 100
      if (payable >= 0 && allocated > payable + 0.01) {
        issues.push({
          level: 'warn',
          table: ordersTable,
          row_ids: [r.id],
          message:
            `${label} ${r.order_no} 已核销 ${allocated.toFixed(2)} 超过应结 ${payable.toFixed(2)}` +
            `（单据 ${Number(r.total_amount || 0).toFixed(2)} − 退货 ${Number(r.returned || 0).toFixed(2)}）`,
          fix: '核对收付款的核销明细，调整分配金额',
          fixable: false,
          fix_action: null,
        })
      }
    }
  }

  // ---------------- 单据明细孤儿 ----------------
  // 单据被删后明细残留，会让「明细合计」等统计把已删单据算进去
  await checkRefs('sales_items', 'order_id', 'sales_orders', '销售单', true, 'delete_orphan_items')
  await checkRefs('purchase_items', 'order_id', 'purchase_orders', '采购单', true, 'delete_orphan_items')
  await checkRefs('sale_return_items', 'return_id', 'sale_returns', '销售退货单', true, 'delete_orphan_items')
  await checkRefs(
    'purchase_return_items',
    'return_id',
    'purchase_returns',
    '采购退货单',
    true,
    'delete_orphan_items'
  )

  // ---------------- 其它主数据引用 ----------------
  await checkRefs('products', 'category_id', 'categories', '商品分类')
  await checkRefs('users', 'role_id', 'roles', '角色')

  return issues
}

async function healthCheck(ctx) {
  const issues = await collectIssues(ctx.db)
  return json({
    ok: issues.filter((i) => i.level === 'error').length === 0,
    error_count: issues.filter((i) => i.level === 'error').length,
    warn_count: issues.filter((i) => i.level === 'warn').length,
    fixable_count: issues.filter((i) => i.fixable).length,
    issues,
  })
}

async function healthCheckFix(ctx) {
  const { db } = ctx
  const issues = await collectIssues(db)
  const fixed = []

  for (const it of issues) {
    if (!it.fixable) continue
    const action = it.fix_action

    if (action === 'delete_orphan_inventory') {
      const ids = it.row_ids || []
      if (!ids.length) continue
      // 分块 DELETE：孤儿可能成百上千条，不分块会撞 D1 的 100 参数上限，
      // 结果就是「一键修复」在真正需要修的时候反而失败。
      let n = 0
      for (const part of chunk(ids)) {
        const ph = part.map(() => '?').join(',')
        const res = await db.run(`DELETE FROM inventory WHERE id IN (${ph})`, ...part)
        n += res && res.meta ? res.meta.changes : part.length
      }
      fixed.push(`删除孤儿库存 ${n} 条（${String(it.message).split('，')[0]}）`)
    } else if (action === 'recalc_order_amount') {
      const oid = (it.row_ids || [])[0]
      if (!oid) continue
      const isPurchase = it.table === 'purchase_orders'
      const itemsTable = isPurchase ? 'purchase_items' : 'sales_items'
      const ordersTable = it.table

      // 合计口径：Σ明细金额 + 运费（不能只算明细，否则会丢掉运费）
      const order = await db.first(
        `SELECT order_no, COALESCE(freight, 0) AS freight FROM ${ordersTable} WHERE id = ?`,
        oid
      )
      if (!order) continue

      const itemsSum = Number(
        (await db.scalar(`SELECT COALESCE(SUM(amount), 0) AS v FROM ${itemsTable} WHERE order_id = ?`, oid)) || 0
      )
      const expect = itemsSum + Number(order.freight || 0)

      await db.run(`UPDATE ${ordersTable} SET total_amount = ? WHERE id = ?`, expect, oid)
      fixed.push(`${isPurchase ? '采购单' : '销售单'} ${order.order_no} 金额重算为 ${expect.toFixed(2)}`)
    } else if (action === 'delete_orphan_allocations') {
      // 孤儿核销记录：指向已删除的收付款或单据，留着会虚增已结金额
      const ids = it.row_ids || []
      if (!ids.length) continue
      let n = 0
      for (const part of chunk(ids)) {
        const ph = part.map(() => '?').join(',')
        const res = await db.run(`DELETE FROM payment_allocations WHERE id IN (${ph})`, ...part)
        n += res && res.meta ? res.meta.changes : part.length
      }
      fixed.push(`删除孤儿核销记录 ${n} 条（${String(it.message).split('，')[0]}）`)
    } else if (action === 'delete_orphan_items') {
      // 单据明细孤儿：单据已删，明细还在
      const ids = it.row_ids || []
      if (!ids.length) continue
      const table = it.table
      if (!['sales_items', 'purchase_items', 'sale_return_items', 'purchase_return_items'].includes(table)) {
        continue
      }
      let n = 0
      for (const part of chunk(ids)) {
        const ph = part.map(() => '?').join(',')
        const res = await db.run(`DELETE FROM ${table} WHERE id IN (${ph})`, ...part)
        n += res && res.meta ? res.meta.changes : part.length
      }
      fixed.push(`删除孤儿明细 ${n} 条（${table}）`)
    }
  }

  if (fixed.length) {
    await logOp(db, ctx.user, '数据自检', '自动修复', `${fixed.length} 项`, fixed.join('；').slice(0, 500))
  }

  // 什么都没修就不用重扫 —— 自检本身要遍历全库，跑两遍是纯粹的浪费，
  // 之前正是因为跑两遍耗时才把 dev 代理连接拖断（生产上也白烧 CPU）。
  const remaining = fixed.length ? await collectIssues(db) : issues
  const manual = remaining.filter((i) => !i.fixable)

  return json({
    fixed_count: fixed.length,
    fixed,
    manual_count: manual.length,
    manual: manual.map((i) => i.message),
    ok: remaining.filter((i) => i.level === 'error').length === 0,
  })
}

// ==================== CSV 导出 ====================

/** CSV 转义：含逗号/引号/换行时加引号并双写引号 */
function csvCell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 生成 CSV（带 BOM 让 Excel 正确识别中文；CRLF 换行与 Python csv 默认一致） */
function toCsv(header, rows) {
  const lines = [header.map(csvCell).join(',')]
  for (const r of rows) lines.push(r.map(csvCell).join(','))
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

function csvResponse(filename, header, rows) {
  return new Response(toCsv(header, rows), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

/** 单据状态文案。
 *  注意：Python 版这里用的是 ["待审核","已审核","已出库","已作废"] 这种残缺映射，
 *  status >= 4 会直接 IndexError，且 status=3 被误标成「已作废」。
 *  这里改用完整正确的状态表。 */
const SALES_STATUS = ['草稿', '已审核', '部分发货', '已发货', '已关闭', '部分退货', '已退货']
const PURCHASE_STATUS = ['草稿', '已审核', '部分收货', '已收货', '已关闭', '部分退货', '已退货']

function stamp(env) {
  // YYYYMMDDHHMM（业务时区）
  return nowLocal(env).replace(/[-: ]/g, '').slice(0, 12)
}

async function exportCsv(ctx) {
  const { db, env, url, params } = ctx
  const kind = params.kind
  const ts = stamp(env)

  if (kind === 'inventory') {
    const rows = await db.all(
      `SELECT p.name, p.sku, w.name AS warehouse_name, i.quantity,
              p.purchase_price, p.min_stock
         FROM inventory i
         JOIN products p   ON p.id = i.product_id
         JOIN warehouses w ON w.id = i.warehouse_id
        ORDER BY p.name`
    )
    // 导出同样受 product:cost 控制：没有权限时**整列都不出现**，
    // 否则「藏列」等于没藏 —— 导出的 CSV 里照样有成本价。
    const showCost = canSeeCost(ctx.perms)
    const header = showCost
      ? ['商品', '商品编码', '仓库', '数量', '成本价', '金额', '最低库存']
      : ['商品', '商品编码', '仓库', '数量', '最低库存']
    return csvResponse(
      `inventory_${ts}.csv`,
      header,
      rows.map((r) =>
        showCost
          ? [
              r.name,
              r.sku || '',
              r.warehouse_name,
              r.quantity,
              Number(r.purchase_price || 0),
              Number(r.quantity || 0) * Number(r.purchase_price || 0),
              r.min_stock ?? 0,
            ]
          : [r.name, r.sku || '', r.warehouse_name, r.quantity, r.min_stock ?? 0]
      )
    )
  }

  if (kind === 'sales') {
    const rows = await db.all(
      `SELECT o.order_no, o.total_amount, o.status, o.invoice_no, o.delivery_address, o.created_at,
              c.name AS customer_name
         FROM sales_orders o
         LEFT JOIN customers c ON c.id = o.customer_id
        ORDER BY o.id DESC`
    )
    return csvResponse(
      `sales_${ts}.csv`,
      ['销售单号', '客户', '金额', '状态', '发票号', '送货地址', '创建时间'],
      rows.map((r) => [
        r.order_no,
        r.customer_name || '',
        Number(r.total_amount || 0),
        SALES_STATUS[r.status] ?? '',
        r.invoice_no || '',
        r.delivery_address || '',
        r.created_at ? String(r.created_at).slice(0, 16) : '',
      ])
    )
  }

  if (kind === 'purchase') {
    const rows = await db.all(
      `SELECT o.order_no, o.total_amount, o.status, o.invoice_no, o.created_at,
              s.name AS supplier_name
         FROM purchase_orders o
         LEFT JOIN suppliers s ON s.id = o.supplier_id
        ORDER BY o.id DESC`
    )
    return csvResponse(
      `purchase_${ts}.csv`,
      ['采购单号', '供应商', '金额', '状态', '发票号', '创建时间'],
      rows.map((r) => [
        r.order_no,
        r.supplier_name || '',
        Number(r.total_amount || 0),
        PURCHASE_STATUS[r.status] ?? '',
        r.invoice_no || '',
        r.created_at ? String(r.created_at).slice(0, 16) : '',
      ])
    )
  }

  if (kind === 'stocklog') {
    const rows = await db.all(
      `SELECT l.id, l.type, l.quantity, l.before_quantity, l.after_quantity,
              l.related_no, l.created_at,
              p.name AS product_name, w.name AS warehouse_name
         FROM stock_logs l
         LEFT JOIN products p   ON p.id = l.product_id
         LEFT JOIN warehouses w ON w.id = l.warehouse_id
        ORDER BY l.id DESC
        LIMIT 5000`
    )
    return csvResponse(
      `stocklog_${ts}.csv`,
      ['ID', '商品', '仓库', '类型', '数量', '变动前', '变动后', '关联单号', '时间'],
      rows.map((r) => [
        r.id,
        r.product_name || '',
        r.warehouse_name || '',
        r.type,
        r.quantity,
        r.before_quantity,
        r.after_quantity,
        r.related_no || '',
        r.created_at ? String(r.created_at).slice(0, 16) : '',
      ])
    )
  }

  if (kind === 'payments') {
    const rows = await db.all(
      `SELECT p.*,
              COALESCE(c.name, s.name) AS partner_name
         FROM payments p
         LEFT JOIN customers c ON p.partner_type = 'customer' AND c.id = p.partner_id
         LEFT JOIN suppliers s ON p.partner_type <> 'customer' AND s.id = p.partner_id
        ORDER BY p.id DESC
        LIMIT 5000`
    )
    return csvResponse(
      `payments_${ts}.csv`,
      ['单号', '类型', '对象类型', '往来单位', '金额', '支付方式', '凭证号', '备注', '时间'],
      rows.map((r) => [
        r.payment_no,
        r.type === 1 ? '收款' : '付款',
        r.partner_type === 'customer' ? '客户' : '供应商',
        r.partner_name || `#${r.partner_id}`,
        Number(r.amount || 0),
        r.payment_method || '',
        r.voucher_no || '',
        r.remark || '',
        r.created_at ? String(r.created_at).slice(0, 16) : '',
      ])
    )
  }

  if (kind === 'logs') {
    const rows = await db.all(
      'SELECT id, username, module, action, target, detail, created_at FROM operation_logs ORDER BY id DESC LIMIT 5000'
    )
    return csvResponse(
      `logs_${ts}.csv`,
      ['ID', '用户', '模块', '动作', '对象', '详情', '时间'],
      rows.map((r) => [
        r.id,
        r.username,
        r.module,
        r.action,
        r.target,
        r.detail || '',
        r.created_at ? String(r.created_at).slice(0, 16) : '',
      ])
    )
  }

  // 对账单：与页面同一份口径（复用 buildStatementData）。
  // 单据行带上本单的送货地址/接收人/接收人电话，对账时按单号就能看到货送到哪、谁收。
  if (kind === 'statement') {
    const side = url.searchParams.get('side') === 'supplier' ? 'supplier' : 'customer'
    const data = await buildStatementData(ctx, side)
    const label = side === 'customer' ? '\u5ba2\u6237' : '\u4f9b\u5e94\u5546'
    const COLS = [
      '\u65e5\u671f',
      '\u7c7b\u578b',
      '\u5355\u53f7',
      '\u5185\u5bb9\uff08\u5546\u54c1\u00d7\u6570\u91cf\uff09',
      '\u6570\u91cf',
      '\u589e\u52a0',
      '\u51cf\u5c11',
      '\u4f59\u989d',
      '\u9001\u8d27\u5730\u5740',
      '\u63a5\u6536\u4eba',
      '\u63a5\u6536\u4eba\u7535\u8bdd',
    ]
    const N = COLS.length
    // 抬头 / 合计这类行只有前几列有值，用空串补齐到 N 列
    const blank = () => new Array(N).fill('')
    const put = (i, v) => {
      const r = blank()
      r[i] = v
      return r
    }
    /** info 行：[标签, 值] 对，从第 0 列开始依次摆放 */
    const infoRow = (pairs) => {
      const r = blank()
      pairs.forEach(([k, v], i) => {
        if (i * 2 + 1 < N) {
          r[i * 2] = k
          r[i * 2 + 1] = v
        }
      })
      return r
    }

    const body = data.rows.map((r) => [
      r.date,
      r.kind,
      r.doc_no,
      r.items_summary || '',
      r.items_quantity || '',
      Number(r.increase) || '',
      Number(r.decrease) || '',
      r.balance,
      r.delivery_address || '',
      r.receiver_name || '',
      r.receiver_phone || '',
    ])

    const footer = blank()
    footer[6] = '\u672c\u671f\u5408\u8ba1'
    footer[7] = data.total_increase
    const footer2 = blank()
    footer2[7] = data.total_decrease
    const closing = put(7, data.closing_balance)
    closing[0] = '\u671f\u672b\u4f59\u989d'

    return csvResponse(
      `statement_${side}_${ts}.csv`,
      // 第一行放抬头：CSV 里没有页眉，抬头只能作为首行存在
      (() => {
        const r = blank()
        r[0] = `${label}\u5bf9\u8d26\u5355`
        r[1] = data.partner.name
        return r
      })(),
      [
        infoRow([
          ['\u8054\u7cfb\u4eba', data.partner.contact || ''],
          ['\u7535\u8bdd', data.partner.phone || ''],
          ['\u5730\u5740', data.partner.address || ''],
        ]),
        infoRow([
          [
            '\u671f\u95f4',
            `${data.start || '\u4e0d\u9650'} ~ ${data.end || '\u4e0d\u9650'}`,
          ],
        ]),
        COLS,
        put(7, data.opening_balance).map((v, i) => (i === 0 ? '\u671f\u521d\u4f59\u989d' : v)),
        ...body,
        footer,
        footer2,
        closing,
      ]
    )
  }

  notFound('不支持的导出类型')
}

/** 导出权限按 kind 映射（对应 backend 的 EXPORT_PERM，缺省 report:view） */
const EXPORT_PERM = {
  inventory: 'inventory:export',
  sales: 'sales:export',
  purchase: 'purchase:export',
  stocklog: 'stocklog:export',
  logs: 'log:export',
  payments: 'finance:export',
  // 对账单：客户或供应商任一权限即可（与页面路由保持一致）
  statement: ['customer:view', 'supplier:view'],
}

/**
 * 导出路由：每个 kind 一条，权限各不相同（对应 Python 的 EXPORT_PERM）。
 * 正则必须带 (?<kind>...) 命名分组 —— handler 从 params.kind 取类型。
 */
function exportRoutes() {
  return Object.entries(EXPORT_PERM).map(([kind, perm]) => ({
    method: 'GET',
    path: new RegExp(`^/api/ext/export/(?<kind>${kind})$`),
    perm,
    handler: exportCsv,
  }))
}

export const routes = [
  { method: 'GET', path: /^\/api\/ext\/logs$/, perm: 'log:view', handler: listLogs },
  { method: 'GET', path: /^\/api\/ext\/health-check$/, perm: 'system:check', handler: healthCheck },
  { method: 'POST', path: /^\/api\/ext\/health-check\/fix$/, perm: 'system:fix', handler: healthCheckFix },

  ...exportRoutes(),

  // 未知 kind 兜底：走同一个 handler，由它返回「不支持的导出类型」
  {
    method: 'GET',
    path: /^\/api\/ext\/export\/(?<kind>[^/]+)$/,
    perm: 'report:view',
    handler: exportCsv,
  },
]
