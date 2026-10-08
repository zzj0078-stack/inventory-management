<template>
  <div class="page with-tabbar">
    <div v-if="!canView" class="empty">当前账号没有报表查看权限</div>

    <template v-else>
      <!-- 时间区间（库存报表与时间无关，隐藏） -->
      <div v-if="kind !== 'inventory'" class="chips">
        <button
          v-for="r in ranges"
          :key="r.key"
          class="chip-btn"
          :class="{ active: rangeKey === r.key }"
          @click="pickRange(r.key)"
        >
          {{ r.label }}
        </button>
      </div>

      <!-- 报表类型 -->
      <div class="chips">
        <button
          v-for="t in types"
          :key="t.key"
          class="chip-btn"
          :class="{ active: kind === t.key }"
          @click="pickKind(t.key)"
        >
          {{ t.label }}
        </button>
      </div>

      <div v-if="loading" class="loading"><div class="spinner" />统计中…</div>

      <template v-else>
        <div v-if="!costVisible && kind !== 'sales' && kind !== 'purchase'" class="card">
          <div class="tiny muted-3">无成本查看权限，成本与毛利不可见</div>
        </div>

        <!-- 概要 -->
        <div class="card">
          <div class="between">
            <div class="card-title" style="margin:0">{{ kindLabel }}概要</div>
            <span v-if="kind !== 'inventory'" class="tiny muted-3">{{ rangeLabel }}</span>
          </div>
          <div class="stat-grid">
            <div v-for="s in summary" :key="s.label" class="stat">
              <div class="stat-label">{{ s.label }}</div>
              <div class="stat-value small-v num" :style="s.color ? { color: s.color } : null">{{ s.value }}</div>
            </div>
          </div>
        </div>

        <!-- 排行 -->
        <div v-for="g in groups" :key="g.title" class="card">
          <div class="between">
            <div class="card-title" style="margin:0">{{ g.title }}</div>
            <span class="tiny muted-3">{{ g.rows.length }} 项</span>
          </div>
          <div v-if="!g.rows.length" class="tiny muted-3">该区间没有数据</div>
          <div v-else>
            <div v-for="r in g.rows" :key="r.name" class="rank">
              <div class="rank-head">
                <span class="rank-name">{{ r.name }}</span>
                <span class="rank-amt">{{ r.amountText }}</span>
              </div>
              <div class="rank-track">
                <div class="rank-fill" :style="{ width: pct(r.amount, g.max) }" />
              </div>
              <div v-if="r.sub" class="rank-sub">{{ r.sub }}</div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../../api'
import { hasPerm } from '../../store'
import { num, money0, money, thisMonth, lastMonth, recentDays, today } from '../../util'

const canView = hasPerm('report:view')

const ranges = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '近 7 天' },
  { key: 'month', label: '本月' },
  { key: 'lastMonth', label: '上月' },
]

const types = [
  { key: 'sales', label: '销售' },
  { key: 'purchase', label: '采购' },
  { key: 'profit', label: '利润' },
  { key: 'inventory', label: '库存' },
]

const rangeKey = ref('month')
const kind = ref('sales')
const loading = ref(true)

const summary = ref([])
const groups = ref([])
const costVisible = ref(true)

const kindLabel = computed(() => (types.find((t) => t.key === kind.value) || {}).label || '')

function rangeOf(key) {
  if (key === 'today') return { start: today(), end: today(), label: '今天' }
  if (key === 'week') return { ...recentDays(7), label: '近 7 天' }
  if (key === 'lastMonth') return { ...lastMonth(), label: '上月' }
  return { ...thisMonth(), label: '本月' }
}

const rangeLabel = computed(() => rangeOf(rangeKey.value).label)

/** 横条占比：最大项 = 100% */
function pct(v, max) {
  if (!max) return '0%'
  return `${Math.max((num(v) / max) * 100, 2)}%`
}

function ranks(rows, mapper) {
  const mapped = rows.map(mapper)
  const max = Math.max(...mapped.map((r) => num(r.amount)), 1)
  return { rows: mapped, max }
}

const TOP = 20
const top = (arr) => (arr || []).slice(0, TOP)

async function load() {
  if (!canView) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    if (kind.value === 'inventory') {
      const r = await api.inventoryReport()
      costVisible.value = !!r.cost_visible
      summary.value = [
        { label: '库存总量', value: String(num(r.total_qty)) },
        { label: '库存总值', value: r.total_value == null ? '—' : money0(r.total_value) },
        { label: '低库存项', value: String((r.items || []).filter((x) => x.low).length), color: '#d97706' },
        { label: '明细条数', value: String((r.items || []).length) },
      ]
      // 低库存优先，其次按金额；明细可能上千条，只画前 50 条
      const all = [...(r.items || [])].sort(
        (a, b) => Number(b.low) - Number(a.low) || num(b.value) - num(a.value)
      )
      const shown = all.slice(0, 50)
      groups.value = [
        {
          title: `库存明细（共 ${all.length} 条${all.length > shown.length ? `，显示前 ${shown.length}` : ''}）`,
          ...ranks(shown, (x) => ({
            name: `${x.product_name}${x.warehouse_name ? ' · ' + x.warehouse_name : ''}`,
            amount: num(x.value),
            amountText: x.value == null ? `${x.quantity}` : money0(x.value),
            sub: `数量 ${x.quantity}${x.low ? ' · 低于最低库存 ' + x.min_stock : ''}`,
          })),
        },
      ]
      return
    }

    const range = { start_date: rangeOf(rangeKey.value).start, end_date: rangeOf(rangeKey.value).end }

    if (kind.value === 'sales') {
      const r = await api.salesReport(range)
      summary.value = [
        { label: '销售额', value: money0(r.total_amount) },
        { label: '单据数', value: String(num(r.order_count)) },
        { label: '客户数', value: String((r.by_customer || []).length) },
        { label: '商品数', value: String((r.by_product || []).length) },
      ]
      groups.value = [
        {
          title: '按客户',
          ...ranks(top(r.by_customer), (x) => ({
            name: x.name,
            amount: num(x.amount),
            amountText: money0(x.amount),
          })),
        },
        {
          title: '按商品',
          ...ranks(top(r.by_product), (x) => ({
            name: x.name,
            amount: num(x.amount),
            amountText: money0(x.amount),
            sub: `数量 ${x.qty}`,
          })),
        },
      ]
      return
    }

    if (kind.value === 'purchase') {
      const r = await api.purchaseReport(range)
      summary.value = [
        { label: '采购额', value: money0(r.total_amount) },
        { label: '单据数', value: String(num(r.order_count)) },
        { label: '供应商数', value: String((r.by_supplier || []).length) },
        { label: '商品数', value: String((r.by_product || []).length) },
      ]
      groups.value = [
        {
          title: '按供应商',
          ...ranks(top(r.by_supplier), (x) => ({
            name: x.name,
            amount: num(x.amount),
            amountText: money0(x.amount),
          })),
        },
        {
          title: '按商品',
          ...ranks(top(r.by_product), (x) => ({
            name: x.name,
            amount: num(x.amount),
            amountText: money0(x.amount),
            sub: `数量 ${x.qty}`,
          })),
        },
      ]
      return
    }

    // 利润
    const r = await api.profitReport(range)
    costVisible.value = !!r.cost_visible
    const s = [
      { label: '销售额', value: money0(r.total_sale) },
      { label: '成本', value: r.total_cost == null ? '—' : money0(r.total_cost) },
      {
        label: '毛利',
        value: r.profit == null ? '—' : money0(r.profit),
        color: num(r.profit) >= 0 ? '#16a34a' : '#dc2626',
      },
      {
        label: '毛利率',
        value: r.profit_rate == null ? '—' : r.profit_rate + '%',
        color: num(r.profit_rate) >= 0 ? '#16a34a' : '#dc2626',
      },
    ]
    summary.value = s

    const detail = top(r.detail).filter((x) => x.sale > 0)
    groups.value = [
      {
        title: '按商品（毛利降序）',
        ...ranks(detail, (x) => {
          const rate = x.cost == null || !x.sale ? null : ((x.sale - x.cost) / x.sale) * 100
          return {
            name: x.name,
            amount: x.profit == null ? num(x.sale) : num(x.profit),
            amountText: x.profit == null ? money0(x.sale) : money0(x.profit),
            sub:
              `销售额 ${money(x.sale)}` +
              (x.cost == null ? '' : ` · 成本 ${money(x.cost)}`) +
              (rate == null ? '' : ` · 毛利率 ${rate.toFixed(1)}%`),
          }
        }),
      },
    ]
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false
  }
}

function pickRange(k) {
  rangeKey.value = k
  load()
}

function pickKind(k) {
  kind.value = k
  load()
}

onMounted(load)
</script>
