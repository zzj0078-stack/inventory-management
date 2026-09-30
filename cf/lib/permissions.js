/**
 * 权限模块分组（用于前端「角色权限」页面的分组展示）
 * 与 backend/app/core/permissions.py 的 PERMISSION_GROUPS 顺序一致。
 */

export const PERMISSION_GROUPS = [
  ['dashboard', '首页'],
  ['supplier', '供应商'],
  ['customer', '客户'],
  ['product', '商品'],
  ['category', '商品分类'],
  ['purchase', '采购管理'],
  ['purchase_return', '采购退货'],
  ['sales', '销售管理'],
  ['sale_return', '销售退货'],
  ['inventory', '库存查询'],
  ['warehouse', '仓库管理'],
  ['transfer', '库存调拨'],
  ['stockcheck', '库存盘点'],
  ['stocklog', '出入库明细'],
  ['finance', '财务管理'],
  ['report', '报表统计'],
  ['user', '用户管理'],
  ['role', '角色权限'],
  ['log', '操作日志'],
  ['system', '系统维护'],
]

/** module -> label */
export const MODULE_LABELS = Object.fromEntries(PERMISSION_GROUPS)

/** module -> 排序序号 */
export const MODULE_ORDER = Object.fromEntries(PERMISSION_GROUPS.map(([m], i) => [m, i]))
