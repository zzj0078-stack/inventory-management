<template>
  <div class="page">
    <div v-if="loading" class="loading"><div class="spinner" />加载中…</div>

    <template v-else-if="o">
      <!-- 单据头 -->
      <div class="card">
        <div class="between">
          <span class="bold num" style="font-size: 16px">{{ o.order_no }}</span>
          <span class="chip" :class="statusChip(o.status)">{{ o.status_text || statusText(o.status) }}</span>
        </div>
        <div class="kv mt12"><span>客户</span><span>{{ o.customer_name || '—' }}</span></div>
        <div class="kv"><span>联系人</span><span>{{ o.customer_contact || '—' }}{{ o.customer_phone ? ' · ' + o.customer_phone : '' }}</span></div>
        <div class="kv"><span>销售日期</span><span>{{ o.sale_date || '—' }}</span></div>
        <div class="kv"><span>发货仓库</span><span>{{ o.warehouse_name || '—' }}</span></div>
        <div class="kv"><span>销售员</span><span>{{ o.seller || o.creator_name || '—' }}</span></div>
        <div v-if="o.delivery_address" class="kv"><span>送货地址</span><span>{{ o.delivery_address }}</span></div>
        <div v-if="o.receiver_name" class="kv"><span>接收人</span><span>{{ o.receiver_name }}</span></div>
        <div v-if="o.receiver_phone" class="kv"><span>接收人电话</span><span>{{ o.receiver_phone }}</span></div>
        <div v-if="o.remark" class="kv"><span>备注</span><span>{{ o.remark }}</span></div>
      </div>

      <!-- 明细 -->
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
              已发 {{ it[qtyField] }} / 待发 {{ it.pending_quantity }}
            </div>
          </div>
          <div class="item-amount num">{{ money(it.amount) }}</div>
        </div>
      </div>

      <!-- 金额 -->
      <div class="card">
        <div class="kv"><span>明细合计</span><span class="num">{{ money(goodsAmount) }}</span></div>
        <div class="kv"><span>运费</span><span class="num">{{ money(o.freight) }}</span></div>
        <div class="kv"><span>其中税额</span><span class="num muted">{{ money(o.tax_amount) }}</span></div>
        <div class="kv" style="border-top: 1px solid var(--line); margin-top: 6px; padding-top: 10px">
          <span class="bold">整单合计</span>
          <span class="bold num" style="font-size: 18px; color: #2f6fed">{{ money(o.total_amount) }}</span>
        </div>
      </div>

      <div class="tiny muted-3 center mt12">
        创建：{{ dateTime(o.created_at) }}
        <span v-if="o.approve_at"> · 审核：{{ dateTime(o.approve_at) }}</span>
      </div>

      <!-- 底部操作 -->
      <div v-if="canApprove || canShip" class="actionbar">
        <button v-if="canApprove" class="btn btn-primary" :disabled="busy" @click="approve">
          {{ busy ? '处理中…' : '审核' }}
        </button>
        <button v-if="canShip" class="btn btn-success" :disabled="busy" @click="openShip">
          发货
        </button>
      </div>

      <!-- 发货弹层：分批出库 -->
      <div v-if="shipVisible" class="mask" @click.self="shipVisible = false">
        <div class="sheet">
          <div class="sheet-title">本次发货数量</div>
          <div class="sheet-text" style="margin-bottom: 8px">
            只填本次实际出库的数量；可多次发货，未发齐会记为「部分发货」
          </div>

          <!--
            仓库只读展示，不提供选择：发货仓库由销售单本身决定
            （开单时已选好），出库时必须与单据一致。
            不传 warehouse_id 时后端会自动用单据的仓库。
          -->
          <div class="field">
            <label class="field-label">发货仓库</label>
            <div class="readonly-value">{{ o.warehouse_name || '默认仓库' }}</div>
          </div>

          <div v-for="it in o.items" :key="it.id" class="item-row">
            <div class="item-main">
              <div class="item-name">{{ it.product_name }}</div>
              <div class="item-sub">待发 {{ it.pending_quantity }}</div>
            </div>
            <input
              v-model="shipQty[it.id]"
              class="input qty-input"
              type="number"
              inputmode="numeric"
              min="0"
              :max="it.pending_quantity"
            />
          </div>

          <div class="btn-row mt16">
            <button class="btn" @click="shipVisible = false">取消</button>
            <button class="btn btn-success" :disabled="busy" @click="submitShip">
              {{ busy ? '提交中…' : '确认出库' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="empty">销售单不存在</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, errMsg } from '../api'
import { hasPerm, toast } from '../store'
import { money, dateTime, num, SALE_STATUS } from '../util'

const route = useRoute()
const router = useRouter()

const o = ref(null)
const loading = ref(true)
const busy = ref(false)

const shipVisible = ref(false)
const shipQty = reactive({})

const qtyField = 'shipped_quantity'

const statusText = (s) => (SALE_STATUS[s] ? SALE_STATUS[s].t : String(s))
const statusChip = (s) => (SALE_STATUS[s] ? SALE_STATUS[s].c : 'gray')

const goodsAmount = computed(() => {
  if (!o.value) return 0
  return o.value.items.reduce((s, i) => s + num(i.amount), 0)
})

const canApprove = computed(() => o.value && o.value.status === 0 && hasPerm('sales:approve'))
const canShip = computed(
  () => o.value && (o.value.status === 1 || o.value.status === 2) && hasPerm('sales:ship')
)

async function load() {
  loading.value = true
  try {
    o.value = await api.salesOrder(route.params.id)
  } catch {
    o.value = null
  } finally {
    loading.value = false
  }
}

async function approve() {
  busy.value = true
  try {
    await api.approveSalesOrder(o.value.id)
    toast.success('审核成功')
    await load()
  } catch (e) {
    if (!e.friendlyMessage) toast.error(errMsg(e, '审核失败'))
  } finally {
    busy.value = false
  }
}

function openShip() {
  // 默认按「待发数量」预填
  for (const it of o.value.items) shipQty[it.id] = it.pending_quantity
  shipVisible.value = true
}

async function submitShip() {
  const items = []
  for (const it of o.value.items) {
    const q = Number.parseInt(shipQty[it.id] ?? 0, 10) || 0
    if (q < 0) return toast.error('数量不能为负')
    if (q > it.pending_quantity) {
      return toast.error(`「${it.product_name}」本次最多发 ${it.pending_quantity}`)
    }
    if (q > 0) items.push({ item_id: it.id, quantity: q })
  }
  if (!items.length) return toast.error('请填写本次发货数量')

  busy.value = true
  try {
    // 不传 warehouse_id：后端会使用单据自己的发货仓库
    const res = await api.shipSalesOrder(o.value.id, { items })
    toast.success(res.message || '发货成功')
    shipVisible.value = false
    await load()
  } catch (e) {
    // 库存不足之类的具体原因由拦截器提示
    if (!e.friendlyMessage) toast.error(errMsg(e, '发货失败'))
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>
