<template>
  <div class="page with-tabbar">
    <!-- 待审类型：只显示当前账号有审核权的 -->
    <div class="chips">
      <button
        v-for="t in types"
        :key="t.key"
        class="chip-btn"
        :class="{ active: kind === t.key }"
        @click="switchKind(t.key)"
      >
        {{ t.label }}
      </button>
    </div>

    <div v-if="loading && !items.length" class="loading"><div class="spinner" />加载中…</div>

    <div v-else-if="!items.length" class="empty">
      没有待审核的{{ kindLabel }}<br />
      <span class="tiny">新建的单据默认是「草稿」，审核后才进入后续流程</span>
    </div>

    <template v-else>
      <div class="card card-tight">
        <div v-for="o in items" :key="o.id" class="list-item">
          <div class="between" @click="open(o)">
            <span class="bold num">{{ o.order_no }}</span>
            <span class="chip gray">{{ statusText(o.status) }}</span>
          </div>

          <div class="between mt8" @click="open(o)">
            <span class="small muted ellipsis">{{ partnerOf(o) }}</span>
            <span class="bold num">{{ money(o.total_amount) }}</span>
          </div>

          <div class="between mt8">
            <span class="tiny muted-3">{{ dateOf(o) }}</span>
            <span v-if="o.item_count" class="tiny muted-3">{{ o.item_count }} 项</span>
          </div>

          <div class="row mt8" style="gap: 8px">
            <button class="btn btn-sm grow" @click="open(o)">查看明细</button>
            <button class="btn btn-sm btn-primary grow" :disabled="busyId === o.id" @click="approve(o)">
              {{ busyId === o.id ? '处理中…' : '审核通过' }}
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
import { api, errMsg } from '../../api'
import { hasPerm, toast, confirmSheet } from '../../store'
import { money, shortDate, SALE_STATUS, PURCHASE_STATUS } from '../../util'

const router = useRouter()

/** 有审核权才有对应页签 */
const allTypes = [
  { key: 'sales', label: '销售单', perm: 'sales:approve' },
  { key: 'purchase', label: '采购单', perm: 'purchase:approve' },
]
const types = allTypes.filter((t) => hasPerm(t.perm))

const kind = ref(types.length ? types[0].key : 'sales')
const kindLabel = computed(() => (allTypes.find((t) => t.key === kind.value) || {}).label || '单据')

const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const busyId = ref(null)

const hasMore = computed(() => items.value.length < total.value)
const STATUS = computed(() => (kind.value === 'sales' ? SALE_STATUS : PURCHASE_STATUS))
const statusText = (s) => (STATUS.value[s] ? STATUS.value[s].t : String(s))

const partnerOf = (o) =>
  kind.value === 'sales' ? o.customer_name || '（未指定客户）' : o.supplier_name || '（未指定供应商）'

const dateOf = (o) =>
  (kind.value === 'sales' ? o.sale_date : o.purchase_date) || shortDate(o.created_at)

async function fetchPage(reset) {
  loading.value = true
  try {
    const params = { page: page.value, page_size: 20, status: 0 }
    const res =
      kind.value === 'sales' ? await api.salesOrders(params) : await api.purchaseOrders(params)
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

function switchKind(k) {
  if (kind.value === k) return
  kind.value = k
  reload()
}

function open(o) {
  router.push(kind.value === 'sales' ? `/m/sales/${o.id}` : `/m/purchase/${o.id}`)
}

async function approve(o) {
  const okConfirm = await confirmSheet({
    title: '审核通过',
    message: `${o.order_no}\n${partnerOf(o)}\n金额 ${money(o.total_amount)}`,
    confirmText: '确认审核',
  })
  if (!okConfirm) return

  busyId.value = o.id
  try {
    if (kind.value === 'sales') await api.approveSalesOrder(o.id)
    else await api.approvePurchaseOrder(o.id)
    toast.success('已审核通过')
    // 审核后单据离开「草稿」，重新拉这一页即可
    reload()
  } catch (e) {
    toast.error(errMsg(e, '审核失败'))
  } finally {
    busyId.value = null
  }
}

onMounted(() => {
  if (!types.length) {
    // 没有任何审核权：不该走到这里（Tab 也不会出现），兜底回看板
    toast.info('当前账号没有审核权限')
    router.replace('/m/boss')
    return
  }
  reload()
})
</script>
