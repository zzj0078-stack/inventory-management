<template>
  <div class="page">
    <div v-if="loading" class="loading"><div class="spinner" />加载中…</div>

    <template v-else-if="o">
      <div class="card">
        <div class="between">
          <span class="bold num" style="font-size: 16px">{{ o.order_no }}</span>
          <span class="chip" :class="statusChip(o.status)">{{ o.status_text || statusText(o.status) }}</span>
        </div>
        <div class="kv mt12"><span>供应商</span><span>{{ o.supplier_name || '—' }}</span></div>
        <div class="kv"><span>联系人</span><span>{{ o.supplier_contact || '—' }}{{ o.supplier_phone ? ' · ' + o.supplier_phone : '' }}</span></div>
        <div class="kv"><span>采购日期</span><span>{{ o.purchase_date || '—' }}</span></div>
        <div class="kv"><span>收货仓库</span><span>{{ o.warehouse_name || '—' }}</span></div>
        <div v-if="o.delivery_address" class="kv"><span>交货地址</span><span>{{ o.delivery_address }}</span></div>
        <div v-if="o.receiver_name" class="kv"><span>接收人</span><span>{{ o.receiver_name }}</span></div>
        <div v-if="o.receiver_phone" class="kv"><span>接收人电话</span><span>{{ o.receiver_phone }}</span></div>
        <div v-if="o.remark" class="kv"><span>备注</span><span>{{ o.remark }}</span></div>
      </div>

      <div class="card">
        <div class="between">
          <div class="card-title" style="margin: 0">商品明细</div>
          <span class="tiny muted-3">{{ o.items.length }} 项</span>
        </div>

        <div v-for="it in o.items" :key="it.id" class="item-row">
          <div class="item-main">
            <div class="item-name">{{ it.product_name }}</div>
            <div class="item-sub">
              <span v-if="it.product_spec">{{ it.product_spec }} · </span>
              {{ money(it.price) }} × {{ it.quantity }} {{ it.product_unit || '' }}
            </div>
            <div class="item-sub mt8">
              已收 {{ it.received_quantity }} / 待收 {{ it.pending_quantity }}
            </div>
          </div>
          <div class="item-amount num">{{ money(it.amount) }}</div>
        </div>
      </div>

      <div class="card">
        <div class="kv"><span>明细合计</span><span class="num">{{ money(goodsAmount) }}</span></div>
        <div class="kv"><span>运费</span><span class="num">{{ money(o.freight) }}</span></div>
        <div class="kv"><span>其中税额</span><span class="num muted">{{ money(o.tax_amount) }}</span></div>
        <div class="kv" style="border-top: 1px solid var(--line); margin-top: 6px; padding-top: 10px">
          <span class="bold">整单合计</span>
          <span class="bold num" style="font-size: 18px; color: #d97706">{{ money(o.total_amount) }}</span>
        </div>
      </div>

      <div class="tiny muted-3 center mt12">
        创建：{{ dateTime(o.created_at) }}
        <span v-if="o.approve_at"> · 审核：{{ dateTime(o.approve_at) }}</span>
      </div>

      <div v-if="canApprove || canReceive" class="actionbar">
        <button v-if="canApprove" class="btn btn-primary" :disabled="busy" @click="approve">
          {{ busy ? '处理中…' : '审核' }}
        </button>
        <button v-if="canReceive" class="btn btn-success" :disabled="busy" @click="openReceive">
          收货入库
        </button>
      </div>

      <!-- 收货弹层 -->
      <div v-if="recvVisible" class="mask" @click.self="recvVisible = false">
        <div class="sheet">
          <div class="sheet-title">本次收货数量</div>
          <div class="sheet-text" style="margin-bottom: 8px">
            只填本次实际到货的数量；可分多次收货，未收齐会记为「部分收货」
          </div>

          <!--
            仓库只读展示，不提供选择：收货仓库由采购单本身决定
            （开单时已选好），入库时必须与单据一致。
            不传 warehouse_id 时后端会自动用单据的仓库。
          -->
          <div class="field">
            <label class="field-label">收货仓库</label>
            <div class="readonly-value">{{ o.warehouse_name || '默认仓库' }}</div>
          </div>

          <div v-for="it in o.items" :key="it.id" class="item-row">
            <div class="item-main">
              <div class="item-name">{{ it.product_name }}</div>
              <div class="item-sub">待收 {{ it.pending_quantity }}</div>
            </div>
            <input
              v-model="recvQty[it.id]"
              class="input qty-input"
              type="number"
              inputmode="numeric"
              min="0"
              :max="it.pending_quantity"
            />
          </div>

          <div class="btn-row mt16">
            <button class="btn" @click="recvVisible = false">取消</button>
            <button class="btn btn-primary" :disabled="busy" @click="submitReceive">
              {{ busy ? '提交中…' : '确认入库' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="empty">采购单不存在</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { api, errMsg } from '../api'
import { hasPerm, toast } from '../store'
import { money, dateTime, num, PURCHASE_STATUS } from '../util'

const route = useRoute()

const o = ref(null)
const loading = ref(true)
const busy = ref(false)

const recvVisible = ref(false)
const recvQty = reactive({})

const statusText = (s) => (PURCHASE_STATUS[s] ? PURCHASE_STATUS[s].t : String(s))
const statusChip = (s) => (PURCHASE_STATUS[s] ? PURCHASE_STATUS[s].c : 'gray')

const goodsAmount = computed(() => {
  if (!o.value) return 0
  return o.value.items.reduce((s, i) => s + num(i.amount), 0)
})

const canApprove = computed(
  () => o.value && o.value.status === 0 && hasPerm('purchase:approve')
)

const canReceive = computed(
  () => o.value && (o.value.status === 1 || o.value.status === 2) && hasPerm('purchase:receive')
)

async function load() {
  loading.value = true
  try {
    o.value = await api.purchaseOrder(route.params.id)
  } catch {
    o.value = null
  } finally {
    loading.value = false
  }
}

async function approve() {
  busy.value = true
  try {
    await api.approvePurchaseOrder(o.value.id)
    toast.success('审核成功')
    await load()
  } catch (e) {
    if (!e.friendlyMessage) toast.error(errMsg(e, '审核失败'))
  } finally {
    busy.value = false
  }
}

function openReceive() {
  for (const it of o.value.items) recvQty[it.id] = it.pending_quantity
  recvVisible.value = true
}

async function submitReceive() {
  const items = []
  for (const it of o.value.items) {
    const q = Number.parseInt(recvQty[it.id] ?? 0, 10) || 0
    if (q < 0) return toast.error('数量不能为负')
    if (q > it.pending_quantity) return toast.error(`「${it.product_name}」本次最多收 ${it.pending_quantity}`)
    if (q > 0) items.push({ item_id: it.id, quantity: q })
  }
  if (!items.length) return toast.error('请填写本次收货数量')

  busy.value = true
  try {
    // 不传 warehouse_id：后端会使用单据自己的收货仓库
    const res = await api.receivePurchaseOrder(o.value.id, { items })
    toast.success(res.message || '收货成功')
    recvVisible.value = false
    await load()
  } catch (e) {
    if (!e.friendlyMessage) toast.error(errMsg(e, '收货失败'))
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>
