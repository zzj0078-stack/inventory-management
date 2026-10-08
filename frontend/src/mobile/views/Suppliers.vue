<template>
  <div class="page">
    <div class="searchbar">
      <input
        v-model.trim="keyword"
        class="input"
        type="search"
        placeholder="供应商名称 / 联系人 / 电话"
        @keyup.enter="reload"
      />
      <button class="btn btn-primary" @click="reload">查询</button>
    </div>

    <div class="field-hint" style="margin: 0 0 10px">
      这里显示的是<strong>我们欠供应商的采购款</strong>（应付）。
      金额为正=还欠着，为负=已多付（预付），0=已结清。
    </div>

    <div v-if="loading && !items.length" class="loading"><div class="spinner" />加载中…</div>
    <div v-else-if="!items.length" class="empty">没有匹配的供应商</div>

    <template v-else>
      <div class="card card-tight">
        <div v-for="s in items" :key="s.id" class="list-item">
          <div class="between">
            <div class="grow">
              <div class="bold">{{ s.name }}</div>
              <div class="tiny muted-3 mt8">
                {{ s.contact || '无联系人' }}
                <span v-if="s.phone"> · {{ s.phone }}</span>
              </div>
            </div>
            <div class="right">
              <div class="num" :style="outstandingStyle(s._amount)">
                {{ s._loading ? '…' : money0(s._amount || 0) }}
              </div>
              <div class="tiny muted-3 mt8">
                {{ payableLabel(s._amount) }}
              </div>
            </div>
          </div>

          <div class="row mt8" style="gap: 8px">
            <button class="btn btn-sm grow" @click="loadOutstanding(s, true)">刷新欠款</button>
            <button
              v-if="hasPerm('finance:add')"
              class="btn btn-sm btn-primary grow"
              @click="goPay(s)"
            >
              登记付款
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
/**
 * 采购欠款（供应商应付）。
 *
 * 与「客户欠款」对称：列表逐个异步拉 outstanding，不阻塞渲染。
 * 点「登记付款」跳到收付款页，并把供应商与「付款」类型带上，
 * 进去即可直接填金额。
 */
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

function payableLabel(v) {
  const n = num(v)
  if (n > 0) return '欠款'
  if (n < 0) return '预付'
  return '已结清'
}

async function loadOutstanding(s, force = false) {
  if (s._loaded && !force) return
  s._loading = true
  try {
    const res = await api.supplierOutstanding(s.id)
    s._amount = num(res.amount)
    s._loaded = true
  } catch {
    s._amount = 0
  } finally {
    s._loading = false
  }
}

async function fetchPage(reset) {
  loading.value = true
  try {
    const res = await api.suppliers({
      page: page.value,
      page_size: 20,
      keyword: keyword.value || undefined,
      status: 1,
    })
    const list = (res.items || []).map((s) => ({ ...s, _amount: 0, _loaded: false, _loading: false }))
    items.value = reset ? list : items.value.concat(list)
    total.value = res.total || 0
    page.value += 1
    items.value.forEach((s) => loadOutstanding(s))
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

/** 带供应商 + 付款类型进收付款页 */
function goPay(s) {
  router.push({ path: '/m/pay/new', query: { partner: s.id, ptype: 'supplier', type: 2 } })
}

onMounted(reload)
</script>
