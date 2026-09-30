/**
 * 采购退货
 * 对应 backend/app/api/extended.py 的「采购退货」段
 */

import { makeReturnRoutes } from '../lib/returns.js'

export const routes = makeReturnRoutes({
  base: 'purchase-returns',
  table: { ret: 'purchase_returns', item: 'purchase_return_items' },
  prefix: 'PR',

  perm: {
    view: 'purchase_return:view',
    add: 'purchase_return:add',
    approve: 'purchase_return:approve',
    act: 'purchase_return:ship',
    cancel: 'purchase_return:cancel',
  },

  doc: '采购退货单',
  module: '采购退货',

  party: { fk: 'supplier_id', table: 'suppliers', respPrefix: 'supplier' },

  source: {
    table: 'purchase_orders',
    item: 'purchase_items',
    fk: 'purchase_order_id',
    qtyField: 'received_quantity',
    dateField: 'purchase_date',
    doc: '采购单',
    actWord: '收货',
    statusText: {
      0: '草稿',
      1: '已审核',
      2: '部分收货',
      3: '已收货',
      4: '已关闭',
      5: '部分退货',
      6: '已退货',
    },
  },

  act: {
    route: 'ship',
    delta: -1, // 退货出库：库存减少
    stockType: 'purchase_return_out',
    relatedType: 'purchase_return',
    logWord: '出库',
    doneMessage: '出库成功',
  },

  statusText: { 0: '待审核', 1: '已审核', 2: '已退货', 3: '已作废' },
})
