/**
 * 用户响应体构造 + 用户相关公共逻辑
 *
 * 对应 backend 里两份重复实现：
 *   api/auth.py::_build_user_response      （登录/me，无 permission_count）
 *   api/users.py::_decorate                （列表/详情，有 permission_count）
 * 这里统一成一个超集，前端两处都能用。
 */

import { isoOf } from './time.js'

/** 角色下的权限数量（admin 视为全部权限数） */
export async function rolePermCount(db, role) {
  if (!role) return 0
  if (role.name === 'admin') {
    return db.count('SELECT COUNT(*) AS n FROM permissions')
  }
  return db.count(
    'SELECT COUNT(*) AS n FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = ?',
    role.id
  )
}

/** 把 users 行转成 UserResponse 形状 */
export async function buildUserResponse(db, user) {
  if (!user) return null

  const out = {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    full_name: user.full_name ?? null,
    phone: user.phone ?? null,
    role_id: user.role_id ?? null,
    status: user.status ?? 1,
    created_at: isoOf(user.created_at),
    role_name: '',
    role_label: null,
    permission_count: 0,
    is_admin: false,
  }

  if (!user.role_id) return out

  const role = await db.first('SELECT id, name, description FROM roles WHERE id = ?', user.role_id)
  if (!role) {
    out.role_name = `⚠ 角色#${user.role_id} 已不存在`
    return out
  }

  out.role_name = role.name
  out.role_label = role.description
  out.is_admin = role.name === 'admin'
  out.permission_count = await rolePermCount(db, role)
  return out
}

/** 登录名归一：去首尾空格 */
export function normalizeUsername(username) {
  return String(username ?? '').trim()
}

// 首字符：字母或汉字；其余：字母数字、下划线、点、短横线、汉字
// 与 frontend/src/utils/loginName.js 的 LOGIN_NAME_PATTERN 保持一致
const USERNAME_RE = /^[A-Za-z\u4e00-\u9fa5][A-Za-z0-9_.\-\u4e00-\u9fa5]{0,49}$/

export function isValidUsername(username) {
  return USERNAME_RE.test(String(username ?? ''))
}

export const USERNAME_RULE_TEXT =
  '登录名需以字母或汉字开头，只能包含字母、数字、汉字、下划线、点、短横线，且不超过 50 位'
