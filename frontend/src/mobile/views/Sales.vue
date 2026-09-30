<template>
  <div class="page with-tabbar">
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
          style="width: 100%; text-align: left; border: 0; background: transparent"
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
            <span v-if="o.item_count" class="tiny muted-3">{{ o.item_count }} 项 · {{ o.product_summary }}</span>
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

    <button v-if="hasPerm('sales:add')" class="fab" aria-label="开销售单" @click="router.push('/m/sales/new')">＋</button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { hasPerm } from '../store'
import { money, shortDate, SALE_STATUS } from '../util'

const router = useRouter()

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

const hasMore = computed(() => items.value.length < total.value)

const statusText = (s) => (SALE_STATUS[s] ? SALE_STATUS[s].t : String(s))
const statusChip = (s) => (SALE_STATUS[s] ? SALE_STATUS[s].c : 'gray')

async function fetchPage(reset) {
  loading.value = true
  try {
    const res = await api.salesOrders({
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

function open(o) {
  router.push(`/m/sales/${o.id}`)
}

onMounted(reload)
</script>
