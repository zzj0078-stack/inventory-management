/**
 * 采购单
 * 对应 backend/app/api/purchase.py（差异全部由 makeOrderRoutes 的配置表达）
 */

import { makeOrderRoutes } from '../lib/orders.js'

export const routes = makeOrderRoutes({
  base: 'purchase',
  table: { order: 'purchase_orders', item: 'purchase_items' },
  prefix: 'PO',

  perm: {
    view: 'purchase:view',
    add: 'purchase:add',
    edit: 'purchase:edit',
    delete: 'purchase:delete',
    approve: 'purchase:approve',
    act: 'purchase:receive',
    cancel: 'purchase:cancel',
  },

  doc: '采购单',
  detail: '采购明细',
  module: '采购管理',

  party: {
    fk: 'supplier_id',
    table: 'suppliers',
    respPrefix: 'supplier',
    label: '供应商',
    none: '（未指定供应商）',
  },
  filters: { partyName: 'supplier_name' },

  dateField: 'purchase_date',
  personField: 'buyer',
  extraDateField: 'expected_date',
  qtyField: 'received_quantity',

  act: {
    verb: '收货',
    verbOne: '收',
    donePart: '收货',
    stockWord: '入库',
    route: 'receive',
    log: '采购收货',
    logDone: '采购收货完成',
    typeIn: 'purchase_in',
    typeOut: '',
    delta: 1,
    relatedType: 'purchase',
  },

  status: { draft: 0, approved: 1, partial: 2, done: 3, closed: 4 },
  statusText: {
    0: '草稿',
    1: '已审核',
    2: '部分收货',
    3: '已收货',
    4: '已关闭',
    5: '部分退货',
    6: '已退货',
  },
})
