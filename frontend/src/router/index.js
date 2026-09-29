import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { public: true } },
  {
    path: '/', component: () => import('../views/Layout.vue'), redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'Dashboard', component: () => import('../views/Dashboard.vue'), meta: { perm: 'dashboard:view' } },

      { path: 'suppliers', name: 'Suppliers', component: () => import('../views/Supplier.vue'), meta: { perm: 'supplier:view' } },
      { path: 'customers', name: 'Customers', component: () => import('../views/Customer.vue'), meta: { perm: 'customer:view' } },
      { path: 'products', name: 'Products', component: () => import('../views/Product.vue'), meta: { perm: 'product:view' } },

      { path: 'purchase', name: 'Purchase', component: () => import('../views/Purchase.vue'), meta: { perm: 'purchase:view' } },
      { path: 'purchase-return', name: 'PurchaseReturn', component: () => import('../views/PurchaseReturn.vue'), meta: { perm: 'purchase_return:view' } },
      { path: 'sales', name: 'Sales', component: () => import('../views/Sales.vue'), meta: { perm: 'sales:view' } },
      { path: 'sale-return', name: 'SaleReturn', component: () => import('../views/SaleReturn.vue'), meta: { perm: 'sale_return:view' } },

      { path: 'inventory', name: 'Inventory', component: () => import('../views/Inventory.vue'), meta: { perm: 'inventory:view' } },
      { path: 'warehouses', name: 'Warehouses', component: () => import('../views/Warehouse.vue'), meta: { perm: 'warehouse:view' } },
      { path: 'stock-transfer', name: 'StockTransfer', component: () => import('../views/StockTransfer.vue'), meta: { perm: 'transfer:view' } },
      { path: 'stock-check', name: 'StockCheck', component: () => import('../views/StockCheck.vue'), meta: { perm: 'stockcheck:view' } },
      { path: 'stock-log', name: 'StockLog', component: () => import('../views/StockLog.vue'), meta: { perm: 'stocklog:view' } },

      { path: 'payment', name: 'Payment', component: () => import('../views/Payment.vue'), meta: { perm: 'finance:view' } },
      { path: 'report', name: 'Report', component: () => import('../views/Report.vue'), meta: { perm: 'report:view' } },

      { path: 'users', name: 'Users', component: () => import('../views/User.vue'), meta: { perm: 'user:view' } },
      { path: 'roles', name: 'Roles', component: () => import('../views/Role.vue'), meta: { perm: 'role:view' } },
      { path: 'logs', name: 'Logs', component: () => import('../views/OperationLog.vue'), meta: { perm: 'log:view' } },
      { path: 'health', name: 'HealthCheck', component: () => import('../views/HealthCheck.vue'), meta: { perm: 'system:check' } },
      { path: 'print', name: 'Print', component: () => import('../views/PrintTemplate.vue'), meta: { perm: 'system:print' } },
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to, from, next) => {
  // 登录页
  if (to.meta?.public) return next()

  const token = localStorage.getItem('token')
  if (!token) return next('/login')

  const need = to.meta?.perm
  if (!need) return next()

  // 动态引入，避免 router 初始化时 Pinia 尚未安装
  const { useUserStore } = await import('../store/user')
  const store = useUserStore()

  // 刷新页面时权限尚未加载，先补齐
  if (!store.permLoaded) {
    await store.fetchUserInfo()
  }

  if (!store.hasPermission(need)) {
    ElMessage.error({ message: '无权访问该页面', duration: 3000 })
    // 已在该页则放行，避免死循环
    if (from.path === to.path || !from.matched.length) return next('/dashboard')
    return next(false)
  }

  next()
})

export default router
