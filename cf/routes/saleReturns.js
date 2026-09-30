/**
 * 销售退货
 * 对应 backend/app/api/extended.py 的「销售退货」段
 */

import { makeReturnRoutes } from '../lib/returns.js'

export const routes = makeReturnRoutes({
  base: 'sale-returns',
  table: { ret: 'sale_returns', item: 'sale_return_items' },
  prefix: 'SR',

  perm: {
    view: 'sale_return:view',
    add: 'sale_return:add',
    approve: 'sale_return:approve',
    act: 'sale_return:receive',
    cancel: 'sale_return:cancel',
  },

  doc: '销售退货单',
  module: '销售退货',

  party: { fk: 'customer_id', table: 'customers', respPrefix: 'customer' },

  source: {
    table: 'sales_orders',
    item: 'sales_items',
    fk: 'sales_order_id',
    qtyField: 'shipped_quantity',
    dateField: 'sale_date',
    doc: '销售单',
    actWord: '发货',
    statusText: {
      0: '草稿',
      1: '已审核',
      2: '部分发货',
      3: '已发货',
      4: '已关闭',
      5: '部分退货',
      6: '已退货',
    },
  },

  act: {
    route: 'receive',
    delta: 1, // 退货入库：库存增加
    stockType: 'sale_return_in',
    relatedType: 'sale_return',
    logWord: '入库',
    doneMessage: '入库成功',
  },

  statusText: { 0: '待审核', 1: '已审核', 2: '已退货', 3: '已作废' },
})
