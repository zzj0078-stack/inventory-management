/**
 * 操作日志
 *
 * 对应 backend/app/core/oplog.py：日志写入失败不能中断业务，但必须可见。
 */

import { nowLocal } from './time.js'

export async function logOp(db, user, module, action, target = '', detail = '', ip = '') {
  try {
    await db.run(
      `INSERT INTO operation_logs
         (user_id, username, module, action, target, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      user ? user.id : null,
      (user && user.username) || 'anonymous',
      module,
      action,
      String(target ?? ''),
      String(detail ?? ''),
      String(ip ?? ''),
      nowLocal()
    )
  } catch (e) {
    console.warn(`[WARN] 操作日志写入失败: ${module}/${action}/${target} -> ${e && e.message}`)
  }
}
