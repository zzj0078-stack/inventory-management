/**
 * v-permission 指令：无权限时隐藏元素
 *
 * 用法：
 *   <el-button v-permission="'purchase:add'">新增</el-button>
 *   <el-button v-permission="['purchase:approve','purchase:receive']">处理</el-button>
 *
 * 数组表示「满足任一即可」。
 *
 * 采用 display:none 而非移除节点：
 *   - 可与 v-if 安全共存（移除节点后 v-if 切换会因节点已被摘除而报错）
 *   - 真正的安全边界在后端权限矩阵（/api 请求会被校验），前端仅做 UX 收敛
 */
import { useUserStore } from '../store/user'

function allowed(value) {
  if (!value) return true
  const store = useUserStore()
  const codes = Array.isArray(value) ? value : [value]
  return codes.some(c => store.hasPermission(c))
}

function apply(el, binding) {
  if (allowed(binding.value)) {
    el.style.removeProperty('display')
  } else {
    el.style.display = 'none'
  }
}

export const permissionDirective = {
  mounted: apply,
  updated: apply
}

export function setupPermission(app) {
  app.directive('permission', permissionDirective)
}
