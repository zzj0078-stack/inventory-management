<template>
  <div class="page">
    <div class="searchbar">
      <input
        v-model.trim="keyword"
        class="input"
        type="search"
        placeholder="客户名称 / 联系人 / 电话"
        @keyup.enter="reload"
      />
      <button class="btn btn-primary" @click="reload">查询</button>
    </div>

    <div v-if="loading && !items.length" class="loading"><div class="spinner" />加载中…</div>
    <div v-else-if="!items.length" class="empty">没有匹配的客户</div>

    <template v-else>
      <div class="card card-tight">
        <div v-for="c in items" :key="c.id" class="list-item">
          <div class="between tappable" @click="openStatement(c)">
            <div class="grow">
              <div class="bold">{{ c.name }}</div>
              <div class="tiny muted-3 mt8">
                {{ c.contact || '无联系人' }}
                <span v-if="c.phone"> · {{ c.phone }}</span>
              </div>
            </div>
            <div class="right">
              <div class="num" :style="outstandingStyle(c._amount)">
                {{ c._loading ? '…' : money0(c._amount || 0) }}
              </div>
              <div class="tiny muted-3 mt8">
                {{ (c._amount || 0) > 0 ? '欠款' : (c._amount || 0) < 0 ? '预收' : '已结清' }}
                <span> ›</span>
              </div>
            </div>
          </div>

          <div class="row mt8" style="gap: 8px">
            <button class="btn btn-sm grow" @click="loadOutstanding(c, true)">刷新欠款</button>
            <button
              v-if="hasPerm('finance:add')"
              class="btn btn-sm btn-primary grow"
              @click="goPay(c)"
            >
              登记收款
            </button>
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
import { useRouter } from 'vue-router'
import { api } from '../api'
import { hasPerm } from '../store'
import { money0, num } from '../util'

const router = useRouter()

const keyword = ref('')
const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)

const hasMore = computed(() => items.value.length < total.value)

function outstandingStyle(v) {
  const n = num(v)
  if (n > 0) return 'color:#dc2626;font-weight:700'
  if (n < 0) return 'color:#16a34a;font-weight:700'
  return 'color:#9ca3af'
}

async function loadOutstanding(c, force = false) {
  if (c._loaded && !force) return
  c._loading = true
  try {
    const res = await api.customerOutstanding(c.id)
    c._amount = num(res.amount)
    c._loaded = true
  } catch {
    c._amount = 0
  } finally {
    c._loading = false
  }
}

async function fetchPage(reset) {
  loading.value = true
  try {
    const res = await api.customers({
      page: page.value,
      page_size: 20,
      keyword: keyword.value || undefined,
      status: 1,
    })
    const list = (res.items || []).map((c) => ({ ...c, _amount: 0, _loaded: false, _loading: false }))
    items.value = reset ? list : items.value.concat(list)
    total.value = res.total || 0
    page.value += 1
    // 欠款逐个异步拉，不阻塞列表渲染（客户数不多，够用）
    items.value.forEach((c) => loadOutstanding(c))
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

/** 带客户 + 收款类型进收付款页 */
function goPay(c) {
  router.push({ path: '/m/pay/new', query: { partner: c.id, ptype: 'customer', type: 1 } })
}

/** 点击行主体查看该客户的对账单 */
function openStatement(c) {
  router.push({ path: '/m/statement', query: { side: 'customer', partner_id: c.id } })
}

onMounted(reload)
</script>
