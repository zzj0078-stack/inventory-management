/**
 * 认证 / 权限 / 角色
 *
 * 对应 backend：
 *   app/api/auth.py           登录 / 退出 / me
 *   app/api/auth_extended.py  改密 / 重置 / 我的权限 / 权限清单 / 角色 CRUD
 */

import { HttpError, bad, notFound, ok, json } from '../lib/http.js'
import { createToken, hashPassword, verifyPassword } from '../lib/crypto.js'
import { nowLocal } from '../lib/time.js'
import { logOp } from '../lib/oplog.js'
import { loadPermissions } from '../lib/perms.js'
import { buildUserResponse } from '../lib/users.js'
import {
  validatePassword,
  RULES_TEXT,
  MIN_LENGTH,
  MAX_LENGTH,
  DEFAULT_RESET_PASSWORD,
} from '../lib/password.js'
import { MODULE_LABELS, MODULE_ORDER } from '../lib/permissions.js'

// ---------------- 登录 / 退出 / me ----------------

async function login(ctx) {
  const { db, body, env, ip } = ctx
  const username = String(body?.username ?? '')
  const password = String(body?.password ?? '')

  if (!username || !password) bad('请输入用户名和密码')

  const user = await db.first('SELECT * FROM users WHERE username = ?', username)

  if (!user) {
    await logOp(db, null, '认证', '登录失败', username, '用户不存在', ip)
    throw new HttpError(401, '用户名或密码错误')
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    await logOp(db, null, '认证', '登录失败', username, '密码错误', ip)
    throw new HttpError(401, '用户名或密码错误')
  }

  if (user.status === 0) {
    await logOp(db, user, '认证', '登录失败', user.username, '账号已禁用', ip)
    throw new HttpError(403, '用户已被禁用')
  }

  const minutes = Number(env.TOKEN_EXPIRE_MINUTES || 480)
  const accessToken = await createToken({ sub: String(user.id) }, ctx.secret, minutes)

  await logOp(db, user, '认证', '登录', user.username, '登录成功', ip)

  const u = await buildUserResponse(db, user)
  return json({ access_token: accessToken, token_type: 'bearer', user: u })
}

async function me(ctx) {
  return json(await buildUserResponse(ctx.db, ctx.user))
}

async function logout(ctx) {
  await logOp(ctx.db, ctx.user, '认证', '退出登录', ctx.user.username, '', ctx.ip)
  return ok('已退出')
}

// ---------------- 我的权限 ----------------

async function myPermissions(ctx) {
  const info = await loadPermissions(ctx.db, ctx.user)
  return json({ permissions: info.permissions, role_name: info.role_name })
}

// ---------------- 改密 / 重置 ----------------

async function changePassword(ctx) {
  const { db, body, user } = ctx
  const oldPassword = String(body?.old_password ?? '')
  const newPassword = String(body?.new_password ?? '')

  if (!(await verifyPassword(oldPassword, user.password_hash))) bad('原密码错误')

  const err = validatePassword(newPassword)
  if (err) bad(err)
  if (newPassword === oldPassword) bad('新密码不能与原密码相同')

  await db.run(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    await hashPassword(newPassword),
    nowLocal(ctx.env),
    user.id
  )
  await logOp(db, user, '认证', '修改密码', user.username)
  return ok('密码修改成功')
}

async function resetPassword(ctx) {
  const { db, body, user } = ctx
  const userId = Number(body?.user_id)
  const newPassword = body?.new_password ? String(body.new_password) : DEFAULT_RESET_PASSWORD

  if (!userId) bad('缺少 user_id')

  const target = await db.first('SELECT id, username FROM users WHERE id = ?', userId)
  if (!target) notFound('用户不存在')

  const err = validatePassword(newPassword)
  if (err) bad(err)

  await db.run(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    await hashPassword(newPassword),
    nowLocal(ctx.env),
    target.id
  )
  await logOp(db, user, '用户管理', '重置密码', target.username)
  return ok(`密码已重置为: ${newPassword}`)
}

// ---------------- 密码规则（免登录） ----------------

async function passwordRules() {
  return json({ rules: RULES_TEXT, min_length: MIN_LENGTH, max_length: MAX_LENGTH })
}

// ---------------- 权限清单 ----------------

async function listPermissions(ctx) {
  const rows = await ctx.db.all('SELECT id, code, name, module FROM permissions')

  const out = rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    module: p.module,
    module_label: MODULE_LABELS[p.module] || p.module,
  }))

  out.sort((a, b) => {
    const oa = MODULE_ORDER[a.module] ?? 999
    const ob = MODULE_ORDER[b.module] ?? 999
    return oa === ob ? a.id - b.id : oa - ob
  })

  return json(out)
}

// ---------------- 角色 ----------------

async function listRoles(ctx) {
  const { db } = ctx
  const roles = await db.all('SELECT id, name, description FROM roles ORDER BY id')
  const links = await db.all('SELECT role_id, permission_id FROM role_permissions')

  const byRole = new Map()
  for (const l of links) {
    if (!byRole.has(l.role_id)) byRole.set(l.role_id, [])
    byRole.get(l.role_id).push(l.permission_id)
  }

  return json(
    roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permission_ids: byRole.get(r.id) || [],
    }))
  )
}

function permissionIdsOf(body) {
  const raw = body?.permission_ids
  if (!Array.isArray(raw)) return []
  return raw.map((x) => Number(x)).filter((x) => Number.isFinite(x))
}

async function createRole(ctx) {
  const { db, body, user } = ctx
  const name = String(body?.name ?? '').trim()
  if (!name) bad('请输入角色名')

  if (await db.first('SELECT id FROM roles WHERE name = ?', name)) bad('角色名已存在')

  const roleId = await db.insert(
    'INSERT INTO roles (name, description, created_at) VALUES (?, ?, ?)',
    name,
    body?.description ?? null,
    nowLocal(ctx.env)
  )

  const ids = permissionIdsOf(body)
  if (ids.length) {
    await db.batch(
      ids.map((pid) =>
        db.raw
          .prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)')
          .bind(roleId, pid)
      )
    )
  }

  await logOp(db, user, '角色管理', '新增角色', name)
  return json({ id: roleId, name, description: body?.description ?? null, permission_ids: ids })
}

async function updateRole(ctx) {
  const { db, body, user, params } = ctx
  const roleId = Number(params.id)

  const role = await db.first('SELECT id, name FROM roles WHERE id = ?', roleId)
  if (!role) notFound('角色不存在')

  const name = String(body?.name ?? '').trim()
  if (!name) bad('请输入角色名')

  if (await db.first('SELECT id FROM roles WHERE name = ? AND id != ?', name, roleId)) {
    bad('角色名已存在')
  }

  await db.run(
    'UPDATE roles SET name = ?, description = ? WHERE id = ?',
    name,
    body?.description ?? null,
    roleId
  )

  const ids = permissionIdsOf(body)
  await db.batch([
    db.raw.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(roleId),
    ...ids.map((pid) =>
      db.raw
        .prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)')
        .bind(roleId, pid)
    ),
  ])

  await logOp(db, user, '角色管理', '编辑角色', name)
  return json({ id: roleId, name, description: body?.description ?? null, permission_ids: ids })
}

async function deleteRole(ctx) {
  const { db, user, params } = ctx
  const roleId = Number(params.id)

  const role = await db.first('SELECT id, name FROM roles WHERE id = ?', roleId)
  if (!role) notFound('角色不存在')

  const used = await db.count('SELECT COUNT(*) AS n FROM users WHERE role_id = ?', roleId)
  if (used > 0) bad(`该角色下有 ${used} 个用户，无法删除`)

  await db.batch([
    db.raw.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(roleId),
    db.raw.prepare('DELETE FROM roles WHERE id = ?').bind(roleId),
  ])

  await logOp(db, user, '角色管理', '删除角色', role.name)
  return ok('删除成功')
}

// ---------------- 路由表 ----------------

export const routes = [
  { method: 'POST', path: /^\/api\/auth\/login$/, public: true, handler: login },
  { method: 'GET', path: /^\/api\/auth\/password-rules$/, public: true, handler: passwordRules },

  { method: 'GET', path: /^\/api\/auth\/me$/, handler: me },
  { method: 'POST', path: /^\/api\/auth\/logout$/, handler: logout },
  { method: 'GET', path: /^\/api\/auth\/my-permissions$/, handler: myPermissions },
  { method: 'POST', path: /^\/api\/auth\/change-password$/, handler: changePassword },

  { method: 'POST', path: /^\/api\/auth\/reset-password$/, perm: 'user:resetpwd', handler: resetPassword },

  { method: 'GET', path: /^\/api\/auth\/permissions$/, perm: ['role:view', 'role:add', 'role:edit'], handler: listPermissions },

  { method: 'GET', path: /^\/api\/auth\/roles$/, perm: ['role:view', 'user:view', 'user:add', 'user:edit'], handler: listRoles },
  { method: 'POST', path: /^\/api\/auth\/roles$/, perm: 'role:add', handler: createRole },
  { method: 'PUT', path: /^\/api\/auth\/roles\/(?<id>\d+)$/, perm: 'role:edit', handler: updateRole },
  { method: 'DELETE', path: /^\/api\/auth\/roles\/(?<id>\d+)$/, perm: 'role:delete', handler: deleteRole },
]
