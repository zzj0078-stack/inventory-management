/**
 * 移动端路由
 *
 * 全部挂在 /m/ 下；Cloudflare Pages 用 _redirects 把 /m/* 回退到 mobile.html。
 * 与桌面端是两个独立 SPA，互不影响。
 */
import { createRouter, createWebHistory } from 'vue-router'
import { session, clearSession, isBossRole, isBossView, applyDefaultView } from './store'
import { api, setUnauthorizedHandler } from './api'

const routes = [
  {
    path: '/m/login',
    name: 'login',
    component: () => import('./views/Login.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/m',
    component: () => import('./views/Shell.vue'),
    children: [
      // ---- 员工界面 ----
      { path: '', name: 'home', component: () => import('./views/Home.vue'), meta: { title: '工作台', tab: true, staffTab: true } },
      { path: 'stock', name: 'stock', component: () => import('./views/Stock.vue'), meta: { title: '库存价格', tab: true, staffTab: true } },
      { path: 'sales', name: 'sales', component: () => import('./views/Sales.vue'), meta: { title: '销售单', tab: true, staffTab: true } },
      { path: 'purchase', name: 'purchase', component: () => import('./views/Purchase.vue'), meta: { title: '采购单', tab: true, staffTab: true } },

      // ---- 老板界面 ----
      { path: 'boss', name: 'bossHome', component: () => import('./views/boss/Dashboard.vue'), meta: { title: '经营看板', tab: true, boss: true } },
      { path: 'boss/approve', name: 'bossApprove', component: () => import('./views/boss/Approve.vue'), meta: { title: '待我审核', tab: true, boss: true } },
      { path: 'boss/reports', name: 'bossReports', component: () => import('./views/boss/Reports.vue'), meta: { title: '经营报表', tab: true, boss: true } },
      { path: 'boss/debts', name: 'bossDebts', component: () => import('./views/boss/Debts.vue'), meta: { title: '欠款排行', boss: true } },

      // ---- 两端共用 ----
      { path: 'me', name: 'me', component: () => import('./views/Me.vue'), meta: { title: '我的', tab: true } },

      { path: 'sales/new', name: 'saleNew', component: () => import('./views/SaleNew.vue'), meta: { title: '开销售单' } },
      { path: 'sales/:id', name: 'saleDetail', component: () => import('./views/SaleDetail.vue'), meta: { title: '销售单详情' } },

      // purchase/receive 必须排在 purchase/:id 之前，否则 'receive' 会被当成 id 匹配掉。
      // tab: true  → 保留底部导航（它是「采购」Tab 下的页面）
      // back: true → 同时保留返回按钮（它是从采购单列表点进来的二级页）
      { path: 'purchase/receive', name: 'purchaseReceive', component: () => import('./views/PurchaseReceive.vue'), meta: { title: '采购收货', tab: true, back: true, staffTab: true } },
      { path: 'purchase/:id', name: 'purchaseDetail', component: () => import('./views/PurchaseDetail.vue'), meta: { title: '采购单详情' } },

      { path: 'customers', name: 'customers', component: () => import('./views/Customers.vue'), meta: { title: '客户欠款' } },
      { path: 'pay/new', name: 'payNew', component: () => import('./views/PayNew.vue'), meta: { title: '登记收款' } },
      { path: 'logs', name: 'logs', component: () => import('./views/StockLog.vue'), meta: { title: '出入库明细' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/m' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

/** 401 时清态并回登录页（api.js 的拦截器会调用） */
setUnauthorizedHandler(() => {
  clearSession()
  if (router.currentRoute.value.name !== 'login') {
    router.replace({ name: 'login' })
  }
})

/** 拉取用户与权限，失败则视为登录失效 */
export async function loadSession() {
  if (!session.token) return false
  if (session.state === '已加载') return true
  session.state = '加载中'
  try {
    const [me, perms] = await Promise.all([api.me(), api.myPermissions()])
    session.user = me
    session.permissions = (perms && perms.permissions) || []
    session.roleName = perms && perms.role_name
    session.state = '已加载'
    // 角色已知了，落定界面模式（老板默认老板界面，其余强制员工界面）
    applyDefaultView()
    return true
  } catch {
    clearSession()
    return false
  }
}

/** 进入 App 的落地页：老板 → 经营看板，员工 → 工作台 */
function landing() {
  return isBossView.value ? { name: 'bossHome' } : { name: 'home' }
}

router.beforeEach(async (to) => {
  if (to.meta.public) {
    // 已登录还去登录页 → 回落地页
    if (session.token) {
      const ok = await loadSession()
      if (ok) return landing()
    }
    return true
  }

  if (!session.token) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  const ok = await loadSession()
  if (!ok) return { name: 'login', query: { redirect: to.fullPath } }

  // 老板界面下「工作台」就是经营看板
  if (to.name === 'home' && isBossView.value) return { name: 'bossHome' }

  // 老板专属页面：员工访问一律回自己的落地页
  if (to.meta.boss && !isBossRole.value) return landing()

  return true
})

router.afterEach((to) => {
  const t = to.meta && to.meta.title
  document.title = t ? `${t} · 进销存` : '进销存 · 移动端'
})

export default router
