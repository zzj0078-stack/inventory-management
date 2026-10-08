<template>
  <div class="page with-tabbar">
    <!--
      收货入口：只给有收货权限的人（仓库/管理员）。
      放在搜索与筛选**之前** —— 它是页面级入口，和下面的列表筛选无关，
      夹在筛选栏与列表之间会被误读成一条数据行。
    -->
    <button v-if="canReceive" class="entry-row" @click="router.push('/m/purchase/receive')">
      <span class="entry-main">
        <span class="entry-title">采购收货</span>
        <span class="tiny muted-3">待收货清单，按单登记入库</span>
      </span>
      <span class="muted-3">›</span>
    </button>

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

    <!-- 收货入口在页面顶部 -->

    <div v-if="loading && !items.length" class="loading"><div class="spinner" />加载中…</div>
    <div v-else-if="!items.length" class="empty">没有匹配的采购单</div>

    <template v-else>
      <div class="card card-tight">
        <button v-for="o in items" :key="o.id" class="list-item" @click="open(o)">
          <div class="between">
            <span class="bold num">{{ o.order_no }}</span>
            <span class="chip" :class="statusChip(o.status)">{{ statusText(o.status) }}</span>
          </div>

          <div class="between mt8">
            <span class="small muted ellipsis">{{ o.supplier_name || '（未指定供应商）' }}</span>
            <span class="bold num">{{ money(o.total_amount) }}</span>
          </div>

          <div class="between mt8">
            <span class="tiny muted-3">{{ o.purchase_date || shortDate(o.created_at) }}</span>
            <span v-if="o.item_count" class="tiny muted-3">{{ o.item_count }} 项</span>
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

    <!-- 开采购单：与销售单页的悬浮按钮一致，按 purchase:add 控制 -->
    <button
      v-if="canAdd"
      class="fab"
      aria-label="开采购单"
      @click="router.push('/m/purchase/new')"
    >＋</button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { hasPerm } from '../store'
import { money, shortDate, PURCHASE_STATUS } from '../util'

const router = useRouter()
const canReceive = hasPerm('purchase:receive')
const canAdd = hasPerm('purchase:add')

const filters = [
  { label: '全部', value: null },
  { label: '草稿', value: 0 },
  { label: '已审核', value: 1 },
  { label: '部分收货', value: 2 },
  { label: '已收货', value: 3 },
  { label: '已退货', value: 6 },
]

const keyword = ref('')
const status = ref(null)
const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)

const hasMore = computed(() => items.value.length < total.value)

const statusText = (s) => (PURCHASE_STATUS[s] ? PURCHASE_STATUS[s].t : String(s))
const statusChip = (s) => (PURCHASE_STATUS[s] ? PURCHASE_STATUS[s].c : 'gray')

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

function open(o) {
  router.push(`/m/purchase/${o.id}`)
}

onMounted(reload)
</script>
