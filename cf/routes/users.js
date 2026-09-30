/**
 * 用户管理
 * 对应 backend/app/api/users.py
 */

import { bad, notFound, ok, json, paginated, paginationOf, intParam, likeArg } from '../lib/http.js'
import { hashPassword } from '../lib/crypto.js'
import { nowLocal } from '../lib/time.js'
import { logOp } from '../lib/oplog.js'
import { validatePassword } from '../lib/password.js'
import {
  buildUserResponse,
  normalizeUsername,
  isValidUsername,
  USERNAME_RULE_TEXT,
} from '../lib/users.js'

/** 邮箱选填：空白归一为 NULL（多条空串会撞唯一索引） */
function cleanEmail(email) {
  if (email === null || email === undefined) return null
  const s = String(email).trim()
  return s || null
}

async function list(ctx) {
  const { db, url } = ctx
  const { page, pageSize, offset } = paginationOf(url)

  const keyword = url.searchParams.get('keyword')
  const roleId = intParam(url.searchParams.get('role_id'))
  const statusRaw = url.searchParams.get('status')
  const status = intParam(statusRaw)

  const where = []
  const params = []

  if (keyword) {
    const k = likeArg(keyword)
    where.push(
      `(username LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')`
    )
    params.push(k, k, k, k)
  }
  if (roleId !== null && roleId !== undefined) {
    where.push('role_id = ?')
    params.push(roleId)
  }
  if (statusRaw !== null && statusRaw !== '' && status !== null) {
    where.push('status = ?')
    params.push(status)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = await db.count(`SELECT COUNT(*) AS n FROM users ${whereSql}`, ...params)
  const rows = await db.all(
    `SELECT * FROM users ${whereSql} ORDER BY id LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset
  )

  const items = []
  for (const u of rows) items.push(await buildUserResponse(db, u))

  return paginated(total, page, pageSize, items)
}

async function get(ctx) {
  const { db, params } = ctx
  const user = await db.first('SELECT * FROM users WHERE id = ?', Number(params.id))
  if (!user) notFound('用户不存在')
  return json(await buildUserResponse(db, user))
}

async function create(ctx) {
  const { db, body, user } = ctx

  const username = normalizeUsername(body?.username)
  if (!username) bad('请输入登录名')
  if (!isValidUsername(username)) bad(USERNAME_RULE_TEXT)

  if (await db.first('SELECT id FROM users WHERE username = ?', username)) bad('用户名已存在')

  const email = cleanEmail(body?.email)
  if (email && (await db.first('SELECT id FROM users WHERE email = ?', email))) {
    bad('邮箱已被使用')
  }

  const roleId = body?.role_id ? Number(body.role_id) : null
  if (!roleId) bad('请为用户指定角色，否则其登录后无任何权限')
  if (!(await db.first('SELECT id FROM roles WHERE id = ?', roleId))) bad('指定的角色不存在')

  const err = validatePassword(body?.password)
  if (err) bad(err)

  const now = nowLocal(ctx.env)
  const id = await db.insert(
    `INSERT INTO users
       (username, email, password_hash, full_name, phone, role_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    username,
    email,
    await hashPassword(String(body.password)),
    body?.full_name ?? null,
    body?.phone ?? null,
    roleId,
    now,
    now
  )

  await logOp(db, user, '用户管理', '新增用户', username, `角色#${roleId}`)

  const created = await db.first('SELECT * FROM users WHERE id = ?', id)
  return json(await buildUserResponse(db, created))
}

async function update(ctx) {
  const { db, body, user, params } = ctx
  const userId = Number(params.id)

  const target = await db.first('SELECT * FROM users WHERE id = ?', userId)
  if (!target) notFound('用户不存在')

  const sets = []
  const values = []

  // 登录名：只在传入且变化时校验
  if (body && Object.prototype.hasOwnProperty.call(body, 'username')) {
    const uname = normalizeUsername(body.username)
    if (uname && uname !== target.username) {
      if (!isValidUsername(uname)) bad(USERNAME_RULE_TEXT)
      if (await db.first('SELECT id FROM users WHERE username = ? AND id != ?', uname, userId)) {
        bad('用户名已存在')
      }
      sets.push('username = ?')
      values.push(uname)
    }
  }

  // 邮箱：显式传 null 可清空
  if (body && Object.prototype.hasOwnProperty.call(body, 'email')) {
    const email = cleanEmail(body.email)
    if (email && email !== target.email) {
      if (await db.first('SELECT id FROM users WHERE email = ? AND id != ?', email, userId)) {
        bad('邮箱已被使用')
      }
    }
    sets.push('email = ?')
    values.push(email)
  }

  // 角色
  if (body && Object.prototype.hasOwnProperty.call(body, 'role_id') && body.role_id) {
    const roleId = Number(body.role_id)
    if (!(await db.first('SELECT id FROM roles WHERE id = ?', roleId))) bad('指定的角色不存在')
    if (target.id === user.id && roleId !== target.role_id) bad('不能修改自己的角色')
    sets.push('role_id = ?')
    values.push(roleId)
  }

  // 不允许禁用自己
  if (target.id === user.id && Number(body?.status) === 0) bad('不能禁用自己的账号')

  // 密码（可选）
  if (body?.password) {
    const err = validatePassword(body.password)
    if (err) bad(err)
    sets.push('password_hash = ?')
    values.push(await hashPassword(String(body.password)))
  }

  // 其余普通字段（undefined 不覆盖；null 视为清空）
  for (const key of ['full_name', 'phone', 'status']) {
    if (body && Object.prototype.hasOwnProperty.call(body, key)) {
      const v = body[key]
      if (v !== undefined) {
        sets.push(`${key} = ?`)
        values.push(v === '' ? null : v)
      }
    }
  }

  if (sets.length) {
    sets.push('updated_at = ?')
    values.push(nowLocal(ctx.env))
    await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...values, userId)
  }

  await logOp(db, user, '用户管理', '编辑用户', target.username)

  const fresh = await db.first('SELECT * FROM users WHERE id = ?', userId)
  return json(await buildUserResponse(db, fresh))
}

async function remove(ctx) {
  const { db, user, params } = ctx
  const userId = Number(params.id)

  const target = await db.first('SELECT id, username FROM users WHERE id = ?', userId)
  if (!target) notFound('用户不存在')

  if (target.id === user.id) bad('不能删除自己的账号')
  if (target.username === 'admin') bad('内置管理员账号不可删除')

  await db.run('DELETE FROM users WHERE id = ?', userId)
  await logOp(db, user, '用户管理', '删除用户', target.username)
  return ok('删除成功')
}

export const routes = [
  { method: 'GET', path: /^\/api\/users$/, perm: 'user:view', handler: list },
  { method: 'POST', path: /^\/api\/users$/, perm: 'user:add', handler: create },
  { method: 'GET', path: /^\/api\/users\/(?<id>\d+)$/, perm: 'user:view', handler: get },
  { method: 'PUT', path: /^\/api\/users\/(?<id>\d+)$/, perm: 'user:edit', handler: update },
  { method: 'DELETE', path: /^\/api\/users\/(?<id>\d+)$/, perm: 'user:delete', handler: remove },
]
