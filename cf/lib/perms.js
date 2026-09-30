/**
 * 权限判定
 *
 * 与 backend 的语义对齐：
 *  - admin 角色直接返回通配符 ['*']，后端一律按全权限放行
 *  - 其余角色取 role_permissions 关联的权限码
 *  - 路由声明的 perm 支持字符串（单个）或数组（OR 语义）
 */

/** 取用户的权限集合与角色信息 */
export async function loadPermissions(db, user) {
  const empty = { permissions: [], codes: new Set(), role_name: null, role_label: null, is_admin: false }

  if (!user || !user.role_id) return empty

  const role = await db.first(
    'SELECT id, name, description FROM roles WHERE id = ?',
    user.role_id
  )
  if (!role) return empty

  if (role.name === 'admin') {
    return {
      permissions: ['*'],
      codes: new Set(['*']),
      role_name: role.name,
      role_label: role.description,
      is_admin: true,
    }
  }

  const rows = await db.all(
    `SELECT p.code AS code
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
      WHERE rp.role_id = ?`,
    role.id
  )
  const permissions = rows.map((r) => r.code)

  return {
    permissions,
    codes: new Set(permissions),
    role_name: role.name,
    role_label: role.description,
    is_admin: false,
  }
}

/**
 * 权限校验
 * @param {Set<string>} codes    用户权限码集合
 * @param {string|string[]|null} required 路由要求的权限（数组为 OR）
 */
export function hasPerm(codes, required) {
  if (!required) return true
  if (!codes) return false
  if (codes.has('*')) return true

  const list = Array.isArray(required) ? required : [required]
  return list.some((c) => codes.has(c))
}

/** 生成 403 提示文案 */
export function needText(required) {
  const list = Array.isArray(required) ? required : [required]
  return `权限不足，需要：${list.join(' 或 ')}`
}
