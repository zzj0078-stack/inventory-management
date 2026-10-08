<template>
  <div class="page with-tabbar" :class="{ 'has-fab': hasPerm('sales:add') }">
    <div class="searchbar">
      <input
        v-model.trim="keyword"
        class="input"
        type="search"
        placeholder="单号 / 客户 / 联系人 / 电话"
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
      没有匹配的销售单
    </div>

    <template v-else>
      <div class="card card-tight">
        <button
          v-for="o in items"
          :key="o.id"
          class="list-item"
          @click="open(o)"
        >
          <div class="between">
            <span class="bold num">{{ o.order_no }}</span>
            <span class="chip" :class="statusChip(o.status)">{{ statusText(o.status) }}</span>
          </div>

          <div class="between mt8">
            <span class="small muted ellipsis">{{ o.customer_name || '（未指定客户）' }}</span>
            <span class="bold num">{{ money(o.total_amount) }}</span>
          </div>

          <div class="between mt8">
            <span class="tiny muted-3">{{ o.sale_date || shortDate(o.created_at) }}</span>
            <span class="tiny muted-3">
              <span v-if="settleChip(o)" class="chip" :class="settleChip(o).c">{{ settleChip(o).t }}</span>
              <template v-if="o.item_count"> {{ o.item_count }} 项 · {{ o.product_summary }}</template>
            </span>
          </div>
        </button>
      </div>

      <MPager
        :page="page"
        :total="total"
        :page-size="PAGE_SIZE"
        :loading="loading"
        @change="goPage"
      />
    </template>

    <button v-if="hasPerm('sales:add')" class="fab" aria-label="开销售单" @click="router.push('/m/sales/new')">＋</button>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { hasPerm } from '../store'
import { money, shortDate, SALE_STATUS } from '../util'
import MPager from '../components/MPager.vue'

const router = useRouter()
const PAGE_SIZE = 20

const filters = [
  { label: '全部', value: null },
  { label: '草稿', value: 0 },
  { label: '已审核', value: 1 },
  { label: '部分发货', value: 2 },
  { label: '已发货', value: 3 },
  { label: '已退货', value: 6 },
]

const keyword = ref('')
const status = ref(null)

const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)

const statusText = (s) => (SALE_STATUS[s] ? SALE_STATUS[s].t : String(s))
const statusChip = (s) => (SALE_STATUS[s] ? SALE_STATUS[s].c : 'gray')

/**
 * 结清标签：数据来自后端按收付款核销算出的 settlement。
 * 草稿单不参与结算（settlement='na'），不显示标签，避免误以为"未结清"。
 */
const SETTLE_CHIP = {
  settled: { t: '已结清', c: 'green' },
  partial: { t: '部分结清', c: 'orange' },
  unsettled: { t: '未结清', c: 'gray' },
}
const settleChip = (o) => SETTLE_CHIP[o.settlement] || null

/** 取指定页并整体替换列表（分页语义，不做累加） */
async function fetchPage(p) {
  loading.value = true
  try {
    const res = await api.salesOrders({
      page: p,
      page_size: PAGE_SIZE,
      keyword: keyword.value || undefined,
      status: status.value === null ? undefined : status.value,
    })
    items.value = res.items || []
    total.value = res.total || 0
    page.value = p
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  fetchPage(1)
}

function goPage(p) {
  fetchPage(p).then(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
}

function pick(v) {
  status.value = v
  reload()
}

function open(o) {
  router.push(`/m/sales/${o.id}`)
}

onMounted(reload)
</script>
