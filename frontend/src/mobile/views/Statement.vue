<template>
  <div class="page">
    <!-- 类型 -->
    <div class="chips">
      <button
        class="chip-btn"
        :class="{ active: side === 'customer' }"
        @click="setSide('customer')"
      >客户（应收）</button>
      <button
        class="chip-btn"
        :class="{ active: side === 'supplier' }"
        @click="setSide('supplier')"
      >供应商（应付）</button>
    </div>

    <!-- 往来单位 -->
    <div class="field">
      <label class="field-label">{{ partyLabel }}</label>
      <select v-model="partnerId" class="select" @change="load">
        <option value="">请选择{{ partyLabel }}</option>
        <option v-for="p in partners" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <!-- 日期区间 -->
    <div class="row" style="gap: 10px">
      <div class="field grow" style="margin-bottom: 0">
        <label class="field-label">开始日期</label>
        <input v-model="start" type="date" class="input" @change="load" />
      </div>
      <div class="field grow" style="margin-bottom: 0">
        <label class="field-label">结束日期</label>
        <input v-model="end" type="date" class="input" @change="load" />
      </div>
    </div>
    <div class="field-hint">
      留空表示不限。期初余额=起始日之前的累计净额；期末余额=期初+本期增加−本期减少。
      <button class="btn btn-sm mt8" @click="clearRange">全部期间</button>
    </div>

    <div v-if="loading" class="loading"><div class="spinner" />加载中…</div>

    <div v-else-if="!partnerId" class="empty">请选择{{ partyLabel }}后查看对账单</div>

    <template v-else-if="data">
      <!-- 汇总 -->
      <div class="card">
        <div class="between">
          <span class="bold" style="font-size: 15px">{{ data.partner.name }}</span>
          <span class="tiny muted-3">{{ data.row_count }} 笔</span>
        </div>
        <div v-if="data.partner.contact || data.partner.phone" class="tiny muted-3 mt8">
          <span v-if="data.partner.contact">{{ data.partner.contact }}</span>
          <span v-if="data.partner.phone"> · {{ data.partner.phone }}</span>
        </div>

        <div class="stmt-grid mt12">
          <div class="stmt-cell">
            <div class="tiny muted-3">期初余额</div>
            <div class="num bold">{{ money0(data.opening_balance) }}</div>
          </div>
          <div class="stmt-cell">
            <div class="tiny muted-3">本期增加</div>
            <div class="num bold inc">{{ money0(data.total_increase) }}</div>
          </div>
          <div class="stmt-cell">
            <div class="tiny muted-3">本期减少</div>
            <div class="num bold dec">{{ money0(data.total_decrease) }}</div>
          </div>
          <div class="stmt-cell">
            <div class="tiny muted-3">期末余额</div>
            <div class="num bold close">{{ money0(data.closing_balance) }}</div>
          </div>
        </div>
        <div class="tiny muted-3 mt8">
          期间：{{ data.start || '不限' }} ~ {{ data.end || '不限' }}
        </div>
      </div>

      <!-- 流水 -->
      <div v-if="!data.rows.length" class="empty">该期间没有流水</div>

      <div v-else class="card card-tight">
        <div v-for="(r, i) in data.rows" :key="i" class="list-item">
          <div class="between">
            <span class="small muted-3">{{ r.date }}</span>
            <span class="chip" :class="kindChip(r.kind)">{{ r.kind }}</span>
          </div>
          <div class="between mt8">
            <span class="tiny muted-3 num">{{ r.doc_no }}</span>
            <span class="num bold" :style="amountStyle(r)">
              {{ r.increase ? '+' + money0(r.increase) : '−' + money0(r.decrease) }}
            </span>
          </div>

          <!-- 单据/退货单的业务内容：商品 × 数量 -->
          <div v-if="r.items && r.items.length" class="items-line">
            <div v-for="(it, k) in r.items" :key="k" class="item-line">
              <span class="ellipsis">{{ it.product_name }}</span>
              <span class="num muted-3">×{{ it.quantity }}{{ it.unit || '' }}</span>
            </div>
            <div class="tiny muted-3 mt8">共 {{ r.items_quantity }} 件</div>
          </div>

          <div class="between mt8">
            <span class="tiny muted-3">余额</span>
            <span class="num">{{ money0(r.balance) }}</span>
          </div>
        </div>
      </div>

      <div class="tiny muted-3 center mt12" style="line-height: 1.6">
        增加 = {{ side === 'customer' ? '销售单 / 退款给客户' : '采购单 / 收供应商退款' }}<br />
        减少 = {{ side === 'customer' ? '收款 / 销售退货' : '付款 / 采购退货' }}
      </div>
    </template>
  </div>
</template>

<script setup>
/**
 * 对账单（移动端）。
 *
 * 金额一律用接口返回的值直出，不在前端重算 —— 保证与欠款页、桌面端一致。
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { api, errMsg } from '../api'
import { toast } from '../store'
import { money0 } from '../util'

const route = useRoute()

const side = ref('customer')
const partnerId = ref('')
const start = ref('')
const end = ref('')
const partners = ref([])
const data = ref(null)
const loading = ref(false)
/** 请求序号：用于丢弃乱序返回的旧响应（见 load()） */
let loadSeq = 0

const partyLabel = computed(() => (side.value === 'customer' ? '客户' : '供应商'))

function kindChip(kind) {
  // .chip 只有 gray / green / orange / red 四种变体，单据用默认样式
  if (kind.includes('退货')) return 'orange'
  if (kind.includes('收') || kind.includes('付')) return 'green'
  return ''
}

function amountStyle(r) {
  return r.increase ? 'color:#dc2626' : 'color:#16a34a'
}

async function loadPartners() {
  try {
    const res = side.value === 'customer'
      ? await api.customers({ page: 1, page_size: 200, status: 1 })
      : await api.suppliers({ page: 1, page_size: 200, status: 1 })
    partners.value = res.items || []
  } catch {
    partners.value = []
  }
}

function setSide(v) {
  side.value = v
  partnerId.value = ''
  data.value = null
  loadPartners()
}

function clearRange() {
  start.value = ''
  end.value = ''
  if (partnerId.value) load()
}

async function load() {
  if (!partnerId.value) {
    data.value = null
    return
  }
  /*
   * 两个日期框各自触发一次 load()，所以请求会并发。
   * 用序号守卫：只有最新一次请求可以写入 data，
   * 否则先发后到的旧响应会把新条件的结果覆盖掉。
   */
  const seq = ++loadSeq
  loading.value = true
  try {
    const params = { partner_id: partnerId.value }
    if (start.value) params.start = start.value
    if (end.value) params.end = end.value
    const res = side.value === 'customer'
      ? await api.customerStatement(params)
      : await api.supplierStatement(params)
    if (seq !== loadSeq) return
    data.value = res
  } catch (e) {
    if (seq !== loadSeq) return
    data.value = null
    if (!e.friendlyMessage) toast.error(errMsg(e, '加载对账单失败'))
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

onMounted(async () => {
  const q = route.query
  if (q.side === 'supplier') side.value = 'supplier'
  await loadPartners()
  if (q.partner_id) {
    const id = Number(q.partner_id)
    if (partners.value.some((p) => p.id === id)) partnerId.value = id
  }
  if (partnerId.value) load()
})
</script>

<style scoped>
.stmt-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.stmt-cell {
  background: #f7f8fa;
  border-radius: 8px;
  padding: 8px 10px;
}
.stmt-cell .num {
  font-size: 16px;
  margin-top: 2px;
}
.inc {
  color: #dc2626;
}
.dec {
  color: #16a34a;
}
.close {
  color: #2f6fed;
}
/* 单据内容：浅底块，和金额行区分开 */
.items-line {
  margin-top: 8px;
  padding: 6px 8px;
  background: #f7f8fa;
  border-radius: 6px;
}
.item-line {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  line-height: 1.7;
}
.item-line .ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
