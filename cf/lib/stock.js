/**
 * 库存变动 —— D1 版本
 *
 * Python 版把「改库存 + 写流水」放在一个 SQLAlchemy 事务里，天然原子。
 * D1 没有交互式事务，只有 `db.batch()`（整批原子）。所以这里改成两段式：
 *
 *   1) planStock()  只读：做完全部校验，算好 before/after
 *   2) 返回的 statements 交给 db.batch() 一次性原子提交
 *
 * 库存用「相对更新」而不是写绝对值：
 *     quantity = quantity + excluded.quantity
 * 这样并发下不会丢失更新（避免 A 读 10、B 读 10、A 写 8、B 写 8 的覆盖）。
 * 再加 `WHERE quantity + excluded.quantity >= 0` 兜住负库存，
 * 正常情况下负库存会被 planStock 的校验提前拦下并给出友好提示。
 */

import { bad } from './http.js'
import { nowLocal } from './time.js'

/** 取启用的第一个仓库；都没有就建一个（与 Python 的 default_warehouse_id 行为一致） */
export async function defaultWarehouseId(db, env) {
  const wh = await db.first('SELECT id FROM warehouses WHERE status = 1 ORDER BY id LIMIT 1')
  if (wh) return wh.id

  const any = await db.first('SELECT id FROM warehouses ORDER BY id LIMIT 1')
  if (any) return any.id

  const id = await db.insert(
    'INSERT INTO warehouses (name, address, status, created_at) VALUES (?, ?, 1, ?)',
    '默认仓库',
    '总部',
    nowLocal(env)
  )
  return id
}

/**
 * 规划一次库存变动（只读，不改库）
 *
 * @param {{db: object, env: object}} ctx
 * @param {object} p
 * @param {number} p.productId
 * @param {number|null} p.warehouseId  为空则用默认仓库
 * @param {number} p.delta             正数入库，负数出库
 * @param {string} p.type              stock_logs.type，如 purchase_in / sale_out
 * @param {string} [p.relatedType]
 * @param {number|null} [p.relatedId]
 * @param {string} [p.relatedNo]
 * @param {string} [p.remark]
 * @returns {Promise<{statements: any[], before: number, after: number, warehouseId: number}>}
 */
export async function planStock(ctx, p) {
  const { db, env } = ctx
  const delta = Number(p.delta) || 0
  const wid = p.warehouseId || (await defaultWarehouseId(db, env))

  const inv = await db.first(
    'SELECT id, quantity FROM inventory WHERE product_id = ? AND warehouse_id = ?',
    p.productId,
    wid
  )

  const before = inv ? Number(inv.quantity || 0) : 0
  const after = before + delta

  if (after < 0) {
    bad(`商品#${p.productId} 库存不足（现有 ${before}）`)
  }

  const now = nowLocal(env)

  const statements = [
    // 相对更新 + 守卫；DO UPDATE 的 WHERE 不满足时该语句不生效（changes=0）
    db.raw
      .prepare(
        `INSERT INTO inventory (product_id, warehouse_id, quantity, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
           quantity   = quantity + excluded.quantity,
           updated_at = excluded.updated_at
         WHERE inventory.quantity + excluded.quantity >= 0`
      )
      .bind(p.productId, wid, delta, now),

    db.raw
      .prepare(
        `INSERT INTO stock_logs
           (product_id, warehouse_id, type, quantity, before_quantity, after_quantity,
            related_type, related_id, related_no, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        p.productId,
        wid,
        p.type,
        delta,
        before,
        after,
        p.relatedType ?? '',
        p.relatedId ?? null,
        p.relatedNo ?? '',
        p.remark ?? '',
        now
      ),
  ]

  return { statements, before, after, warehouseId: wid }
}
