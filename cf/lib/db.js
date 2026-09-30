/**
 * D1 访问封装
 *
 * D1 的 prepare/bind 对 undefined 会报错，这里统一归一为 null；
 * 布尔归一为 1/0（SQLite 没有布尔类型，与 Python 端 Integer 列一致）。
 *
 * ⚠️ D1 硬限制（官方文档）：
 *   - **每个查询最多 100 个绑定参数** —— 超出报 `too many SQL variables`
 *   - 每个 Worker 调用最多 1000 次查询（付费）/ **50 次（免费）**
 *   - 单条 SQL 语句最长 100 KB；单次执行最长 30 秒
 *   批处理里**每条语句各自**受这些限制约束。
 *   所以任何 `id IN (?,?,...)` 都必须分块，见下面的 allInChunks()。
 */

/** 单条 IN 语句里放多少个参数。官方上限 100，取 50 给同一语句里的其它条件留余量 */
export const IN_CHUNK = 50

/** 把数组切成若干块 */
export function chunk(arr, size = IN_CHUNK) {
  const list = Array.isArray(arr) ? arr : []
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * 分块执行 `... IN (?,?,...)` 查询并合并结果，规避 D1 的 100 参数上限。
 *
 * 用法：
 *   const rows = await allInChunks(db, orderIds, (ph) =>
 *     `SELECT * FROM sales_items WHERE order_id IN (${ph})`)
 *
 * 注意：分块会增加**查询次数**，而免费计划每次调用只有 50 次查询额度。
 * 数据量可能很大时（比如报表），优先考虑改成 JOIN 而不是分块 IN。
 */
export async function allInChunks(db, ids, buildSql) {
  const list = Array.isArray(ids) ? ids : []
  if (!list.length) return []
  const out = []
  for (const part of chunk(list)) {
    const ph = part.map(() => '?').join(',')
    out.push(...(await db.all(buildSql(ph), ...part)))
  }
  return out
}

/**
 * 多行 INSERT：把 N 行合并成 ceil(N / 每语句行数) 条语句。
 *
 * 为什么需要：D1 限制**每个 Worker 调用的查询次数**（免费 50 / 付费 1000）。
 * 逐行 INSERT 在几百行时必然超（盘点建底稿 500 个商品 = 500 条语句）。
 * 合并成多行 VALUES 后，语句数降到约 1/10 —— 注意这**不会**减少
 * rows_written（按行计费），减少的是查询次数。
 *
 * 每行参数个数 = columns.length，按 100 参数上限反推每语句行数。
 *
 * @returns {Array} 可直接交给 db.batch() 的预处理语句数组
 */
export function multiRowInsert(db, table, columns, rows) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return []

  const perRow = columns.length
  const rowsPerStmt = Math.max(1, Math.floor(100 / perRow))
  const collist = columns.map((c) => `"${c}"`).join(', ')
  const stmts = []

  for (const part of chunk(list, rowsPerStmt)) {
    const tuples = part.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
    const flat = []
    for (const r of part) {
      if (r.length !== perRow) {
        throw new Error(`multiRowInsert(${table}): 行长度 ${r.length} ≠ 列数 ${perRow}`)
      }
      flat.push(...r)
    }
    stmts.push(db.raw.prepare(`INSERT INTO "${table}" (${collist}) VALUES ${tuples}`).bind(...flat))
  }

  return stmts
}

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

  /**
   * 本请求的 D1 用量累计。
   * D1 每次查询都会在 meta 里回报 rows_read / rows_written，这里累加起来，
   * 由入口作为响应头返回 —— 这样「这个接口花了多少次查询、写了多少行」
   * 是可观测的，而不是靠猜。
   */
  const usage = { queries: 0, read: 0, written: 0 }

  const track = (res) => {
    usage.queries += 1
    const m = res && res.meta
    if (m) {
      usage.read += Number(m.rows_read || 0)
      usage.written += Number(m.rows_written || 0)
    }
    return res
  }

  return {
    raw: DB,
    usage,

    /** 返回行数组 */
    async all(sql, ...params) {
      const res = track(await bind(sql, params).all())
      return (res && res.results) || []
    },

    /** 返回第一行或 null */
    async first(sql, ...params) {
      const row = await bind(sql, params).first()
      return row === undefined ? null : row
    },

    /**
     * 只取一个标量值。
     * 走 all() 而不是 first()，才能拿到 meta（first() 不返回 meta）。
     * 聚合与 count 本来就只返回一行，代价可忽略。
     */
    async scalar(sql, ...params) {
      const res = track(await bind(sql, params).all())
      const rows = (res && res.results) || []
      if (!rows.length) return null
      const keys = Object.keys(rows[0])
      return keys.length ? rows[0][keys[0]] : null
    },

    /** 写入，返回 D1 结果（含 meta.last_row_id / meta.changes） */
    async run(sql, ...params) {
      return track(await bind(sql, params).run())
    },

    /** 写入并取回新插入行的 id */
    async insert(sql, ...params) {
      const res = track(await bind(sql, params).run())
      return res && res.meta ? res.meta.last_row_id : null
    },

    /** 计数 */
    async count(sql, ...params) {
      const n = await this.scalar(sql, ...params)
      return Number(n) || 0
    },

    /** 批量（D1 batch 是原子的）。结果数组里每个元素各带 meta，逐个累加 */
    async batch(statements) {
      const results = await DB.batch(statements)
      const arr = Array.isArray(results) ? results : [results]
      for (const r of arr) track(r)
      return results
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
