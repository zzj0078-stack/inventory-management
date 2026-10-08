<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>采购退货</span>
          <el-button v-permission="'purchase_return:add'" type="primary" @click="handleAdd"><el-icon><Plus /></el-icon> 新增退货单</el-button>
        </div>
      </template>
      <el-form :inline="true" :model="sf">
        <el-form-item label="单号"><el-input v-model="sf.keyword" clearable placeholder="退货单号" style="width:180px" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="sf.status" clearable placeholder="全部" :value-on-clear="null" style="width:130px">
            <el-option :value="0" label="待审核" /><el-option :value="1" label="已审核" />
            <el-option :value="2" label="已退货" /><el-option :value="3" label="已作废" />
          </el-select>
        </el-form-item>
        <el-form-item><el-button type="primary" @click="load">查询</el-button><el-button @click="resetSearch">重置</el-button></el-form-item>
      </el-form>

      <!-- 金额汇总：active 口径与财务管理一致 -->
      <div class="sum-bar">
        <span>共 <b>{{ summary.count }}</b> 张</span>
        <span>全部金额：<b>¥{{ money(summary.all) }}</b></span>
        <span class="active">已生效(已审核/已退货)：<b>¥{{ money(summary.active) }}</b>
          <el-tag size="small" type="success" effect="plain">财务管理采用此口径</el-tag>
        </span>
        <span v-if="summary.draft" class="draft">待审核：¥{{ money(summary.draft) }}</span>
        <span v-if="summary.void" class="void">已作废：¥{{ money(summary.void) }}</span>
      </div>      <el-table :data="list" v-loading="loading" border stripe size="small" style="width:100%">
        <el-table-column prop="return_no" label="退货单号" width="140" header-align="center" />
        <el-table-column prop="source_order_no" label="来源采购单" width="140" header-align="center" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="ellipsis-cell" :style="{ color: row.source_order_no ? '' : '#e6a23c' }">
              {{ row.source_order_no || '无来源' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="supplier_name" label="供应商" min-width="130" header-align="center" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.supplier_name || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="total_amount" label="金额" width="110" header-align="center" align="right">
          <template #default="{ row }">{{ Number(row.total_amount).toFixed(2) }} 元</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80" header-align="center" align="center">
          <template #default="{row}"><el-tag :type="st[row.status]?.t" size="small">{{ st[row.status]?.l }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="reason" label="退货原因" min-width="120" header-align="center" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.reason || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="created_at" label="时间" width="120" header-align="center">
          <template #default="{row}">{{ fmtShort(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center">
          <template #default="{row}">
            <el-button type="primary" link @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.status===0" v-permission="'purchase_return:approve'" type="success" link @click="doApprove(row)">审核</el-button>
            <el-button v-if="row.status===1" v-permission="'purchase_return:ship'" type="warning" link @click="doShip(row)">出库</el-button>
            <el-button v-if="row.status<=1" v-permission="'purchase_return:cancel'" type="danger" link @click="doCancel(row)">作废</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination style="margin-top:16px;justify-content:flex-end" v-model:current-page="pg.page" v-model:page-size="pg.size" :total="pg.total" layout="total,prev,pager,next" @change="load" />
    </el-card>

    <el-dialog v-model="dlgVisible" title="新增采购退货" width="1020px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="来源采购单" required>
          <el-select
            v-model="form.purchase_order_id"
            filterable remote reserve-keyword
            :remote-method="searchOrders"
            :loading="orderLoading"
            placeholder="输入单号搜索已收货的采购单"
            style="width:100%"
            @change="onOrderChange"
          >
            <el-option
              v-for="o in returnableOrders"
              :key="o.id"
              :label="`${o.order_no}　${o.partner_name}　可退 ${o.returnable_quantity} 件`"
              :value="o.id"
            />
          </el-select>
          <div class="field-hint">退货必须关联原采购单，单价由原单带出</div>
        </el-form-item>

        <el-form-item label="供应商">
          <el-input :model-value="returnInfo?.supplier_name || '（选择采购单后自动带出）'" disabled />
        </el-form-item>

        <el-alert type="info" :closable="false" show-icon style="margin-bottom:10px"
          title="采购退货要出库，可退数量 = min(原单未退数量, 当前库存)；库存为 0 的商品退不出去。" />

        <el-table :data="returnRows" border size="small" v-loading="orderLoading">
          <el-table-column prop="product_name" label="商品名称" min-width="150" show-overflow-tooltip />
          <el-table-column prop="product_spec" label="规格/型号" min-width="110" show-overflow-tooltip>
            <template #default="{ row }"><span class="ellipsis-cell">{{ row.product_spec || '-' }}</span></template>
          </el-table-column>
          <el-table-column prop="product_unit" label="单位" width="55" align="center" />
          <el-table-column prop="received_quantity" label="已收货" width="75" align="right" />
          <el-table-column prop="returned_quantity" label="已退" width="65" align="right" />
          <el-table-column label="当前库存" width="85" align="right">
            <template #default="{ row }">
              <span :style="{ color: Number(row.stock_quantity) > 0 ? '#303133' : '#f56c6c', fontWeight: 600 }">
                {{ row.stock_quantity ?? '-' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="available_quantity" label="可退" width="65" align="right">
            <template #default="{ row }">
              <span :style="{ color: row.available_quantity > 0 ? '#67c23a' : '#909399' }">{{ row.available_quantity }}</span>
            </template>
          </el-table-column>
          <el-table-column label="本次退货" width="120">
            <template #default="{ row }">
              <el-input-number v-model="row.quantity" :min="0" :max="row.available_quantity"
                :controls="false" size="small" :disabled="row.available_quantity === 0" style="width:100%" />
            </template>
          </el-table-column>
          <el-table-column label="单价" width="95" align="right">
            <template #default="{ row }">{{ Number(row.price).toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="退货金额" width="105" align="right">
            <template #default="{ row }">{{ (Number(row.quantity || 0) * Number(row.price)).toFixed(2) }}</template>
          </el-table-column>
        </el-table>

        <el-form-item label="退货原因" style="margin-top:14px"><el-input v-model="form.reason" placeholder="如：质量问题、规格不符" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>

        <div style="text-align:right;font-size:15px;margin-top:8px">
          合计数量：<b>{{ totalQty }}</b>　金额：<b style="color:#f56c6c">¥{{ totalAmt }}</b>
        </div>
      </el-form>
      <template #footer><el-button @click="dlgVisible=false">取消</el-button><el-button type="primary" :loading="submitting" @click="submit">提交</el-button></template>
    </el-dialog>

    <!-- 退货单详情 -->
    <ReturnDetailDialog
      v-model="detailVisible"
      :detail-api="getPurchaseReturn"
      kind="purchase"
      :row="detailRow"
    />
  </div>
</template>
<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getPurchaseReturns, getPurchaseReturn, createPurchaseReturn, approvePurchaseReturn, shipPurchaseReturn, cancelPurchaseReturn } from '../api/modules'
import { getPurchaseReturnable, getPurchaseReturnAvailable } from '../api/modules'
import { ElMessage, ElMessageBox } from 'element-plus'
import { confirmAction, confirmCancel } from '../utils/confirm'
import { fmtShort } from '../utils/format'
import ReturnDetailDialog from '../components/ReturnDetailDialog.vue'
const st = { 0: { t: 'info', l: '待审核' }, 1: { t: 'warning', l: '已审核' }, 2: { t: 'success', l: '已退货' }, 3: { t: 'danger', l: '已作废' } }
const fmt = d => d ? new Date(d).toLocaleString() : '-'
const loading = ref(false), submitting = ref(false), list = ref([]), dlgVisible = ref(false)

/* 详情弹层 */
const detailVisible = ref(false)
const detailRow = ref(null)
const openDetail = (row) => {
  detailRow.value = row
  detailVisible.value = true
}
const sf = reactive({ keyword: '', status: null })
const pg = reactive({ page: 1, size: 20, total: 0 })
const summary = reactive({ all: 0, active: 0, draft: 0, void: 0, count: 0 })

const money = (v) => Number(v || 0).toFixed(2)

const resetSearch = () => {
  sf.keyword = ''
  sf.status = null
  pg.page = 1
  load()
}

/* 退货必须关联原采购单 */
const form = reactive({ purchase_order_id: null, reason: '', remark: '' })
const returnableOrders = ref([])
const returnRows = ref([])
const returnInfo = ref(null)
const orderLoading = ref(false)

const totalQty = computed(() => returnRows.value.reduce((s, r) => s + Number(r.quantity || 0), 0))
const totalAmt = computed(() =>
  returnRows.value.reduce((s, r) => s + Number(r.quantity || 0) * Number(r.price || 0), 0).toFixed(2)
)

const load = async () => { loading.value = true; try { const r = await getPurchaseReturns({ page: pg.page, page_size: pg.size, keyword: sf.keyword, status: sf.status }); list.value = r.items; pg.total = r.total; if (r.summary) Object.assign(summary, r.summary) } finally { loading.value = false } }

const searchOrders = async (kw) => {
  orderLoading.value = true
  try {
    const r = await getPurchaseReturnable({ keyword: kw || undefined, page: 1, page_size: 30 })
    returnableOrders.value = r.items || []
  } finally {
    orderLoading.value = false
  }
}

const onOrderChange = async (orderId) => {
  returnInfo.value = null
  returnRows.value = []
  if (!orderId) return
  orderLoading.value = true
  try {
    const info = await getPurchaseReturnAvailable(orderId)
    returnInfo.value = info
    returnRows.value = (info.items || []).map(i => ({ ...i, quantity: i.available_quantity }))
  } catch (e) {
    form.purchase_order_id = null
  } finally {
    orderLoading.value = false
  }
}

const handleAdd = async () => {
  form.purchase_order_id = null
  form.reason = ''
  form.remark = ''
  returnRows.value = []
  returnInfo.value = null
  dlgVisible.value = true
  await searchOrders('')
}

const doApprove = async r => { await confirmAction('确认审核', `退货单：<b>${r.return_no}</b>`, '确认审核'); await approvePurchaseReturn(r.id); ElMessage.success('审核成功'); load() }
const doShip = async r => { await confirmAction('确认出库', `退货单：<b>${r.return_no}</b><br/>出库后库存将立即减少。`, '确认出库'); await shipPurchaseReturn(r.id); ElMessage.success('出库成功'); load() }
const doCancel = async r => { await confirmCancel(`采购退货单「${r.return_no}」`); await cancelPurchaseReturn(r.id); ElMessage.success('作废成功'); load() }

const submit = async () => {
  if (!form.purchase_order_id) return ElMessage.warning('请选择来源采购单')
  const items = returnRows.value
    .filter(i => Number(i.quantity) > 0)
    .map(i => ({ product_id: i.product_id, quantity: Number(i.quantity), price: Number(i.price) }))
  if (!items.length) return ElMessage.warning('请填写本次退货数量')

  const over = returnRows.value.find(i => Number(i.quantity) > i.available_quantity)
  if (over) {
    return ElMessage.error(
      over.stock_quantity !== undefined
        ? `「${over.product_name}」可退 ${over.available_quantity}（原单可退 ${over.order_returnable_quantity}，当前库存 ${over.stock_quantity}），本次填写超出`
        : `「${over.product_name}」退货数量超过可退 ${over.available_quantity}`
    )
  }

  submitting.value = true
  try {
    await createPurchaseReturn({
      purchase_order_id: form.purchase_order_id,
      supplier_id: returnInfo.value.supplier_id,
      reason: form.reason,
      remark: form.remark,
      items
    })
    ElMessage.success('创建成功')
    dlgVisible.value = false
    load()
  } catch (e) {
    // 错误已由拦截器提示
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  load()
})
</script>
<style scoped>
.card-header{display:flex;justify-content:space-between;align-items:center}
.field-hint{font-size:12px;color:#909399;line-height:1.5;margin-top:2px}
/* 金额汇总条 */
.sum-bar{
  display:flex; flex-wrap:wrap; gap:8px 24px; align-items:center;
  padding:8px 12px; margin-bottom:10px;
  background:#f5f7fa; border-radius:4px; font-size:13px; color:#606266;
}
.sum-bar b{ color:#303133; }
.sum-bar .active b{ color:#67c23a; }
.sum-bar .draft{ color:#e6a23c; }
.sum-bar .void{ color:#909399; }
</style>
