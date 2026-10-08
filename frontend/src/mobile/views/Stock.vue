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
                <span v-if="hasPerm('product:cost')" class="muted-3"> / 采购 {{ money(it.purchase_price) }}</span>
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

      <MPager
        :page="page"
        :total="total"
        :page-size="PAGE_SIZE"
        :loading="loading"
        @change="goPage"
      />
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'
import { money, num } from '../util'
import { hasPerm } from '../store'
import MPager from '../components/MPager.vue'

const PAGE_SIZE = 20

const keyword = ref('')
const warehouseId = ref(null)
const onlyLow = ref(false)
const warehouses = ref([])

const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)

function stockStyle(it) {
  const q = num(it.quantity)
  if (q <= 0) return 'color:#9ca3af'
  if (it.low) return 'color:#d97706;font-weight:700'
  return 'color:#16a34a;font-weight:700'
}

/** 取指定页并整体替换列表（分页语义，不做累加） */
async function fetchPage(p) {
  loading.value = true
  try {
    const res = await api.inventory({
      page: p,
      page_size: PAGE_SIZE,
      keyword: keyword.value || undefined,
      warehouse_id: warehouseId.value || undefined,
      low_stock: onlyLow.value ? 'true' : undefined,
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
