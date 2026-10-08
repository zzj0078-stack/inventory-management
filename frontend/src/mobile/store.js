/**
 * 移动端轻量状态：登录态 + 权限 + 全局提示
 *
 * 不用 Pinia —— 移动端要的是小包体，一个 reactive 对象就够了。
 * localStorage 的 key 与桌面端一致（token），方便同浏览器共用登录态。
 */
import { reactive, computed, ref } from 'vue'

// 刻意不 import './api' —— api.js 要用本文件的 toast，
// 互相 import 会形成循环依赖，而 TOKEN_KEY 在模块顶层就会被读到，会拿到 undefined。
// localStorage 的 key 与桌面端保持一致（token），方便同浏览器共用登录态。
const TOKEN_KEY = 'token'

// ---------------- 登录态 ----------------

export const session = reactive({
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: null,
  /** '未加载' | '加载中' | '已加载' */
  state: '未加载',
  permissions: [],
  roleName: null,
})

/** admin 角色后端返回 ['*']，前端一律按全权限处理 */
export const isAdmin = computed(() => session.permissions.includes('*'))

export function hasPerm(code) {
  if (!code) return true
  if (isAdmin.value) return true
  return session.permissions.includes(code)
}

export function setToken(token) {
  session.token = token || ''
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function clearSession() {
  setToken('')
  session.user = null
  session.permissions = []
  session.roleName = null
  session.state = '未加载'
  // 界面模式一并重置：同一台手机可能换人登录，
  // 上一个人的偏好（尤其「老板界面」）不能留给下一个人。
  // 下次登录时 applyDefaultView() 会按新账号的角色重新落默认值。
  viewMode.value = ''
  localStorage.removeItem(VIEW_KEY)
}

// ---------------- 界面模式：员工 / 老板 ----------------

const VIEW_KEY = 'm_view' // 'boss' | 'staff'；首次为空，按角色落默认

/**
 * 老板角色：admin / manager。
 *
 * 按**角色**判定而不是「有没有某个权限」—— manager 的角色定义就是
 * 「业务全流程 + 审核，无系统管理」，天然是管理层；而 sales/warehouse
 * 这些业务角色即使临时补了某个报表权限，也不该整体变成老板界面。
 * 自定义角色若被授予 `*`（通配），一并按老板处理。
 */
export const isBossRole = computed(() => {
  if (isAdmin.value) return true
  return (session.roleName || '').toLowerCase() === 'manager'
})

/** 用户选择的界面；'' 表示还没选过 */
export const viewMode = ref(localStorage.getItem(VIEW_KEY) || '')

/** 当前是否处于老板界面（非老板角色恒为 false） */
export const isBossView = computed(() => isBossRole.value && viewMode.value === 'boss')

export function setViewMode(mode) {
  // 员工不能切到老板界面
  if (mode === 'boss' && !isBossRole.value) return
  viewMode.value = mode
  localStorage.setItem(VIEW_KEY, mode)
}

/** 会话加载完成后调用：没选过就按角色给默认值；角色不够则强制回员工界面 */
export function applyDefaultView() {
  if (!viewMode.value) {
    viewMode.value = isBossRole.value ? 'boss' : 'staff'
    localStorage.setItem(VIEW_KEY, viewMode.value)
    return
  }
  if (viewMode.value === 'boss' && !isBossRole.value) {
    viewMode.value = 'staff'
    localStorage.setItem(VIEW_KEY, 'staff')
  }
}

// ---------------- 全局提示 ----------------

let toastSeq = 0

export const toasts = reactive([])

function pushToast(type, message, duration = 2400) {
  if (!message) return
  const id = ++toastSeq
  toasts.push({ id, type, message })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, duration)
}

export const toast = {
  success: (m) => pushToast('success', m),
  error: (m) => pushToast('error', m, 4200),
  info: (m) => pushToast('info', m),
}

// ---------------- 底部确认弹层（替代 window.confirm）----------------

export const confirmState = reactive({
  visible: false,
  title: '',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
})

let confirmResolve = null

export function confirmSheet({ title = '确认', message = '', confirmText = '确定', cancelText = '取消', danger = false }) {
  confirmState.visible = true
  confirmState.title = title
  confirmState.message = message
  confirmState.confirmText = confirmText
  confirmState.cancelText = cancelText
  confirmState.danger = danger
  return new Promise((resolve) => {
    confirmResolve = resolve
  })
}

export function resolveConfirm(ok) {
  confirmState.visible = false
  const r = confirmResolve
  confirmResolve = null
  if (r) r(ok)
}
