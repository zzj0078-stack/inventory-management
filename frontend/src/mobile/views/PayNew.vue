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
        <select v-model="partnerId" class="select">
          <option value="">请选择{{ partnerLabel }}</option>
          <option v-for="p in partners" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
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
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, errMsg } from '../api'
import { toast } from '../store'
import { money, num, today, PAY_METHODS } from '../util'

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

const partnerLabel = computed(() => (partnerType.value === 'customer' ? '客户' : '供应商'))

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
}

function setPartnerType(v) {
  partnerType.value = v
  partnerId.value = ''
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
})
</script>
