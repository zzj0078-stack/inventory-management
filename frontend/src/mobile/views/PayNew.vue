<template>
  <div class="page">
    <div class="card">
      <div class="field">
        <label class="field-label">类型 <span class="req">*</span></label>
        <div class="chips" style="margin-bottom: 0">
          <button class="chip-btn" :class="{ active: payType === 1 }" @click="setType(1)">收款</button>
          <button class="chip-btn" :class="{ active: payType === 2 }" @click="setType(2)">付款</button>
        </div>
      </div>

      <div class="field">
        <label class="field-label">对象类型 <span class="req">*</span></label>
        <div class="chips" style="margin-bottom: 0">
          <button class="chip-btn" :class="{ active: partnerType === 'customer' }" @click="setPartnerType('customer')">客户</button>
          <button class="chip-btn" :class="{ active: partnerType === 'supplier' }" @click="setPartnerType('supplier')">供应商</button>
        </div>
      </div>

      <div class="field">
        <label class="field-label">{{ partnerLabel }} <span class="req">*</span></label>
        <!-- 占位项绑空串而非 null：null 会渲染成无 value 属性的 option，
             其 DOM value 退化为文本，点选后 v-model 会拿到「请选择…」字符串。 -->
        <select v-model="partnerId" class="select" @change="onPartnerChange">
          <option value="">请选择{{ partnerLabel }}</option>
          <option v-for="p in partners" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>

      <!-- 选中往来单位后自动带出欠款，省去来回查欠款页 -->
      <div v-if="partnerId" class="field-hint outstanding-hint">
        <span v-if="outstandingLoading">正在读取欠款…</span>
        <template v-else-if="outstanding !== null">
          当前{{ partnerType === 'customer' ? '应收' : '应付' }}：
          <!-- money0 自带 ¥，这里不要再加，否则会显示成 ¥¥400 -->
          <b :class="outstanding > 0 ? 'amt-owed' : 'amt-clear'">{{ money0(outstanding) }}</b>
          <template v-if="outstanding > 0 && isMainFlow">
            <span class="muted-3">（已自动填入金额，可修改）</span>
            <button class="btn btn-sm mt8" @click="fillOutstanding">全额</button>
          </template>
          <template v-else-if="outstanding > 0">
            <span class="muted-3">（当前是退款方向，未自动填金额）</span>
          </template>
          <template v-else-if="outstanding < 0">
            <span class="muted-3">（已多付，无需再付）</span>
          </template>
          <template v-else>
            <span class="muted-3">（已结清）</span>
          </template>
        </template>
      </div>

      <div class="field">
        <label class="field-label">金额 <span class="req">*</span></label>
        <input v-model="amount" class="input" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" />
      </div>

      <div class="row" style="gap: 10px">
        <div class="field grow" style="margin-bottom: 0">
          <label class="field-label">支付方式</label>
          <select v-model="method" class="select">
            <option v-for="m in PAY_METHODS" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <div class="field grow" style="margin-bottom: 0">
          <label class="field-label">凭证日期</label>
          <input v-model="voucherDate" type="date" class="input" />
        </div>
      </div>
    </div>

    <!-- 核销：把这笔款分配到具体单据，才能体现哪些单已结清 -->
    <div v-if="partnerId && isMainFlow" class="card">
      <div class="between">
        <div class="card-title" style="margin:0">核销单据</div>
        <span class="tiny muted-3">
          <template v-if="ordersLoading">读取中…</template>
          <template v-else>{{ openOrders.length }} 张未结清</template>
        </span>
      </div>

      <div v-if="!ordersLoading && !openOrders.length" class="tiny muted-3 mt8">
        该{{ partnerLabel }}没有未结清的单据
      </div>

      <template v-else>
        <div class="field-hint" style="margin-top: 6px">
          可只核销一部分；没填的金额算作未指定用途的预收/预付。
        </div>

        <div v-for="o in openOrders" :key="o.id" class="alloc-row">
          <div class="grow">
            <div class="small bold num">{{ o.order_no }}</div>
            <div class="tiny muted-3">
              {{ o.date }} · 单据 {{ money0(o.total_amount) }}
              <span v-if="o.settled_amount > 0"> · 已结 {{ money0(o.settled_amount) }}</span>
              · 未结 <span class="owed">{{ money0(o.outstanding) }}</span>
            </div>
          </div>
          <input
            v-model="alloc[o.id]"
            class="input alloc-input"
            type="number"
            inputmode="decimal"
            min="0"
            step="0.01"
            placeholder="0"
            @input="onAllocEdit"
          />
        </div>

        <div class="row mt12" style="gap: 8px">
          <button class="btn btn-sm grow" @click="allocOldestFirst">按最早未结自动分摊</button>
          <button class="btn btn-sm grow" @click="clearAlloc">清空核销</button>
        </div>

        <div class="between mt12">
          <span class="small">核销合计</span>
          <span class="num bold" :class="{ over: allocTotal > num(amount) }">
            {{ money0(allocTotal) }} / {{ money0(num(amount)) }}
          </span>
        </div>
        <div v-if="allocTotal > num(amount)" class="tiny" style="color:#dc2626">
          核销合计不能大于本次金额
        </div>
      </template>
    </div>

    <!-- 凭证预览：让用户确认借贷方向对不对 -->
    <div class="card">
      <div class="card-title">凭证预览</div>
      <div class="kv"><span>摘要</span><span>{{ voucher.summary }}</span></div>
      <div class="kv"><span>借方</span><span class="bold">{{ voucher.debit }}</span></div>
      <div class="kv"><span>贷方</span><span class="bold">{{ voucher.credit }}</span></div>
      <div class="field-hint">凭证号由系统按会计期间自动生成（记-YYYY-MM-NNNN）</div>
    </div>

    <div class="card">
      <div class="field" style="margin-bottom: 0">
        <label class="field-label">备注</label>
        <textarea v-model="remark" class="input" placeholder="选填" />
      </div>
    </div>

    <div class="actionbar">
      <button class="btn btn-primary" :disabled="saving" @click="submit">
        {{ saving ? '提交中…' : '确认登记' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, errMsg } from '../api'
import { toast } from '../store'
import { money, money0, num, today, PAY_METHODS } from '../util'

const route = useRoute()
const router = useRouter()

const payType = ref(1)
const partnerType = ref('customer')
const partnerId = ref('')   // '' = 未选择；与占位项的 value="" 对应
const amount = ref('')
const method = ref('现金')
const voucherDate = ref(today())
const remark = ref('')
const saving = ref(false)

const partners = ref([])
/** 该往来单位的当前欠款（应收/应付），null = 尚未读取 */
const outstanding = ref(null)
const outstandingLoading = ref(false)

const partnerLabel = computed(() => (partnerType.value === 'customer' ? '客户' : '供应商'))

/**
 * 是否「收客户货款」/「付供应商货款」——只有这两个方向，
 * 欠款额才等于本次该收/该付的金额。
 * 另外两个方向（收供应商退款、退款给客户）金额与欠款无关，不能自动填。
 */
const isMainFlow = computed(
  () =>
    (payType.value === 1 && partnerType.value === 'customer') ||
    (payType.value === 2 && partnerType.value === 'supplier')
)

/** 读取当前往来单位的欠款；fill=true 时把欠款额填进金额框 */
async function loadOutstanding(fill) {
  outstanding.value = null
  if (!partnerId.value) return
  outstandingLoading.value = true
  try {
    const res = partnerType.value === 'customer'
      ? await api.customerOutstanding(partnerId.value)
      : await api.supplierOutstanding(partnerId.value)
    outstanding.value = num(res.amount)
    if (fill && isMainFlow.value && outstanding.value > 0) {
      amount.value = String(outstanding.value)
    }
  } catch {
    outstanding.value = null
  } finally {
    outstandingLoading.value = false
  }
}

function onPartnerChange() {
  loadOutstanding(true)
  loadOpenOrders()
}

/* ---------------- 核销 ---------------- */

/** 该往来单位未结清的单据（只对"收客户货款/付供应商货款"两个方向有意义） */
const openOrders = ref([])
const ordersLoading = ref(false)
/** order_id -> 本次核销金额（字符串，绑输入框） */
const alloc = reactive({})

const allocTotal = computed(() =>
  Object.values(alloc).reduce((s, v) => s + (num(v) || 0), 0)
)

async function loadOpenOrders() {
  openOrders.value = []
  for (const k of Object.keys(alloc)) delete alloc[k]
  if (!partnerId.value || !isMainFlow.value) return
  ordersLoading.value = true
  try {
    const res = await api.openOrders({
      partner_type: partnerType.value,
      partner_id: partnerId.value,
    })
    // 只列未结清的；已结清的没有核销意义
    openOrders.value = (res.items || []).filter((o) => !o.settled)
    // 默认把本次金额按最早未结的顺序铺开，多数情况一次就对
    allocOldestFirst()
  } catch {
    openOrders.value = []
  } finally {
    ordersLoading.value = false
  }
}

/**
 * 用户是否手动改过核销金额。
 * 手动改过之后就不再自动覆盖，否则改金额会把人工调整冲掉。
 * 点「自动分摊」或换往来单位会重置，重新开始自动分配。
 */
const allocTouched = ref(false)

/** 用户在核销输入框里改了值 */
function onAllocEdit() {
  allocTouched.value = true
}

/** 按日期从早到晚分配，直到用完本次金额（符合"先结最早的欠款"的习惯） */
function allocOldestFirst() {
  for (const k of Object.keys(alloc)) delete alloc[k]
  allocTouched.value = false
  let left = num(amount.value)
  if (!(left > 0)) return
  for (const o of openOrders.value) {
    if (left <= 0) break
    const take = Math.min(left, num(o.outstanding))
    if (take > 0) {
      alloc[o.id] = String(Math.round(take * 100) / 100)
      left = Math.round((left - take) * 100) / 100
    }
  }
}

/**
 * 金额变了就重新分摊。
 * 这是「金额与核销联动」的核心：以前改完金额必须手动再点一次自动分摊，
 * 否则显示的还是按上一次金额算出来的分配，看着像算错了。
 */
watch(amount, () => {
  if (allocTouched.value || !openOrders.value.length) return
  allocOldestFirst()
})

function clearAlloc() {
  for (const k of Object.keys(alloc)) delete alloc[k]
  allocTouched.value = true
}

/** 组装成接口需要的 allocations（过滤掉空行与 0） */
function buildAllocations() {
  return openOrders.value
    .map((o) => ({ related_type: o.related_type, related_id: o.id, amount: num(alloc[o.id]) || 0 }))
    .filter((a) => a.amount > 0)
}

function fillOutstanding() {
  if (outstanding.value != null && outstanding.value > 0) {
    amount.value = String(outstanding.value)
    allocOldestFirst()
  }
}

/** 借方现金科目：按收付款方式判断（与后端一致） */
const cashAccount = computed(
  () =>
    ({ 现金: '库存现金', 微信: '银行存款', 支付宝: '银行存款', 银行承兑: '应收票据' })[method.value] ||
    '银行存款'
)

const partnerName = computed(() => {
  const p = partners.value.find((x) => x.id === partnerId.value)
  return p ? p.name : ''
})

/** 四象限凭证预览（与后端 build_voucher 同规则） */
const voucher = computed(() => {
  const isReceive = payType.value === 1
  const isCustomer = partnerType.value === 'customer'
  const cash = cashAccount.value

  let verb
  let kind
  if (isReceive && isCustomer) [verb, kind] = ['收', '货款']
  else if (isReceive && !isCustomer) [verb, kind] = ['收', '退款']
  else if (!isReceive && !isCustomer) [verb, kind] = ['付', '货款']
  else [verb, kind] = ['付', '退款']

  let debit
  let credit
  if (isReceive && isCustomer) [debit, credit] = [cash, '应收账款']
  else if (isReceive && !isCustomer) [debit, credit] = [cash, '应付账款']
  else if (!isReceive && !isCustomer) [debit, credit] = ['应付账款', cash]
  else [debit, credit] = ['应收账款', cash]

  return { summary: `${verb}${partnerName.value}${kind}`, debit, credit }
})

function setType(v) {
  payType.value = v
  // 收/付方向变了：如果变成"收客户货款/付供应商货款"，把欠款额重新填上；
  // 变成退款方向则清掉自动填的数字，避免误用欠款额
  if (!partnerId.value) return
  if (isMainFlow.value) {
    if (outstanding.value == null) loadOutstanding(true)
    else fillOutstanding()
    loadOpenOrders()
  } else {
    if (amount.value !== '' && outstanding.value != null && num(amount.value) === outstanding.value) {
      amount.value = ''
    }
    // 退款方向没有可核销的单据，清掉
    clearAlloc()
    openOrders.value = []
  }
}

function setPartnerType(v) {
  partnerType.value = v
  partnerId.value = ''
  amount.value = ''
  outstanding.value = null
  clearAlloc()
  openOrders.value = []
  loadPartners()
}

async function loadPartners() {
  try {
    if (partnerType.value === 'customer') {
      const res = await api.customers({ page: 1, page_size: 100, status: 1 })
      partners.value = res.items || []
    } else {
      const res = await api.suppliers({ page: 1, page_size: 100, status: 1 })
      partners.value = res.items || []
    }
  } catch {
    partners.value = []
  }
}

async function submit() {
  if (!partnerId.value) return toast.error(`请选择${partnerLabel.value}`)
  if (!(num(amount.value) > 0)) return toast.error('金额必须大于 0')

  const allocations = buildAllocations()
  if (allocTotal.value > num(amount.value) + 0.005) {
    return toast.error('核销合计不能大于本次金额')
  }

  saving.value = true
  try {
    const res = await api.createPayment({
      type: payType.value,
      partner_type: partnerType.value,
      partner_id: partnerId.value,
      amount: num(amount.value),
      payment_method: method.value,
      voucher_date: voucherDate.value || undefined,
      remark: remark.value || undefined,
      // 不传则后端保留"未指定用途"，与以前行为一致
      allocations: allocations.length ? allocations : undefined,
    })
    toast.success(`已登记，凭证号 ${res.voucher_no}`)
    router.replace('/m')
  } catch (e) {
    if (!e.friendlyMessage) toast.error(errMsg(e, '登记失败'))
  } finally {
    saving.value = false
  }
}

/**
 * 从「客户欠款 / 采购欠款」跳进来时带参数，直接预选好类型与对象：
 *   partner=<id>  往来单位
 *   ptype=customer|supplier  对象类型
 *   type=1|2      1=收款 2=付款
 * 以前这里只 useRouter 没 useRoute，参数被忽略，点「登记收款」进来
 * 还得手动再选一次客户。
 */
onMounted(async () => {
  const q = route.query
  if (q.ptype === 'supplier' || q.ptype === 'customer') partnerType.value = q.ptype
  if (String(q.type) === '1' || String(q.type) === '2') payType.value = Number(q.type)

  await loadPartners()

  // 必须等 partners 加载完再设，否则下拉里没有这个选项，显示为空
  if (q.partner) {
    const id = Number(q.partner)
    if (partners.value.some((p) => p.id === id)) partnerId.value = id
  }
  // 带参数进来同样自动带出欠款并填好金额
  if (partnerId.value) loadOutstanding(true)
})
</script>

<style scoped>
.outstanding-hint {
  margin: -4px 0 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.amt-owed {
  color: #dc2626;
  font-size: 15px;
}
.amt-clear {
  color: #16a34a;
  font-size: 15px;
}
.outstanding-hint .btn {
  margin: 0;
}
/* 核销明细行：左侧单号信息，右侧金额输入 */
.alloc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--line);
}
.alloc-row:first-of-type {
  border-top: 0;
}
.alloc-input {
  width: 96px;
  min-height: 38px;
  padding: 6px 8px;
  font-size: 15px;
  text-align: right;
}
.owed {
  color: #dc2626;
}
.over {
  color: #dc2626;
}
</style>
