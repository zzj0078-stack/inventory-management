<template>
  <div class="page with-tabbar">
    <div class="searchbar">
      <input
        v-model.trim="keyword"
        class="input"
        type="search"
        placeholder="单号 / 供应商"
        @keyup.enter="reload"
      />
      <button class="btn btn-primary" @click="reload">查询</button>
    </div>

    <div class="chips">
      <button
        v-for="f in filters"
        :key="String(f.value)"
        class="chip-btn"
        :class="{ active: status === f.value }"
        @click="pick(f.value)"
      >
        {{ f.label }}
      </button>
    </div>

    <div v-if="loading && !items.length" class="loading"><div class="spinner" />加载中…</div>
    <div v-else-if="!items.length" class="empty">
      没有待收货的采购单<br />
      <span class="tiny">只有「已审核」「部分收货」的采购单才需要收货</span>
    </div>

    <template v-else>
      <!-- 合计：收货员最关心「这一屏还有多少件没收」。
           选「全部」时会混进草稿/已收完的单，合计只算真正待收的。 -->
      <div v-if="pagePendingQty" class="card card-tight summary-bar">
        <div class="between">
          <span class="small muted">本页待收</span>
          <span class="bold num">{{ pagePendingQty }} 件 · {{ pendingCount }} 张单</span>
        </div>
        <div v-if="total > items.length" class="between mt8">
          <span class="tiny muted-3">已加载 {{ items.length }} / {{ total }} 张单</span>
          <span class="tiny muted-3">点底部「加载更多」继续</span>
        </div>
      </div>

      <div class="card card-tight">
        <button
          v-for="o in items"
          :key="o.id"
          class="list-item"
          @click="router.push(`/m/purchase/${o.id}`)"
        >
          <div class="between">
            <span class="bold num">{{ o.order_no }}</span>
            <span class="chip" :class="statusChip(o.status)">{{ statusText(o.status) }}</span>
          </div>

          <div class="between mt8">
            <span class="small muted ellipsis">{{ o.supplier_name || '（未指定供应商）' }}</span>
            <span class="bold num">{{ money(o.total_amount) }}</span>
          </div>

          <!-- 待收数量：这是收货时的关键信息，原来只显示金额和明细行数 -->
          <div class="between mt8">
            <span class="tiny muted-3">
              <span v-if="pendingQty(o)" class="pending-qty">待收 {{ pendingQty(o) }} 件</span>
              <!-- 筛选选「全部」时会混进草稿/已收完的单，别显示「待收 0 件」 -->
              <span v-else-if="o.status === 0" class="muted-3">未审核，暂不能收货</span>
              <span v-else class="muted-3" style="color: var(--success, #16a34a)">已收完</span>
              <span v-if="receivedQty(o)" class="muted-3"> · 已收 {{ receivedQty(o) }}</span>
            </span>
            <span class="tiny muted-3">{{ o.item_count }} 项明细</span>
          </div>

          <div class="between mt8">
            <span class="tiny muted-3">{{ o.purchase_date || shortDate(o.created_at) }}</span>
            <span v-if="o.expected_date" class="tiny muted-3">预计 {{ shortDate(o.expected_date) }}</span>
          </div>

          <div v-if="o.product_summary" class="tiny muted-3 mt8 ellipsis">
            {{ o.product_summary }}
          </div>
        </button>
      </div>

      <div class="center mt12">
        <button v-if="hasMore" class="btn btn-sm" :disabled="loading" @click="loadMore">
          {{ loading ? '加载中…' : `加载更多（还有 ${total - items.length} 条）` }}
        </button>
        <div v-else class="tiny muted-3">共 {{ total }} 条，已全部显示</div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { money, shortDate, PURCHASE_STATUS } from '../util'

const router = useRouter()

const filters = [
  { label: '待收货', value: 1 },
  { label: '部分收货', value: 2 },
  { label: '全部', value: null },
]

const keyword = ref('')
const status = ref(1)
const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)

const hasMore = computed(() => items.value.length < total.value)
const statusText = (s) => (PURCHASE_STATUS[s] ? PURCHASE_STATUS[s].t : String(s))
const statusChip = (s) => (PURCHASE_STATUS[s] ? PURCHASE_STATUS[s].c : 'gray')

/**
 * 待收数量 = 各明细 pending_quantity 之和。
 *
 * 列表接口的行里**带完整 items**（已实测），所以直接算，不用改后端。
 * 字段缺失时退回 quantity - received_quantity，再退回 quantity，
 * 保证老数据/别的接口来源也能显示出一个合理值。
 */
function pendingQty(o) {
  const list = o.items || []
  if (!list.length) return 0
  return list.reduce((s, it) => {
    const p = it.pending_quantity
    if (p !== undefined && p !== null) return s + Number(p)
    const q = Number(it.quantity) || 0
    const r = Number(it.received_quantity) || 0
    return s + Math.max(q - r, 0)
  }, 0)
}

/** 已收数量（部分收货时才有值） */
function receivedQty(o) {
  return (o.items || []).reduce((s, it) => s + (Number(it.received_quantity) || 0), 0)
}

/** 本页待收件数合计 */
const pagePendingQty = computed(() => items.value.reduce((s, o) => s + pendingQty(o), 0))

/** 本页真正待收的单数（排除草稿/已收完） */
const pendingCount = computed(() => items.value.filter((o) => pendingQty(o) > 0).length)

async function fetchPage(reset) {
  loading.value = true
  try {
    const res = await api.purchaseOrders({
      page: page.value,
      page_size: 20,
      keyword: keyword.value || undefined,
      status: status.value === null ? undefined : status.value,
    })
    const list = res.items || []
    items.value = reset ? list : items.value.concat(list)
    total.value = res.total || 0
    page.value += 1
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  items.value = []
  fetchPage(true)
}

function loadMore() {
  fetchPage(false)
}

function pick(v) {
  status.value = v
  reload()
}

onMounted(reload)
</script>

<style scoped>
/* 顶部合计条：与列表卡区分开，避免看起来像一张单 */
.summary-bar {
  background: #f8fafc;
}

/* 待收数量是这个页面的主信息，给它一点重量 */
.pending-qty {
  color: var(--warning, #d97706);
  font-weight: 600;
  font-size: 13px;
}
</style>
