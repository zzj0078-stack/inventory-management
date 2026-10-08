<template>
  <div class="page-container">
    <!-- 应收应付概况 -->
    <el-row :gutter="16" style="margin-bottom:16px">
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-label">{{ receivableLabel }}</div>
          <div class="stat-value" :class="money(receivables.receivable) >= 0 ? 'blue' : 'green'">
            {{ money(Math.abs(receivables.receivable)) }}
          </div>
          <div class="stat-sub">
            收客户 {{ money(receivables.recv_from_customer ?? receivables.received) }}
            <span v-if="receivables.refund_to_customer"> · 退客户 {{ money(receivables.refund_to_customer) }}</span>
            <span v-if="receivables.sale_returned"> · 退货 {{ money(receivables.sale_returned) }}</span>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-label">{{ payableLabel }}</div>
          <div class="stat-value" :class="money(receivables.payable) >= 0 ? 'orange' : 'green'">
            {{ money(Math.abs(receivables.payable)) }}
          </div>
          <div class="stat-sub">
            付供应商 {{ money(receivables.paid_to_supplier ?? receivables.paid) }}
            <span v-if="receivables.refund_from_supplier"> · 供应商退回 {{ money(receivables.refund_from_supplier) }}</span>
            <span v-if="receivables.purchase_returned"> · 退货 {{ money(receivables.purchase_returned) }}</span>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-label">销售总额</div>
          <div class="stat-value">{{ money(receivables.sales_total) }}</div>
          <div class="stat-sub">
            净额 {{ money(receivables.sales_total - (receivables.sale_returned || 0)) }}
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-label">采购总额</div>
          <div class="stat-value">{{ money(receivables.purchase_total) }}</div>
          <div class="stat-sub">
            净额 {{ money(receivables.purchase_total - (receivables.purchase_returned || 0)) }}
          </div>
        </div>
      </el-col>
    </el-row>

    <el-card>
      <template #header>
        <div class="card-header">
          <span>收付款记录</span>
          <div>
            <el-button v-permission="'finance:export'" @click="doExport">
              <el-icon><Download /></el-icon> 导出CSV
            </el-button>
            <el-button v-permission="'finance:add'" type="primary" @click="handleAdd">
              <el-icon><Plus /></el-icon> 新增
            </el-button>
          </div>
        </div>
      </template>

      <el-form :inline="true" :model="sf">
        <el-form-item label="类型">
          <el-select v-model="sf.type" clearable placeholder="全部" :value-on-clear="null" style="width:130px">
            <el-option :value="1" label="收款" /><el-option :value="2" label="付款" />
          </el-select>
        </el-form-item>
        <el-form-item label="对象">
          <el-select v-model="sf.partner_type" clearable placeholder="全部" :value-on-clear="null" style="width:130px">
            <el-option value="customer" label="客户" /><el-option value="supplier" label="供应商" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load">查询</el-button>
          <el-button @click="resetSearch">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="list" v-loading="loading" border stripe size="small" style="width:100%">
        <el-table-column prop="payment_no" label="单号" header-align="center" width="150" show-overflow-tooltip />
        <el-table-column prop="voucher_no" label="凭证号" header-align="center" align="center" width="130" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.voucher_no || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="type" label="类型" header-align="center" width="70" align="center">
          <template #default="{row}">
            <el-tag :type="row.type===1?'success':'warning'" size="small">{{ row.type===1?'收款':'付款' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="对象" header-align="center" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="ellipsis-cell">{{ row.partner_name || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="summary" label="摘要" header-align="center" min-width="200" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.summary || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="amount" label="金额" header-align="center" width="125" align="right">
          <template #default="{ row }">{{ Number(row.amount).toFixed(2) }} 元</template>
        </el-table-column>
        <el-table-column prop="payment_method" label="方式" align="center" width="90">
          <template #default="{ row }">{{ row.payment_method || '-' }}</template>
        </el-table-column>
        <el-table-column label="借贷" header-align="center" align="center" width="150">
          <template #default="{ row }">
            <div class="dr">借 {{ row.debit_account || '-' }}</div>
            <div class="cr">贷 {{ row.credit_account || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="voucher_date" label="凭证日期" header-align="center" align="center" width="100">
          <template #default="{ row }">{{ row.voucher_date || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" header-align="center" width="150" align="center">
          <template #default="{ row }">
            <el-button v-permission="'finance:edit'" type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button type="primary" link size="small" @click="printVoucher(row)">凭证</el-button>
            <el-button v-permission="'finance:delete'" type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        style="margin-top:16px;justify-content:flex-end"
        v-model:current-page="pg.page" v-model:page-size="pg.size"
        :total="pg.total" layout="total,prev,pager,next" @change="load" />
    </el-card>

    <!-- 核销表格有 6 列，560px 会把「未结」「本次核销」截掉，所以加宽 -->
    <el-dialog v-model="dlgVisible" :title="dlgTitle" width="880px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="类型" prop="type">
          <el-radio-group v-model="form.type" @change="onTypeChange">
            <el-radio :value="1">收款</el-radio>
            <el-radio :value="2">付款</el-radio>
          </el-radio-group>
          <div class="field-hint">{{ typeHint }}</div>
        </el-form-item>
        <el-form-item label="对象类型" prop="partner_type">
          <el-select v-model="form.partner_type" style="width:100%" @change="onPartnerTypeChange">
            <el-option value="customer" :label="form.type === 1 ? '客户（收客户货款）' : '客户（退款给客户）'" />
            <el-option value="supplier" :label="form.type === 1 ? '供应商（供应商退款给我们）' : '供应商（付供应商货款）'" />
          </el-select>
          <div class="field-hint">{{ partnerHint }}</div>
        </el-form-item>
        <el-form-item label="往来单位" prop="partner_id">
          <el-select v-model="form.partner_id" filterable placeholder="请选择"
            style="width:100%" @change="loadBalance">
            <el-option v-for="o in partners" :key="o.id" :label="o.name" :value="o.id" />
          </el-select>
          <div v-if="balanceLoaded" class="field-hint" :class="balanceClass">
            {{ balanceLabel }}：<b>{{ Math.abs(balance).toFixed(2) }}</b> 元
            <el-button v-if="balance > 0" link type="primary" size="small"
              style="margin-left:8px" @click="form.amount = Number(balance.toFixed(2))">
              全额{{ isRefund ? '退款' : (form.type === 1 ? '收款' : '付款') }}
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="金额" prop="amount">
          <div class="amount-input">
            <el-input-number v-model="form.amount" :precision="2" :min="0"
              :controls="false" style="flex:1" placeholder="0.00" />
            <span class="unit">元</span>
          </div>
          <div v-if="overBalance" class="field-hint warn">{{ overHint }}</div>
        </el-form-item>
        <!-- 核销：把这笔款分配到具体单据，才能体现哪些单已结清 -->
        <el-form-item
          v-if="form.partner_id && isMainFlow"
          label="核销单据"
        >
          <div class="alloc-box">
            <div class="alloc-head">
              <span class="tiny muted">
                <template v-if="ordersLoading">读取未清单据…</template>
                <template v-else-if="!openOrders.length">该往来单位没有未结清的单据</template>
                <template v-else>{{ openOrders.length }} 张未结清 · 可只核销一部分</template>
              </span>
              <span v-if="openOrders.length">
                <el-button link type="primary" @click="allocOldestFirst">按最早未结自动分摊</el-button>
                <el-button link @click="clearAlloc">清空</el-button>
              </span>
            </div>

            <el-table v-if="openOrders.length" :data="openOrders" size="small" border>
              <el-table-column prop="order_no" label="单号" width="130" />
              <el-table-column prop="date" label="日期" width="95" align="center" />
              <el-table-column label="单据金额" width="95" align="right">
                <template #default="{ row }">{{ money(row.total_amount) }}</template>
              </el-table-column>
              <el-table-column label="已退货" width="85" align="right">
                <template #default="{ row }">
                  <span :class="{ muted: !row.returned_amount }">
                    {{ row.returned_amount ? money(row.returned_amount) : '-' }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="未结" width="95" align="right">
                <template #default="{ row }">
                  <span class="owed">{{ money(row.outstanding) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="本次核销" min-width="130">
                <template #default="{ row }">
                  <el-input-number
                    v-model="alloc[row.id]"
                    :precision="2"
                    :min="0"
                    :max="row.outstanding"
                    :controls="false"
                    size="small"
                    style="width:100%"
                    @change="onAllocEdit"
                  />
                </template>
              </el-table-column>
            </el-table>

            <div v-if="openOrders.length" class="alloc-foot">
              <span>核销合计</span>
              <span class="num" :class="{ over: allocTotal > Number(form.amount || 0) }">
                ¥{{ money(allocTotal) }} / ¥{{ money(Number(form.amount || 0)) }}
              </span>
            </div>
            <div v-if="allocTotal > Number(form.amount || 0)" class="field-hint warn">
              核销合计不能大于本次金额
            </div>
          </div>
        </el-form-item>

        <el-form-item label="支付方式">
          <el-select v-model="form.payment_method" style="width:100%">
            <el-option value="现金" /><el-option value="银行转账" />
            <el-option value="微信" /><el-option value="支付宝" />
          </el-select>
        </el-form-item>
        <el-form-item label="凭证日期">
          <el-date-picker v-model="form.voucher_date" type="date" value-format="YYYY-MM-DD"
            placeholder="默认今天" style="width:100%" />
        </el-form-item>

        <!-- 凭证预览 -->
        <el-form-item label="凭证预览">
          <div class="voucher-preview">
            <div class="vp-row">
              <span class="vp-label">业务</span>
              <span class="vp-value"><b>{{ bizName }}</b></span>
            </div>
            <div class="vp-row">
              <span class="vp-label">摘要</span>
              <span class="vp-value">{{ previewSummary }}</span>
            </div>
            <div class="vp-row">
              <span class="vp-label">借方</span>
              <span class="vp-value dr">借 {{ previewDebit }}</span>
            </div>
            <div class="vp-row">
              <span class="vp-label">贷方</span>
              <span class="vp-value cr">贷 {{ previewCredit }}</span>
            </div>
            <div class="vp-hint">凭证号与摘要由系统按会计期间自动生成，可在列表中打印凭证。</div>
          </div>
        </el-form-item>

        <el-form-item label="外部流水号">
          <el-input v-model="form.voucher_no" placeholder="银行流水号，选填；留空则自动生成凭证号" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import {
  getPayments, createPayment, updatePayment, deletePayment, getReceivables,
  getCustomers, getSuppliers, downloadExport, getOpenOrders,
  getCustomerOutstanding, getSupplierOutstanding
} from '../api/modules'
import { ElMessage } from 'element-plus'
import { money } from '../utils/format'
import { printHtml } from '../utils/print'
import { confirmDelete } from '../utils/confirm'
import { useUserStore } from '../store/user'

const userStore = useUserStore()

/* ---------- 凭证预览（与后端 build_voucher 保持一致） ---------- */
const DEBIT_BY_METHOD = {
  '现金': '库存现金',
  '银行转账': '银行存款',
  '微信': '银行存款',
  '支付宝': '银行存款',
  '银行承兑': '应收票据'
}

const partnerName = computed(() => {
  const o = partners.value.find(x => x.id === form.partner_id)
  return o ? o.name : ''
})

const previewSummary = computed(() => {
  if (!form.partner_id) return '（选择往来单位后自动生成）'
  const isCust = form.partner_type === 'customer'
  const isRecv = form.type === 1
  // 四象限：收客户货款 / 收供应商退款 / 付供应商货款 / 退款给客户
  let verb, kind
  if (isRecv && isCust) { verb = '收'; kind = '货款' }
  else if (isRecv && !isCust) { verb = '收'; kind = '退款' }
  else if (!isRecv && !isCust) { verb = '付'; kind = '货款' }
  else { verb = '付'; kind = '退款' }
  return `${verb}${partnerName.value}${kind}`
})

const previewDebit = computed(() => {
  const isCust = form.partner_type === 'customer'
  const isRecv = form.type === 1
  const cash = DEBIT_BY_METHOD[form.payment_method] || '银行存款'
  if (isRecv && isCust) return cash
  if (isRecv && !isCust) return cash
  if (!isRecv && !isCust) return '应付账款'
  return '应收账款'          // 退款给客户
})

const previewCredit = computed(() => {
  const isCust = form.partner_type === 'customer'
  const isRecv = form.type === 1
  const cash = DEBIT_BY_METHOD[form.payment_method] || '银行存款'
  if (isRecv && isCust) return '应收账款'
  if (isRecv && !isCust) return '应付账款'
  if (!isRecv && !isCust) return cash
  return cash                // 退款给客户
})

/** 业务名称，用于提示 */
const bizName = computed(() => {
  const isCust = form.partner_type === 'customer'
  const isRecv = form.type === 1
  if (isRecv && isCust) return '收客户货款'
  if (isRecv && !isCust) return '收供应商退款'
  if (!isRecv && !isCust) return '付供应商货款'
  return '退款给客户'
})

const loading = ref(false)
const submitting = ref(false)
const list = ref([])
const partners = ref([])
const dlgVisible = ref(false)
const formRef = ref(null)
const dlgTitle = ref('新增收付款')
/** 非空表示编辑模式 */
const editId = ref(null)

const sf = reactive({ type: null, partner_type: null })
const pg = reactive({ page: 1, size: 20, total: 0 })
const receivables = reactive({
  receivable: 0, payable: 0, received: 0, paid: 0,
  sales_total: 0, purchase_total: 0,
  sale_returned: 0, purchase_returned: 0,
  recv_from_customer: 0, refund_to_customer: 0,
  paid_to_supplier: 0, refund_from_supplier: 0
})

/** 余额为负 = 对方多付，文案随之变化 */
const receivableLabel = computed(() => {
  const v = Number(receivables.receivable)
  return v > 0 ? '应收金额' : (v < 0 ? '预收 / 应退客户' : '应收已结清')
})
const payableLabel = computed(() => {
  const v = Number(receivables.payable)
  return v > 0 ? '应付金额' : (v < 0 ? '预付 / 应收回' : '应付已结清')
})

const form = reactive({
  type: 1, partner_type: 'customer', partner_id: null,
  amount: 0, payment_method: '现金', voucher_no: '', voucher_date: '', remark: ''
})

/* ---------------- 核销 ---------------- */

/** 该往来单位未结清的单据 */
const openOrders = ref([])
const ordersLoading = ref(false)
/** order_id -> 本次核销金额 */
const alloc = reactive({})

const allocTotal = computed(() =>
  Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0)
)

/**
 * 是否「收客户货款 / 付供应商货款」——只有这两个方向才有可核销的单据。
 * 另外两个方向（收供应商退款、退款给客户）金额与单据无关。
 */
const isMainFlow = computed(
  () =>
    (form.type === 1 && form.partner_type === 'customer') ||
    (form.type === 2 && form.partner_type === 'supplier')
)

async function loadOpenOrders() {
  openOrders.value = []
  clearAlloc()
  if (!form.partner_id || !isMainFlow.value) return
  ordersLoading.value = true
  try {
    const res = await getOpenOrders({
      partner_type: form.partner_type,
      partner_id: form.partner_id,
    })
    // 只列未结清的；已结清的没有核销意义
    openOrders.value = (res.items || []).filter((o) => !o.settled)
    allocOldestFirst()
  } catch {
    openOrders.value = []
  } finally {
    ordersLoading.value = false
  }
}

/**
 * 用户是否手动改过核销金额。
 * 手动改过之后就不再自动覆盖——否则改金额会把人工调整冲掉，来回打架。
 * 点「自动分摊」或换往来单位会重置为 false，重新开始自动分配。
 */
const allocTouched = ref(false)

/** 用户在某一行的核销输入框里改了值 */
function onAllocEdit() {
  allocTouched.value = true
}

/** 按日期从早到晚分配，直到用完本次金额 */
function allocOldestFirst() {
  clearAlloc()
  allocTouched.value = false
  let left = Number(form.amount || 0)
  if (!(left > 0)) return
  for (const o of openOrders.value) {
    if (left <= 0) break
    const take = Math.min(left, Number(o.outstanding || 0))
    if (take > 0) {
      alloc[o.id] = Math.round(take * 100) / 100
      left = Math.round((left - take) * 100) / 100
    }
  }
}

/**
 * 金额变了就重新分摊。
 * 这是「金额与核销联动」的核心：以前改完金额必须手动再点一次自动分摊，
 * 否则显示的还是上一次金额算出来的分配，看着像算错了。
 */
watch(
  () => form.amount,
  () => {
    if (allocTouched.value || !openOrders.value.length) return
    allocOldestFirst()
  }
)

function clearAlloc() {
  for (const k of Object.keys(alloc)) delete alloc[k]
  allocTouched.value = true
}

/** 提交用的分配数组（过滤 0 与空行） */
function buildAllocations() {
  return openOrders.value
    .map((o) => ({
      related_type: o.related_type,
      related_id: o.id,
      amount: Number(alloc[o.id]) || 0,
    }))
    .filter((a) => a.amount > 0)
}

const rules = {
  type: [{ required: true, message: '请选择类型', trigger: 'change' }],
  partner_type: [{ required: true, message: '请选择对象类型', trigger: 'change' }],
  partner_id: [{ required: true, message: '请选择往来单位', trigger: 'change' }],
  amount: [
    { required: true, message: '请输入金额', trigger: 'blur' },
    {
      validator: (r, v, cb) => (Number(v) > 0 ? cb() : cb(new Error('金额必须大于 0'))),
      trigger: 'blur'
    }
  ]
}

const load = async () => {
  loading.value = true
  try {
    const r = await getPayments({ page: pg.page, page_size: pg.size, type: sf.type })
    let items = r.items || []
    if (sf.partner_type) items = items.filter(i => i.partner_type === sf.partner_type)
    list.value = items
    pg.total = r.total
  } finally {
    loading.value = false
  }
}

const loadRec = async () => {
  const r = await getReceivables()
  Object.assign(receivables, r)
}

const loadPartners = async () => {
  if (form.partner_type === 'customer') {
    const r = await getCustomers({ page: 1, page_size: 1000 })
    partners.value = r.items || []
  } else {
    const r = await getSuppliers({ page: 1, page_size: 1000 })
    partners.value = r.items || []
  }
}

const onPartnerTypeChange = async () => {
  form.partner_id = null
  balance.value = 0
  balanceLoaded.value = false
  openOrders.value = []
  clearAlloc()
  await loadPartners()
}

/* ---------- 往来单位欠款余额 ---------- */
const balance = ref(0)
const balanceLoaded = ref(false)

/** 是否属于「退款/退款收回」类业务（金额方向与常规相反） */
const isRefund = computed(() => {
  const isCust = form.partner_type === 'customer'
  const isRecv = form.type === 1
  return (isCust && !isRecv) || (!isCust && isRecv)
})

const balanceLabel = computed(() => {
  if (form.partner_type === 'customer') {
    return balance.value >= 0 ? '该客户应收欠款' : '该客户预收/应退'
  }
  return balance.value >= 0 ? '该供应商应付欠款' : '该供应商预付/应收回'
})

const balanceClass = computed(() => (balance.value > 0 ? 'warn' : 'ok'))

/** 收款超出欠款的提示 */
const overBalance = computed(() => {
  if (!balanceLoaded.value || !form.partner_id) return false
  return Number(form.amount || 0) > Math.abs(balance.value) && Math.abs(balance.value) >= 0
    && Number(form.amount || 0) > 0
})

/** 选择往来单位后查询其应收/应付 */
const loadBalance = async () => {
  balance.value = 0
  balanceLoaded.value = false
  if (!form.partner_id) {
    openOrders.value = []
    clearAlloc()
    return
  }
  try {
    const r = form.partner_type === 'customer'
      ? await getCustomerOutstanding(form.partner_id)
      : await getSupplierOutstanding(form.partner_id)
    balance.value = Number(r.amount ?? r.receivable ?? r.payable ?? 0)
    balanceLoaded.value = true
  } catch (e) {
    // 无权限或接口异常时不阻塞录入
  }
  // 顺带把未结清单据拉出来，供核销
  await loadOpenOrders()
}

/* ---------- 类型 ↔ 对象类型 联动 ---------- */
/** 收款 -> 客户，付款 -> 供应商；允许手动改（如供应商退款） */
const onTypeChange = async (val) => {
  const want = val === 1 ? 'customer' : 'supplier'
  if (form.partner_type !== want) {
    form.partner_type = want
    form.partner_id = null
    await loadPartners()
  }
}

const typeHint = computed(() => {
  const isCust = form.partner_type === 'customer'
  const isRecv = form.type === 1
  if (isRecv && isCust) return '向客户收取货款：该客户应收欠款减少'
  if (isRecv && !isCust) return '收供应商退款：该供应商应付欠款回升'
  if (!isRecv && !isCust) return '向供应商支付货款：该供应商应付欠款减少'
  return '退款给客户：把多收的钱还回去，应退款减少'
})

/** 分录方向提示，与「凭证预览」保持一致 */
const partnerHint = computed(() =>
  `会计分录：借 ${previewDebit.value} / 贷 ${previewCredit.value}`
)

/** 超出当前欠款时的后果说明 */
const overHint = computed(() => {
  const isCust = form.partner_type === 'customer'
  const isRecv = form.type === 1
  const over = (Number(form.amount || 0) - Math.abs(balance.value)).toFixed(2)
  const base = `超出${balanceLabel.value} ${over} 元，`
  if (isRecv && isCust) return base + '将形成客户预收款'
  if (!isRecv && !isCust) return base + '将形成对供应商的预付款'
  if (!isRecv && isCust) return base + '将形成应退给客户的款项'
  return base + '将形成供应商应退给我们的款项'
})

const resetSearch = () => {
  sf.type = null
  sf.partner_type = null
  pg.page = 1
  load()
}

const handleAdd = async () => {
  const today = new Date().toISOString().slice(0, 10)
  editId.value = null
  form.type = 1
  form.partner_type = 'customer'
  form.partner_id = null
  form.amount = 0
  form.payment_method = '现金'
  form.voucher_no = ''
  form.voucher_date = today
  form.remark = ''
  dlgTitle.value = '新增收付款'
  await loadPartners()
  dlgVisible.value = true
}

/** 编辑：回填表单，凭证号保留不变 */
const handleEdit = async (row) => {
  editId.value = row.id
  form.type = row.type
  form.partner_type = row.partner_type
  form.partner_id = row.partner_id
  form.amount = Number(row.amount)
  form.payment_method = row.payment_method || '现金'
  form.voucher_no = ''            // 留空表示不修改凭证号
  form.voucher_date = row.voucher_date || ''
  form.remark = row.remark || ''
  dlgTitle.value = '编辑收付款'
  await loadPartners()
  dlgVisible.value = true
}

const handleDelete = async (row) => {
  await confirmDelete(
    `收付款「${row.payment_no}」`,
    `凭证号：${row.voucher_no || '-'}<br/>` +
    `对象：${row.partner_name || '-'}<br/>` +
    `金额：¥${Number(row.amount).toFixed(2)}<br/><br/>` +
    `删除后该笔款项将从应收/应付中回退，且不可恢复。`
  )
  await deletePayment(row.id)
  ElMessage.success('删除成功')
  load()
  loadRec()
}

const submit = async () => {
  await formRef.value.validate()

  // 核销合计不能超过本次金额（后端也会校验，这里先拦住给出即时反馈）
  const allocs = buildAllocations()
  if (allocTotal.value > Number(form.amount || 0) + 0.005) {
    return ElMessage.error('核销合计不能大于本次金额')
  }

  submitting.value = true
  try {
    const payload = {
      type: form.type,
      partner_type: form.partner_type,
      partner_id: form.partner_id,
      amount: Number(form.amount),
      payment_method: form.payment_method,
      voucher_no: form.voucher_no || null,
      voucher_date: form.voucher_date || null,
      remark: form.remark,
      // 传了才会替换核销明细；没有可核销单据时为 undefined，后端保留原样
      allocations: allocs.length ? allocs : undefined,
    }
    if (editId.value) {
      await updatePayment(editId.value, payload)
      ElMessage.success('更新成功')
    } else {
      const res = await createPayment(payload)
      ElMessage.success(`创建成功，凭证号 ${res.voucher_no || ''}`)
    }
    dlgVisible.value = false
    load()
    loadRec()
  } catch (e) {
    // 错误已由拦截器提示
  } finally {
    submitting.value = false
  }
}

/** 打印记账凭证 */
const printVoucher = (row) => {
  const isReceive = row.type === 1
  // 制单：当前登录用户（优先姓名，其次登录名）
  const maker = userStore.userInfo?.full_name || userStore.userInfo?.username || ''
  const html = `
    <div style="font-size:12px;">
      <div style="text-align:center;font-size:20px;font-weight:bold;letter-spacing:8px;margin-bottom:4px;">记账凭证</div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span>凭证号：${row.voucher_no || '-'}</span>
        <span>日期：${row.voucher_date || ''}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr>
            <th style="border:1px solid #000;padding:5px;width:38%;"align="center">摘要</th>
            <th style="border:1px solid #000;padding:5px;width:24%;"align="center">会计科目</th>
            <th style="border:1px solid #000;padding:5px;width:19%;"align="center">借方金额</th>
            <th style="border:1px solid #000;padding:5px;width:19%;"align="center">贷方金额</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #000;padding:6px;">${row.summary || ''}</td>
            <td style="border:1px solid #000;padding:6px;">${row.debit_account || ''}</td>
            <td style="border:1px solid #000;padding:6px;text-align:right;">${Number(row.amount).toFixed(2)}</td>
            <td style="border:1px solid #000;padding:6px;text-align:right;"></td>
          </tr>
          <tr>
            <td style="border:1px solid #000;padding:6px;">${row.summary || ''}</td>
            <td style="border:1px solid #000;padding:6px;">${row.credit_account || ''}</td>
            <td style="border:1px solid #000;padding:6px;text-align:right;"></td>
            <td style="border:1px solid #000;padding:6px;text-align:right;">${Number(row.amount).toFixed(2)}</td>
          </tr>
          <tr>
            <td colspan="3" style="border:1px solid #000;padding:6px;text-align:right;font-weight:bold;">
              合计：${Number(row.amount).toFixed(2)}
            </td>
            <td style="border:1px solid #000;padding:6px;text-align:right;font-weight:bold;">
              ${Number(row.amount).toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>
      <div style="display:flex;justify-content:space-between;margin-top:8px;">
        <span>附单据数：${row.attachment_count || 1}</span>
        <span>${isReceive ? '收款单' : '付款单'}：${row.payment_no || ''}</span>
      </div>
      <div style="display:flex;gap:150px;margin-top:10px;">
        <span>制单：${maker}</span>
        <span>审核：</span>
        <span>出纳：</span>
      </div>
    </div>`
  printHtml(html)
}

const doExport = async () => {
  await downloadExport('payments')
  ElMessage.success('已导出')
}

onMounted(() => {
  load()
  loadRec()
})
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.stat-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 14px 16px;
}
.stat-label {
  font-size: 13px;
  color: #909399;
  margin-bottom: 6px;
}
.stat-value {
  font-size: 22px;
  font-weight: bold;
  color: #303133;
  font-variant-numeric: tabular-nums;
}
.stat-value.blue { color: #409eff; }
.stat-value.orange { color: #e6a23c; }
.stat-value.green { color: #67c23a; }
.stat-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
/* 凭证预览 */
.voucher-preview {
  width: 100%;
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.9;
}
.vp-row {
  display: flex;
  gap: 10px;
}
.vp-label {
  color: #909399;
  width: 40px;
  flex-shrink: 0;
}
.vp-value { color: #303133; }
.vp-value.dr { color: #409eff; }
.vp-value.cr { color: #e6a23c; }
.vp-hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.5;
}
/* 列表借贷列 */
.dr { color: #409eff; font-size: 12px; }
.cr { color: #e6a23c; font-size: 12px; }
/* 表单字段提示：独占一行，避免与 radio/select 挤在一起 */
.field-hint {
  display: block;
  width: 100%;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
  margin-top: 4px;
}
.field-hint.warn { color: #e6a23c; }
.field-hint.ok { color: #67c23a; }

/* 核销区：表格 + 合计 */
.alloc-box {
  width: 100%;
}
.alloc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.alloc-foot {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 6px;
  font-size: 13px;
}
.alloc-foot .over {
  color: #f56c6c;
}
.owed {
  color: #f56c6c;
}

/* 金额输入 + 单位 */
.amount-input {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.amount-input .unit {
  color: #606266;
  font-size: 14px;
  flex-shrink: 0;
}
</style>
