<template>
  <div class="page with-tabbar">
    <div v-if="loading" class="loading"><div class="spinner" />加载中…</div>

    <template v-else>
      <!-- 今日 -->
      <div class="card">
        <div class="between">
          <div class="card-title" style="margin:0">今日经营</div>
          <span class="tiny muted-3">{{ todayStr }}</span>
        </div>
        <div class="stat-grid">
          <div class="stat">
            <div class="stat-label">销售额</div>
            <div class="stat-value num">{{ money0(d.today_sales) }}</div>
            <div class="tiny muted-3 mt8">{{ d.today_sales_count }} 笔</div>
          </div>
          <div class="stat">
            <div class="stat-label">采购额</div>
            <div class="stat-value num">{{ money0(d.today_purchase) }}</div>
            <div class="tiny muted-3 mt8">{{ d.today_purchase_count }} 笔</div>
          </div>
        </div>
      </div>

      <!-- 本月 -->
      <div class="card">
        <div class="between">
          <div class="card-title" style="margin:0">本月经营</div>
          <span class="tiny muted-3">{{ month.start.slice(5) }} 起</span>
        </div>
        <div class="stat-grid">
          <div class="stat">
            <div class="stat-label">销售额</div>
            <div class="stat-value small-v num">{{ money0(m.saleTotal) }}</div>
            <div class="tiny muted-3 mt8">{{ m.saleCount }} 笔</div>
          </div>
          <div class="stat">
            <div class="stat-label">采购额</div>
            <div class="stat-value small-v num">{{ money0(m.purchaseTotal) }}</div>
            <div class="tiny muted-3 mt8">{{ m.purchaseCount }} 笔</div>
          </div>
        </div>

        <div v-if="m.costVisible" class="stat-grid mt8">
          <div class="stat">
            <div class="stat-label">毛利</div>
            <div class="stat-value small-v num" :style="{ color: m.profit >= 0 ? '#16a34a' : '#dc2626' }">
              {{ money0(m.profit) }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">毛利率</div>
            <div class="stat-value small-v num" :style="{ color: m.profitRate >= 0 ? '#16a34a' : '#dc2626' }">
              {{ m.profitRate == null ? '—' : m.profitRate + '%' }}
            </div>
          </div>
        </div>
        <div v-else class="tiny muted-3 mt8">无成本查看权限，毛利不可见</div>
      </div>

      <!-- 应收应付 -->
      <div class="card">
        <div class="card-title">往来账款</div>
        <div class="stat-grid">
          <div class="stat">
            <div class="stat-label">应收</div>
            <div class="stat-value small-v num" :style="{ color: num(d.receivable) > 0 ? '#dc2626' : '#16a34a' }">
              {{ money0(d.receivable) }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">应付</div>
            <div class="stat-value small-v num" :style="{ color: num(d.payable) > 0 ? '#d97706' : '#16a34a' }">
              {{ money0(d.payable) }}
            </div>
          </div>
        </div>
        <button class="btn btn-sm btn-block mt12" @click="router.push('/m/boss/debts')">
          查看欠款排行 ›
        </button>
      </div>

      <!-- 待办 -->
      <div class="card">
        <div class="card-title">待办</div>
        <button
          v-if="canApprove"
          class="kv kv-tap"
          @click="router.push('/m/boss/approve')"
        >
          <span>待我审核</span>
          <span class="num" :style="pendingTotal ? 'color:#dc2626;font-weight:700' : 'color:#9ca3af'">
            {{ pendingTotal }} 张 ›
          </span>
        </button>
        <div class="kv">
          <span>已审核待发货</span>
          <span class="num" :style="num(d.pending_sales_out) ? 'color:#dc2626;font-weight:600' : ''">
            {{ d.pending_sales_out }} 张
          </span>
        </div>
        <div class="kv">
          <span>已审核待收货</span>
          <span class="num" :style="num(d.pending_purchase_in) ? 'color:#d97706;font-weight:600' : ''">
            {{ d.pending_purchase_in }} 张
          </span>
        </div>
        <div class="kv">
          <span>低库存预警</span>
          <span class="num" :style="num(d.low_stock_count) ? 'color:#d97706;font-weight:600' : ''">
            {{ d.low_stock_count }} 项
          </span>
        </div>
        <div class="kv">
          <span>库存总量</span>
          <span class="num">{{ d.inventory_total }}</span>
        </div>
      </div>

      <!-- 快捷入口 -->
      <div class="card">
        <div class="card-title">管理功能</div>
        <div class="quick-grid">
          <button v-for="q in quicks" :key="q.label" class="quick" @click="go(q)">
            <span class="quick-ico">{{ q.ico }}</span>
            <span>{{ q.label }}</span>
          </button>
        </div>
      </div>

      <!-- 近 7 天销售 -->
      <div class="card">
        <div class="between">
          <div class="card-title" style="margin:0">近 7 天销售</div>
          <span class="tiny muted-3 num">合计 {{ money0(daily.total_amount) }}</span>
        </div>
        <div class="bars">
          <div v-for="it in daily.items" :key="it.date" class="bar-col">
            <div class="bar" :class="{ zero: !num(it.amount) }" :style="{ height: barHeight(it.amount) }" />
            <div class="bar-label">{{ shortDate(it.date) }}</div>
          </div>
        </div>
      </div>

      <!-- 回员工界面 -->
      <div class="card">
        <button class="btn btn-block" @click="toStaff">
          切换到员工界面（开单 / 发货 / 收货等）
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../api'
import { hasPerm, setViewMode } from '../../store'
import { num, money0, shortDate, today, thisMonth } from '../../util'

const router = useRouter()

const loading = ref(true)
const todayStr = today()
const month = thisMonth()

const d = reactive({
  today_sales: 0,
  today_sales_count: 0,
  today_purchase: 0,
  today_purchase_count: 0,
  pending_sales_out: 0,
  pending_purchase_in: 0,
  receivable: 0,
  payable: 0,
  low_stock_count: 0,
  inventory_total: 0,
})

const m = reactive({
  saleTotal: 0,
  saleCount: 0,
  purchaseTotal: 0,
  purchaseCount: 0,
  profit: 0,
  profitRate: null,
  costVisible: false,
})

const daily = reactive({ total_amount: 0, items: [] })

const pendingSales = ref(0)
const pendingPurchase = ref(0)

const canApprove = computed(() => hasPerm('sales:approve') || hasPerm('purchase:approve'))
const pendingTotal = computed(() => pendingSales.value + pendingPurchase.value)

const quicks = computed(() => {
  const list = []
  if (canApprove.value) list.push({ ico: '审', label: '待我审核', to: '/m/boss/approve' })
  if (hasPerm('report:view')) list.push({ ico: '报', label: '经营报表', to: '/m/boss/reports' })
  if (hasPerm('finance:view')) list.push({ ico: '欠', label: '欠款排行', to: '/m/boss/debts' })
  // 与员工界面保持一致：欠款分「客户欠我们」和「我们欠供应商」两边
  if (hasPerm('customer:view')) list.push({ ico: '客', label: '客户欠款', to: '/m/customers' })
  if (hasPerm('supplier:view')) list.push({ ico: '采', label: '采购欠款', to: '/m/suppliers' })
  if (hasPerm('finance:add')) list.push({ ico: '￥', label: '收付款', to: '/m/pay/new' })
  if (hasPerm('sales:view')) list.push({ ico: '单', label: '销售单', to: '/m/sales' })
  if (hasPerm('inventory:view')) list.push({ ico: '库', label: '库存价格', to: '/m/stock' })
  if (hasPerm('purchase:receive')) list.push({ ico: '收', label: '采购收货', to: '/m/purchase/receive' })
  return list
})

function barHeight(amount) {
  const max = Math.max(...daily.items.map((x) => num(x.amount)), 1)
  return `${Math.max((num(amount) / max) * 100, 4)}%`
}

function go(q) {
  router.push(q.to)
}

function toStaff() {
  setViewMode('staff')
  router.replace('/m')
}

onMounted(async () => {
  const range = { start_date: month.start, end_date: month.end }

  // 每项独立容错：某个报表没权限/失败，不该把整页拖成空白
  const [dash, sales, purchase, profit, week, ps, pp] = await Promise.allSettled([
    api.dashboard(),
    api.salesReport(range),
    api.purchaseReport(range),
    api.profitReport(range),
    api.salesDaily(7),
    api.salesOrders({ status: 0, page_size: 1 }),
    api.purchaseOrders({ status: 0, page_size: 1 }),
  ])

  if (dash.status === 'fulfilled') Object.assign(d, dash.value)

  if (sales.status === 'fulfilled') {
    m.saleTotal = num(sales.value.total_amount)
    m.saleCount = num(sales.value.order_count)
  }
  if (purchase.status === 'fulfilled') {
    m.purchaseTotal = num(purchase.value.total_amount)
    m.purchaseCount = num(purchase.value.order_count)
  }
  if (profit.status === 'fulfilled') {
    m.costVisible = !!profit.value.cost_visible
    m.profit = num(profit.value.profit)
    m.profitRate = profit.value.profit_rate
  }
  if (week.status === 'fulfilled') {
    daily.total_amount = num(week.value.total_amount)
    daily.items = week.value.items || []
  }
  if (ps.status === 'fulfilled') pendingSales.value = num(ps.value.total)
  if (pp.status === 'fulfilled') pendingPurchase.value = num(pp.value.total)

  loading.value = false
})
</script>
