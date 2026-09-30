/**
 * D1 访问封装
 *
 * D1 的 prepare/bind 对 undefined 会报错，这里统一归一为 null；
 * 布尔归一为 1/0（SQLite 没有布尔类型，与 Python 端 Integer 列一致）。
 */

function norm(v) {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' && !Number.isFinite(v)) return null
  return v
}

export function makeDb(env) {
  const DB = env && env.DB
  if (!DB) throw new Error('D1 绑定 DB 未配置（检查 wrangler.toml）')

  const bind = (sql, params) => DB.prepare(sql).bind(...params.map(norm))

  return {
    raw: DB,

    /** 返回行数组 */
    async all(sql, ...params) {
      const res = await bind(sql, params).all()
      return (res && res.results) || []
    },

    /** 返回第一行或 null */
    async first(sql, ...params) {
      const row = await bind(sql, params).first()
      return row === undefined ? null : row
    },

    /** 只取一个标量值 */
    async scalar(sql, ...params) {
      const row = await bind(sql, params).first()
      if (!row) return null
      const keys = Object.keys(row)
      return keys.length ? row[keys[0]] : null
    },

    /** 写入，返回 D1 结果（含 meta.last_row_id / meta.changes） */
    run(sql, ...params) {
      return bind(sql, params).run()
    },

    /** 写入并取回新插入行的 id */
    async insert(sql, ...params) {
      const res = await bind(sql, params).run()
      return res && res.meta ? res.meta.last_row_id : null
    },

    /** 计数 */
    async count(sql, ...params) {
      const n = await this.scalar(sql, ...params)
      return Number(n) || 0
    },

    /** 批量（D1 batch 是原子的） */
    batch(statements) {
      return DB.batch(statements)
    },

    prepare: bind,
  }
}

/**
 * 把 { a: 1, b: null } 展开为 SET 片段
 * 用于部分更新（对应 FastAPI 的 exclude_unset）
 */
export function buildUpdate(data, allowed) {
  const sets = []
  const params = []
  for (const [key, value] of Object.entries(data)) {
    if (allowed && !allowed.includes(key)) continue
    sets.push(`"${key}" = ?`)
    params.push(value)
  }
  return { sets, params }
}
