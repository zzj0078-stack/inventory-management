<template>
  <div class="page with-tabbar">
    <!-- 搜索 + 仓库筛选 -->
    <div class="searchbar">
      <input
        v-model.trim="keyword"
        class="input"
        type="search"
        placeholder="商品名称 / 编码"
        @keyup.enter="reload"
      />
      <button class="btn btn-primary" @click="reload">查询</button>
    </div>

    <div class="chips">
      <button
        class="chip-btn"
        :class="{ active: onlyLow }"
        @click="toggleLow"
      >
        仅看低库存
      </button>
      <button
        class="chip-btn"
        :class="{ active: !warehouseId }"
        @click="pickWarehouse(null)"
      >
        全部仓库
      </button>
      <button
        v-for="w in warehouses"
        :key="w.id"
        class="chip-btn"
        :class="{ active: warehouseId === w.id }"
        @click="pickWarehouse(w.id)"
      >
        {{ w.name }}
      </button>
    </div>

    <div v-if="loading && !items.length" class="loading"><div class="spinner" />加载中…</div>

    <div v-else-if="!items.length" class="empty">
      没有匹配的库存记录<br />
      <span class="tiny">换个关键词，或先到桌面端建立商品资料</span>
    </div>

    <template v-else>
      <div class="card card-tight">
        <div v-for="it in items" :key="it.id" class="list-item">
          <div class="between" style="align-items: flex-start">
            <div class="grow">
              <div class="bold">{{ it.product_name }}</div>
              <div class="tiny muted-3 mt8">
                <span v-if="it.product_sku">{{ it.product_sku }}</span>
                <span v-if="it.product_spec"> · {{ it.product_spec }}</span>
                <span> · {{ it.warehouse_name }}</span>
              </div>
              <div class="small muted mt8">
                售价 <span class="num" style="color:#2f6fed;font-weight:600">{{ money(it.sale_price) }}</span>
                <span class="muted-3"> / 采购 {{ money(it.purchase_price) }}</span>
              </div>
            </div>
            <div class="right">
              <div class="num" :style="stockStyle(it)">
                {{ it.quantity }}
                <span class="tiny">{{ it.product_unit || '' }}</span>
              </div>
              <div v-if="it.low" class="tiny mt8" style="color: #d97706">低于最低 {{ it.min_stock }}</div>
            </div>
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
import { money, num } from '../util'

const keyword = ref('')
const warehouseId = ref(null)
const onlyLow = ref(false)
const warehouses = ref([])

const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)

const hasMore = computed(() => items.value.length < total.value)

function stockStyle(it) {
  const q = num(it.quantity)
  if (q <= 0) return 'color:#9ca3af'
  if (it.low) return 'color:#d97706;font-weight:700'
  return 'color:#16a34a;font-weight:700'
}

async function fetchPage(reset) {
  loading.value = true
  try {
    const res = await api.inventory({
      page: page.value,
      page_size: 20,
      keyword: keyword.value || undefined,
      warehouse_id: warehouseId.value || undefined,
      low_stock: onlyLow.value ? 'true' : undefined,
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

function pickWarehouse(id) {
  warehouseId.value = id
  reload()
}

function toggleLow() {
  onlyLow.value = !onlyLow.value
  reload()
}

onMounted(async () => {
  try {
    warehouses.value = (await api.warehouses()) || []
  } catch {
    warehouses.value = []
  }
  reload()
})
</script>
