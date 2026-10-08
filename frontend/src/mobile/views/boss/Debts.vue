<template>
  <div class="page">
    <!-- 应收应付汇总 -->
    <div class="card">
      <div class="card-title">往来账款</div>
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">应收</div>
          <div class="stat-value small-v num" :style="{ color: num(r.receivable) > 0 ? '#dc2626' : '#16a34a' }">
            {{ money0(r.receivable) }}
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">应付</div>
          <div class="stat-value small-v num" :style="{ color: num(r.payable) > 0 ? '#d97706' : '#16a34a' }">
            {{ money0(r.payable) }}
          </div>
        </div>
      </div>

      <template v-if="showDetail">
        <div class="card-title mt16">应收口径</div>
        <div class="kv"><span>销售总额</span><span class="num">{{ money0(r.sales_total) }}</span></div>
        <div class="kv"><span>已收客户货款</span><span class="num">−{{ money0(r.recv_from_customer) }}</span></div>
        <div class="kv"><span>退款给客户</span><span class="num">+{{ money0(r.refund_to_customer) }}</span></div>
        <div class="kv"><span>销售退货</span><span class="num">−{{ money0(r.sale_returned) }}</span></div>

        <div class="card-title mt16">应付口径</div>
        <div class="kv"><span>采购总额</span><span class="num">{{ money0(r.purchase_total) }}</span></div>
        <div class="kv"><span>已付供应商货款</span><span class="num">−{{ money0(r.paid_to_supplier) }}</span></div>
        <div class="kv"><span>收供应商退款</span><span class="num">+{{ money0(r.refund_from_supplier) }}</span></div>
        <div class="kv"><span>采购退货</span><span class="num">−{{ money0(r.purchase_returned) }}</span></div>
      </template>

      <button class="btn btn-sm btn-block mt12" @click="showDetail = !showDetail">
        {{ showDetail ? '收起明细口径' : '展开明细口径' }}
      </button>
    </div>

    <!-- 客户欠款排行 -->
    <div class="card">
      <div class="between">
        <div class="card-title" style="margin:0">客户欠款排行</div>
        <span v-if="!loadingList" class="tiny muted-3">{{ done }}/{{ scoped }} 已计算</span>
        <span v-else class="tiny muted-3">已计算 {{ done }}/{{ scoped }}</span>
      </div>

      <div v-if="loadingList" class="rank-track mt8">
        <div class="rank-fill" :style="{ width: progress }" />
      </div>

      <div v-if="!rows.length && !loadingList" class="tiny muted-3 mt8">没有欠款客户</div>

      <div
        v-for="(c, i) in rows"
        :key="c.id"
        class="rank"
        @click="goCustomer(c)"
      >
        <div class="rank-head">
          <span class="rank-name">
            <span class="tiny muted-3">{{ i + 1 }}.</span> {{ c.name }}
          </span>
          <span class="rank-amt" style="color:#dc2626">{{ money0(c.amount) }}</span>
        </div>
        <div class="rank-track">
          <div class="rank-fill" :style="{ width: barWidth(c.amount) }" />
        </div>
      </div>

      <div v-if="scoped < totalCustomers" class="tiny muted-3 mt12">
        共 {{ totalCustomers }} 个启用客户，此处只统计前 {{ scoped }} 个
      </div>
      <div v-else-if="rows.length" class="tiny muted-3 mt12">已统计全部 {{ scoped }} 个启用客户</div>
    </div>

    <div class="card">
      <button class="btn btn-block" @click="router.push('/m/customers')">查看完整客户列表</button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../api'
import { hasPerm } from '../../store'
import { num, money0 } from '../../util'

const router = useRouter()

/** 一次统计的客户上限：每个客户一次 outstanding 请求，太多会把手机网络拖垮 */
const SCOPE = 100
/** 并发数：3G/4G 下再高容易整批超时 */
const CONCURRENCY = 6
/** 排行显示条数 */
const TOP = 20

const r = reactive({
  receivable: 0,
  payable: 0,
  sales_total: 0,
  purchase_total: 0,
  recv_from_customer: 0,
  refund_to_customer: 0,
  paid_to_supplier: 0,
  refund_from_supplier: 0,
  sale_returned: 0,
  purchase_returned: 0,
})

const showDetail = ref(false)
const rows = ref([])
const totalCustomers = ref(0)
const scoped = ref(0)
const done = ref(0)
const loadingList = ref(false)

const progress = computed(() => (scoped.value ? `${(done.value / scoped.value) * 100}%` : '0%'))

function barWidth(amount) {
  const max = rows.value.length ? num(rows.value[0].amount) : 0
  if (!max) return '0%'
  return `${Math.max((num(amount) / max) * 100, 3)}%`
}

function goCustomer(c) {
  // 有收款权限就直接进登记收款（带上客户），否则去客户列表
  if (hasPerm('finance:add')) router.push({ path: '/m/pay/new', query: { partner: c.id } })
  else router.push('/m/customers')
}

async function loadSummary() {
  try {
    Object.assign(r, await api.receivables())
  } catch {
    /* 拦截器已提示 */
  }
}

async function loadRank() {
  loadingList.value = true
  try {
    const res = await api.customers({ page: 1, page_size: SCOPE, status: 1 })
    const list = res.items || []
    totalCustomers.value = num(res.total)
    scoped.value = list.length
    done.value = 0

    // 结果边到边排：老板不用等全部算完就能看到头部
    const found = []
    const commit = () => {
      rows.value = found.slice().sort((a, b) => b.amount - a.amount).slice(0, TOP)
    }

    const tasks = list.map((c) => async () => {
      try {
        const o = await api.customerOutstanding(c.id)
        const amount = num(o.amount)
        if (amount > 0) {
          found.push({ id: c.id, name: c.name, amount })
          commit()
        }
      } catch {
        /* 单个客户失败不拖垮整页 */
      } finally {
        done.value += 1
      }
    })

    // 固定并发：按步长切片，避免同时打出上百个请求
    const workers = []
    for (let i = 0; i < Math.min(CONCURRENCY, tasks.length); i++) {
      workers.push(
        (async () => {
          for (let j = i; j < tasks.length; j += CONCURRENCY) await tasks[j]()
        })()
      )
    }
    await Promise.all(workers)
  } catch {
    /* 拦截器已提示 */
  } finally {
    loadingList.value = false
  }
}

onMounted(() => {
  loadSummary()
  loadRank()
})
</script>
