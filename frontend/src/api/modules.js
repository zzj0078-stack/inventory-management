import api from './index'

// 认证
export const login = (data) => api.post('/auth/login', data)
export const logoutApi = () => api.post('/auth/logout')
export const getMe = () => api.get('/auth/me')

// 用户
export const getUsers = (params) => api.get('/users', { params })
export const createUser = (data) => api.post('/users', data)
export const updateUser = (id, data) => api.put(`/users/${id}`, data)
export const deleteUser = (id) => api.delete(`/users/${id}`)

// 供应商
export const getSuppliers = (params) => api.get('/suppliers', { params })
export const createSupplier = (data) => api.post('/suppliers', data)
export const updateSupplier = (id, data) => api.put(`/suppliers/${id}`, data)
export const deleteSupplier = (id) => api.delete(`/suppliers/${id}`)
export const getSupplierOutstanding = (id) => api.get(`/suppliers/${id}/outstanding`)

// 客户
export const getCustomers = (params) => api.get('/customers', { params })
export const createCustomer = (data) => api.post('/customers', data)
export const updateCustomer = (id, data) => api.put(`/customers/${id}`, data)
export const deleteCustomer = (id) => api.delete(`/customers/${id}`)
export const getCustomerOutstanding = (id) => api.get(`/customers/${id}/outstanding`)

// 商品
export const getProducts = (params) => api.get('/products', { params })
export const createProduct = (data) => api.post('/products', data)
export const updateProduct = (id, data) => api.put(`/products/${id}`, data)
export const deleteProduct = (id) => api.delete(`/products/${id}`)
export const getCategories = () => api.get('/products/categories')
export const createCategory = (data) => api.post('/products/categories', data)
export const updateCategory = (id, data) => api.put(`/products/categories/${id}`, data)
export const deleteCategory = (id) => api.delete(`/products/categories/${id}`)
export const uploadProductImage = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post('/products/upload-image', fd, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

// 采购
export const getPurchaseOrders = (params) => api.get('/purchase', { params })
export const createPurchaseOrder = (data) => api.post('/purchase', data)
export const getPurchaseOrder = (id) => api.get(`/purchase/${id}`)
export const approvePurchaseOrder = (id) => api.put(`/purchase/${id}/approve`)
export const receivePurchaseOrder = (id, data) => api.put(`/purchase/${id}/receive`, data)
export const cancelPurchaseOrder = (id) => api.put(`/purchase/${id}/cancel`)
export const updatePurchaseOrder = (id, data) => api.put(`/purchase/${id}`, data)
export const deletePurchaseOrder = (id) => api.delete(`/purchase/${id}`)

// 销售
export const getSalesOrders = (params) => api.get('/sales', { params })
export const createSalesOrder = (data) => api.post('/sales', data)
export const getSalesOrder = (id) => api.get(`/sales/${id}`)
export const approveSalesOrder = (id) => api.put(`/sales/${id}/approve`)
export const shipSalesOrder = (id, data) => api.put(`/sales/${id}/ship`, data)
export const cancelSalesOrder = (id) => api.put(`/sales/${id}/cancel`)
export const updateSalesOrder = (id, data) => api.put(`/sales/${id}`, data)
export const deleteSalesOrder = (id) => api.delete(`/sales/${id}`)

// 库存
export const getInventory = (params) => api.get('/inventory', { params })
export const getWarehouses = () => api.get('/inventory/warehouses')
export const createWarehouse = (data) => api.post('/inventory/warehouses', data)
export const updateWarehouse = (id, data) => api.put(`/inventory/warehouses/${id}`, data)
export const deleteWarehouse = (id) => api.delete(`/inventory/warehouses/${id}`)
export const stockCheck = () => api.get('/inventory/stock-check')

// 权限与角色
export const changePassword = (data) => api.post('/auth/change-password', data)
export const resetPassword = (data) => api.post('/auth/reset-password', data)
export const getMyPermissions = () => api.get('/auth/my-permissions')
export const getPermissions = () => api.get('/auth/permissions')
export const getRoles = () => api.get('/auth/roles')
export const createRole = (data) => api.post('/auth/roles', data)
export const updateRole = (id, data) => api.put(`/auth/roles/${id}`, data)
export const deleteRole = (id) => api.delete(`/auth/roles/${id}`)

// 销售退货
export const getSaleReturns = (params) => api.get('/ext/sale-returns', { params })
export const getSaleReturn = (id) => api.get(`/ext/sale-returns/${id}`)
export const getSaleReturnAvailable = (orderId) => api.get(`/ext/sale-returns/available/${orderId}`)
export const getSaleReturnable = (params) => api.get('/ext/sale-returns/returnable', { params })
export const createSaleReturn = (data) => api.post('/ext/sale-returns', data)
export const approveSaleReturn = (id) => api.put(`/ext/sale-returns/${id}/approve`)
export const receiveSaleReturn = (id) => api.put(`/ext/sale-returns/${id}/receive`)
export const cancelSaleReturn = (id) => api.put(`/ext/sale-returns/${id}/cancel`)

// 采购退货
export const getPurchaseReturns = (params) => api.get('/ext/purchase-returns', { params })
export const getPurchaseReturn = (id) => api.get(`/ext/purchase-returns/${id}`)
export const getPurchaseReturnAvailable = (orderId) => api.get(`/ext/purchase-returns/available/${orderId}`)
export const getPurchaseReturnable = (params) => api.get('/ext/purchase-returns/returnable', { params })
export const createPurchaseReturn = (data) => api.post('/ext/purchase-returns', data)
export const approvePurchaseReturn = (id) => api.put(`/ext/purchase-returns/${id}/approve`)
export const shipPurchaseReturn = (id) => api.put(`/ext/purchase-returns/${id}/ship`)
export const cancelPurchaseReturn = (id) => api.put(`/ext/purchase-returns/${id}/cancel`)

// 收付款
export const getPayments = (params) => api.get('/ext/payments', { params })
export const createPayment = (data) => api.post('/ext/payments', data)
export const updatePayment = (id, data) => api.put(`/ext/payments/${id}`, data)
export const deletePayment = (id) => api.delete(`/ext/payments/${id}`)
export const getReceivables = () => api.get('/ext/receivables')
/** 该往来单位未结清的单据（收付款核销用） */
export const getOpenOrders = (params) => api.get('/ext/open-orders', { params })

// 对账单（客户应收 / 供应商应付）
export const getCustomerStatement = (params) => api.get('/ext/statement/customer', { params })
export const getSupplierStatement = (params) => api.get('/ext/statement/supplier', { params })

// 库存明细
export const getStockLogs = (params) => api.get('/ext/stock-logs', { params })
export const getStockLogStat = () => api.get('/ext/stock-logs/stat')
export const initStockLogs = (overwrite = false) => api.post('/ext/stock-logs/init', null, { params: { overwrite } })

// 库存调拨
export const getStockTransfers = (params) => api.get('/ext/stock-transfers', { params })
export const getStockTransfer = (id) => api.get(`/ext/stock-transfers/${id}`)
export const createStockTransfer = (data) => api.post('/ext/stock-transfers', data)
export const approveStockTransfer = (id) => api.put(`/ext/stock-transfers/${id}/approve`)
export const cancelStockTransfer = (id) => api.put(`/ext/stock-transfers/${id}/cancel`)

// 库存盘点
export const getStockChecks = (params) => api.get('/ext/stock-checks', { params })
export const getStockCheck = (id) => api.get(`/ext/stock-checks/${id}`)
export const previewStockCheck = (params) => api.get('/ext/stock-checks/preview', { params })
export const createStockCheck = (data) => api.post('/ext/stock-checks', data)
export const approveStockCheck = (id) => api.put(`/ext/stock-checks/${id}/approve`)
export const cancelStockCheck = (id) => api.put(`/ext/stock-checks/${id}/cancel`)

// 报表
export const getSalesReport = (params) => api.get('/ext/reports/sales', { params })
export const getPurchaseReport = (params) => api.get('/ext/reports/purchase', { params })
export const getProfitReport = (params) => api.get('/ext/reports/profit', { params })

// 操作日志
export const getLogs = (params) => api.get('/ext/logs', { params })

// 首页仪表盘
export const getDashboard = () => api.get('/ext/dashboard')
export const getSalesDaily = (days = 30) => api.get('/ext/sales-daily', { params: { days } })

// 数据自检
export const getHealthCheck = () => api.get('/ext/health-check')
export const fixHealthCheck = () => api.post('/ext/health-check/fix')

// 导出 CSV（带 token 下载）
export const downloadExport = async (kind) => {
  const token = localStorage.getItem('token')
  const res = await fetch(`/api/ext/export/${kind}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  if (!res.ok) throw new Error('导出失败')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${kind}_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
