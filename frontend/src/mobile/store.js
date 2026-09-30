/**
 * 移动端轻量状态：登录态 + 权限 + 全局提示
 *
 * 不用 Pinia —— 移动端要的是小包体，一个 reactive 对象就够了。
 * localStorage 的 key 与桌面端一致（token），方便同浏览器共用登录态。
 */
import { reactive, computed } from 'vue'

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
