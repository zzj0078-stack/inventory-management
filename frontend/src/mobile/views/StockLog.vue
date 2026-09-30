<template>
  <div class="page">
    <div class="searchbar">
      <input
        v-model.trim="keyword"
        class="input"
        type="search"
        placeholder="商品名称 / 单号"
        @keyup.enter="reload"
      />
      <button class="btn btn-primary" @click="reload">查询</button>
    </div>

    <div class="chips">
      <button
        v-for="f in filters"
        :key="String(f.value)"
        class="chip-btn"
        :class="{ active: type === f.value }"
        @click="pick(f.value)"
      >
        {{ f.label }}
      </button>
    </div>

    <div v-if="loading && !items.length" class="loading"><div class="spinner" />加载中…</div>
    <div v-else-if="!items.length" class="empty">没有出入库记录</div>

    <template v-else>
      <div class="card card-tight">
        <div v-for="l in items" :key="l.id" class="list-item">
          <div class="between">
            <div class="grow">
              <div class="bold">{{ l.product_name || '（商品已删除）' }}</div>
              <div class="tiny muted-3 mt8">
                {{ dateTime(l.created_at) }}
                <span v-if="l.warehouse_name"> · {{ l.warehouse_name }}</span>
              </div>
            </div>
            <div class="right">
              <div class="num bold" :style="{ color: num(l.quantity) >= 0 ? '#16a34a' : '#dc2626' }">
                {{ num(l.quantity) >= 0 ? '+' : '' }}{{ l.quantity }}
              </div>
              <div class="tiny muted-3 mt8">结存 {{ l.after_quantity }}</div>
            </div>
          </div>

          <div class="between mt8">
            <span class="chip gray">{{ typeText(l.type) }}</span>
            <span v-if="l.related_no" class="tiny muted-3 num">{{ l.related_no }}</span>
          </div>
        </div>
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
import { api } from '../api'
import { num, dateTime, STOCK_LOG_TYPE } from '../util'

// 注意：后端对 type 是**精确匹配**（l.type = ?），不是前缀匹配，
// 所以这里每个选项都必须是完整的 type 值 —— 传 'transfer' 会查不到任何数据。
const filters = [
  { label: '全部', value: null },
  { label: '采购入库', value: 'purchase_in' },
  { label: '销售出库', value: 'sale_out' },
  { label: '销售退货入库', value: 'sale_return_in' },
  { label: '采购退货出库', value: 'purchase_return_out' },
  { label: '调拨入库', value: 'transfer_in' },
  { label: '调拨出库', value: 'transfer_out' },
  { label: '盘盈', value: 'adjust_in' },
  { label: '盘亏', value: 'adjust_out' },
]

const keyword = ref('')
const type = ref(null)
const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)

const hasMore = computed(() => items.value.length < total.value)

const typeText = (t) => STOCK_LOG_TYPE[t] || t || '—'

async function fetchPage(reset) {
  loading.value = true
  try {
    const res = await api.stockLogs({
      page: page.value,
      page_size: 20,
      keyword: keyword.value || undefined,
      type: type.value || undefined,
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
  type.value = v
  reload()
}

onMounted(reload)
</script>
