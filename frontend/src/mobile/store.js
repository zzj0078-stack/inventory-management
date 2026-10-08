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

// ---------------- 安装到主屏幕 ----------------

const INSTALL_KEY = 'm_install_dismissed_v1'

/**
 * 安装引导状态。
 *
 * 为什么需要它：`beforeinstallprompt` 事件必须由页面自己消费 ——
 * 浏览器只会「通知」，不会主动弹窗。桌面端 index.html 里有提示条，
 * 移动端原来什么都没做，所以手机上永远不弹。
 *
 * 注意 iOS：Safari **从不**触发 beforeinstallprompt，只能显示图文指引
 * （分享 → 添加到主屏幕）。这是苹果的限制，不是代码问题。
 */
export const install = reactive({
  /** 浏览器已确认可安装（beforeinstallprompt 已触发） */
  canPrompt: false,
  /** 已处于独立窗口（说明已安装） */
  installed: false,
  /** 是否 iOS/iPadOS（走图文指引） */
  isIOS: false,
  /** 引导条是否显示 */
  visible: false,
})

let deferredPrompt = null

/** 是否已处于「独立窗口」模式，即已经装好并从主屏幕打开 */
export function detectStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function detectIOS() {
  const ua = navigator.userAgent || ''
  // 1) 经典 iOS UA
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // 2) iPadOS 13+ 的 UA 伪装成 macOS，靠触摸点数区分
  if (ua.includes('Macintosh') && navigator.maxTouchPoints > 1) return true
  // 3) 兜底：Safari 存在但不存在 Chrome/Firefox/Edge 的安卓特征，
  //    且 UA 里带 Safari —— 用于个别 UA 被改写的环境
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Android|Firefox|Edg/.test(ua)
  return isSafari
}

function dismissed() {
  try {
    return localStorage.getItem(INSTALL_KEY) === '1'
  } catch {
    return false
  }
}

function markDismissed() {
  try {
    localStorage.setItem(INSTALL_KEY, '1')
  } catch {
    /* 隐私模式下不可用，忽略 */
  }
}

/** 由 main.js 调用：初始化状态并接管浏览器事件 */
export function setupInstall() {
  install.installed = detectStandalone()
  install.isIOS = detectIOS()

  // 已经装了就不用再引导
  if (install.installed) return

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // 阻止 Chrome 自带 mini-infobar，改用我们自己的引导
    deferredPrompt = e
    install.canPrompt = true
    // 用户明确拒绝过就不再打扰。
    // 注意：Chrome 每次加载都可能自行派发这个事件（实测确实会），
    // 所以这里必须靠 dismissed 标记挡住，否则用户每进一次页面就被弹一次。
    if (!dismissed()) install.visible = true
  })

  window.addEventListener('appinstalled', () => {
    install.installed = true
    install.canPrompt = false
    install.visible = false
    deferredPrompt = null
    markDismissed()
  })
}

/** iOS 上没有 beforeinstallprompt，但同样可以引导用户手动添加 */
export function canOfferInstall() {
  if (install.installed) return false
  return install.canPrompt || install.isIOS
}

/** 用户主动点了「安装」（「我的」页入口）——即使是 iOS 也要给出指引 */
export function openInstallGuide() {
  if (install.installed) return
  install.visible = true
}

/**
 * 点引导条上的「安装」。
 * 安卓：调 prompt() 弹系统安装框。
 * iOS：没有 prompt，调用方应改为展示图文步骤。
 *
 * ⚠️ 一定要有超时兜底：headless / 自动化环境下 userChoice 可能**永不 resolve**
 * （系统安装框不会真的出现），若直接 await 就会把引导条永远卡在屏幕上。
 */
export async function doInstall() {
  if (!deferredPrompt) {
    // iOS，或浏览器还没就绪 —— 交给调用方展示指引
    install.visible = false
    return { outcome: 'unavailable' }
  }

  // 先把 UI 收起来，别让用户盯着一个不动的弹层
  const dp = deferredPrompt
  deferredPrompt = null
  install.canPrompt = false
  install.visible = false

  try {
    dp.prompt()
    const choice = await Promise.race([
      dp.userChoice,
      // 3 秒还没结果就按「已处理」收场，引导条已经关了，用户可自行从系统提示完成
      new Promise((resolve) => setTimeout(() => resolve({ outcome: 'unknown' }), 3000)),
    ])
    if (choice && choice.outcome === 'accepted') {
      install.installed = true
      markDismissed()
    }
    return choice || { outcome: 'unknown' }
  } catch {
    // prompt() 在非用户手势等情况下会抛错，不能让它卡住 UI
    return { outcome: 'error' }
  }
}

/** 关闭引导条（并记住，不再自动弹） */
export function dismissInstall() {
  install.visible = false
  markDismissed()
}
