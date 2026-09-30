/**
 * 销售单
 * 对应 backend/app/api/sales.py（差异全部由 makeOrderRoutes 的配置表达）
 */

import { makeOrderRoutes } from '../lib/orders.js'

export const routes = makeOrderRoutes({
  base: 'sales',
  table: { order: 'sales_orders', item: 'sales_items' },
  prefix: 'SO',

  perm: {
    view: 'sales:view',
    add: 'sales:add',
    edit: 'sales:edit',
    delete: 'sales:delete',
    approve: 'sales:approve',
    act: 'sales:ship',
    cancel: 'sales:cancel',
  },

  doc: '销售单',
  detail: '销售明细',
  module: '销售管理',

  party: {
    fk: 'customer_id',
    table: 'customers',
    respPrefix: 'customer',
    label: '客户',
    none: '（未指定客户）',
  },
  filters: { partyName: 'customer_name' },

  dateField: 'sale_date',
  personField: 'seller',
  extraDateField: 'delivery_date',
  qtyField: 'shipped_quantity',

  act: {
    verb: '发货',
    verbOne: '发',
    donePart: '发货',
    stockWord: '出库',
    route: 'ship',
    log: '销售发货',
    logDone: '销售发货完成',
    typeIn: '',
    typeOut: 'sale_out',
    delta: -1,
    relatedType: 'sale',
  },

  status: { draft: 0, approved: 1, partial: 2, done: 3, closed: 4 },
  statusText: {
    0: '草稿',
    1: '已审核',
    2: '部分发货',
    3: '已发货',
    4: '已关闭',
    5: '部分退货',
    6: '已退货',
  },
})
