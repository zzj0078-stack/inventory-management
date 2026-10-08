<template>
  <div class="page with-tabbar">
    <div v-if="loading" class="loading"><div class="spinner" />加载中…</div>

    <template v-else>
      <!-- 今日概览 -->
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">今日销售</div>
          <div class="stat-value num">{{ money0(d.today_sales) }}</div>
          <div class="tiny muted-3 mt8">{{ d.today_sales_count }} 笔</div>
        </div>
        <div class="stat">
          <div class="stat-label">今日采购</div>
          <div class="stat-value num">{{ money0(d.today_purchase) }}</div>
          <div class="tiny muted-3 mt8">{{ d.today_purchase_count }} 笔</div>
        </div>
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

      <!-- 待办 -->
      <div class="card mt12">
        <div class="card-title">待处理</div>
        <div class="kv">
          <span>待发货销售单</span>
          <span class="num" :style="num(d.pending_sales_out) ? 'color:#dc2626;font-weight:600' : ''">
            {{ d.pending_sales_out }} 张
          </span>
        </div>
        <div class="kv">
          <span>待收货采购单</span>
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
        <div class="card-title">常用功能</div>
        <div class="quick-grid">
          <button v-for="q in quicks" :key="q.to" class="quick" @click="go(q)">
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
            <div
              class="bar"
              :class="{ zero: !num(it.amount) }"
              :style="{ height: barHeight(it.amount) }"
            />
            <div class="bar-label">{{ shortDate(it.date) }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { hasPerm } from '../store'
import { num, money0, shortDate } from '../util'

const router = useRouter()
const loading = ref(true)
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
const daily = reactive({ total_amount: 0, items: [] })

/**
 * 常用功能：固定这 6 项，按业务顺序排列（单据 → 收付 → 对账 → 库存）。
 *
 * 欠款不再单列入口：客户欠款 / 采购欠款两个页面仍然保留（对账单里点不开时
 * 还可从「我的」进入），但欠款本身改由「对账单」承载 —— 对账单既能看欠款
 * 余额，也能看每一笔是怎么来的。
 * 开单/收货入口也从这里移除，改由对应 Tab 页右下角的「＋」和「采购收货」进入。
 */
const allQuicks = [
  { label: '采购单', ico: '购', to: '/m/purchase', perm: 'purchase:view' },
  { label: '销售单', ico: '单', to: '/m/sales', perm: 'sales:view' },
  { label: '收付款', ico: '￥', to: '/m/pay/new', perm: 'finance:add' },
  // 对账单：客户或供应商任一权限即可（hasPerm 支持数组，OR 语义）
  { label: '对账单', ico: '账', to: '/m/statement', perm: ['customer:view', 'supplier:view'] },
  { label: '库存', ico: '库', to: '/m/stock', perm: 'inventory:view' },
  { label: '出入库明细', ico: '流', to: '/m/logs', perm: 'stocklog:view' },
]

// 只显示当前账号有权限的入口
const quicks = allQuicks.filter((q) => hasPerm(q.perm))

function barHeight(amount) {
  const values = daily.items.map((x) => num(x.amount))
  const max = Math.max(...values, 1)
  const pct = (num(amount) / max) * 100
  return `${Math.max(pct, 4)}%`
}

function go(q) {
  router.push(q.to)
}

onMounted(async () => {
  try {
    const [dash, week] = await Promise.all([
      api.dashboard(),
      api.salesDaily(7),
    ])
    Object.assign(d, dash)
    daily.total_amount = week.total_amount
    daily.items = week.items || []
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false
  }
})
</script>
