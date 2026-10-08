/**
 * 移动端 API 层
 *
 * 刻意**不复用** src/api/modules.js —— 那个文件依赖 src/api/index.js，
 * 而后者 import 了 Element Plus 和桌面端 router。移动端如果复用它，
 * 就会把 1.2 MB 的桌面组件库一起打进手机包。
 *
 * 这里只封装移动端真正会用到的那部分接口（约 30 个），
 * 路径与后端完全一致；错误提示用移动端自己的轻量 toast。
 */
import axios from 'axios'
import { toast } from './store'

export const TOKEN_KEY = 'token'

const client = axios.create({
  baseURL: '/api',
  timeout: 20000,
})

// ---------------- 请求：带上 token ----------------
client.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** 把各种错误统一成一句人话 */
function friendlyError(error) {
  const resp = error.response
  if (!resp) {
    if (error.code === 'ECONNABORTED') return '请求超时，请检查网络'
    return '网络不可用，请检查网络连接'
  }

  const detail = resp.data && resp.data.detail
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg || '').filter(Boolean).join('；') || '参数校验失败'
  }
  if (typeof detail === 'string' && detail) return detail

  if (resp.status === 401) return '登录已过期，请重新登录'
  if (resp.status === 403) return '没有权限执行此操作'
  if (resp.status === 404) return '接口不存在'
  if (resp.status === 500) return '服务器内部错误'
  return `请求失败（${resp.status}）`
}

/** 401 时统一登出，交给路由守卫跳登录页 */
let onUnauthorized = null
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

client.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const status = error.response && error.response.status
    if (status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      if (onUnauthorized) onUnauthorized()
    }
    const message = friendlyError(error)
    error.friendlyMessage = message
    // 403 交给页面自己决定怎么说更贴切（有些页面需要更具体的提示）
    if (status !== 403) toast.error(message)
    return Promise.reject(error)
  }
)

/** 给页面用：拿错误提示文案 */
export function errMsg(e, fallback = '操作失败') {
  return (e && e.friendlyMessage) || fallback
}

// ---------------- 接口封装 ----------------

export const api = {
  // 认证
  login: (data) => client.post('/auth/login', data),
  me: () => client.get('/auth/me'),
  myPermissions: () => client.get('/auth/my-permissions'),
  changePassword: (data) => client.post('/auth/change-password', data),

  // 看板 / 日报
  dashboard: () => client.get('/ext/dashboard'),
  salesDaily: (days = 7) => client.get('/ext/sales-daily', { params: { days } }),

  // 商品 / 库存
  products: (params) => client.get('/products', { params }),
  product: (id) => client.get(`/products/${id}`),
  categories: () => client.get('/products/categories'),
  inventory: (params) => client.get('/inventory', { params }),
  warehouses: () => client.get('/inventory/warehouses'),
  stockCheck: () => client.get('/inventory/stock-check'),

  // 客户 / 供应商
  customers: (params) => client.get('/customers', { params }),
  customerOutstanding: (id) => client.get(`/customers/${id}/outstanding`),
  suppliers: (params) => client.get('/suppliers', { params }),

  // 销售单
  salesOrders: (params) => client.get('/sales', { params }),
  salesOrder: (id) => client.get(`/sales/${id}`),
  createSalesOrder: (data) => client.post('/sales', data),
  approveSalesOrder: (id) => client.put(`/sales/${id}/approve`),
  shipSalesOrder: (id, data) => client.put(`/sales/${id}/ship`, data),

  // 采购单（开单 + 仓库收货用）
  purchaseOrders: (params) => client.get('/purchase', { params }),
  purchaseOrder: (id) => client.get(`/purchase/${id}`),
  createPurchaseOrder: (data) => client.post('/purchase', data),
  approvePurchaseOrder: (id) => client.put(`/purchase/${id}/approve`),
  receivePurchaseOrder: (id, data) => client.put(`/purchase/${id}/receive`, data),

  // 收付款
  payments: (params) => client.get('/ext/payments', { params }),
  createPayment: (data) => client.post('/ext/payments', data),
  receivables: () => client.get('/ext/receivables'),

  // 报表（老板界面用）
  salesReport: (params) => client.get('/ext/reports/sales', { params }),
  purchaseReport: (params) => client.get('/ext/reports/purchase', { params }),
  profitReport: (params) => client.get('/ext/reports/profit', { params }),
  inventoryReport: () => client.get('/ext/reports/inventory'),

  // 出入库明细
  stockLogs: (params) => client.get('/ext/stock-logs', { params }),
}

export default client
