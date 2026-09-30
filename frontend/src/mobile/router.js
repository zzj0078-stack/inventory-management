/**
 * 移动端路由
 *
 * 全部挂在 /m/ 下；Cloudflare Pages 用 _redirects 把 /m/* 回退到 mobile.html。
 * 与桌面端是两个独立 SPA，互不影响。
 */
import { createRouter, createWebHistory } from 'vue-router'
import { session, clearSession } from './store'
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
      { path: '', name: 'home', component: () => import('./views/Home.vue'), meta: { title: '工作台', tab: true } },
      { path: 'stock', name: 'stock', component: () => import('./views/Stock.vue'), meta: { title: '库存价格', tab: true } },
      { path: 'sales', name: 'sales', component: () => import('./views/Sales.vue'), meta: { title: '销售单', tab: true } },
      { path: 'me', name: 'me', component: () => import('./views/Me.vue'), meta: { title: '我的', tab: true } },

      { path: 'sales/new', name: 'saleNew', component: () => import('./views/SaleNew.vue'), meta: { title: '开销售单' } },
      { path: 'sales/:id', name: 'saleDetail', component: () => import('./views/SaleDetail.vue'), meta: { title: '销售单详情' } },

      { path: 'purchase', name: 'purchase', component: () => import('./views/Purchase.vue'), meta: { title: '采购收货' } },
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
    return true
  } catch {
    clearSession()
    return false
  }
}

router.beforeEach(async (to) => {
  if (to.meta.public) {
    // 已登录还去登录页 → 回工作台
    if (session.token) {
      const ok = await loadSession()
      if (ok) return { name: 'home' }
    }
    return true
  }

  if (!session.token) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  const ok = await loadSession()
  if (!ok) return { name: 'login', query: { redirect: to.fullPath } }

  return true
})

router.afterEach((to) => {
  const t = to.meta && to.meta.title
  document.title = t ? `${t} · 进销存` : '进销存 · 移动端'
})

export default router
