<template>
  <div class="dashboard">
    <!-- 今日数据 -->
    <el-row :gutter="16">
      <el-col :span="6">
        <div class="stat-card blue">
          <div class="stat-title">今日销售额(元)</div>
          <div class="stat-value">{{ Number(d.today_sales).toFixed(2) }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card orange">
          <div class="stat-title">今日采购额(元)</div>
          <div class="stat-value">{{ Number(d.today_purchase).toFixed(2) }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card blue">
          <div class="stat-title">今日销售笔数</div>
          <div class="stat-value">{{ d.today_sales_count }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card orange">
          <div class="stat-title">今日采购笔数</div>
          <div class="stat-value">{{ d.today_purchase_count }}</div>
        </div>
      </el-col>
    </el-row>

    <!-- 待办事项 -->
    <el-card shadow="never" style="margin-top:16px">
      <template #header><span style="font-size:14px;font-weight:bold">待办事项</span></template>
      <el-row :gutter="0">
        <el-col :span="6" class="todo-item">
          <div class="todo-label">待入库</div>
          <div class="todo-value orange">{{ d.pending_purchase_in }}</div>
        </el-col>
        <el-col :span="6" class="todo-item">
          <div class="todo-label">待出库</div>
          <div class="todo-value orange">{{ d.pending_sales_out }}</div>
        </el-col>
        <el-col :span="6" class="todo-item">
          <div class="todo-label">{{ balLabel('receivable') }}</div>
          <div class="todo-value" :class="Number(d.receivable) >= 0 ? 'red' : 'green'">
            {{ Math.abs(Number(d.receivable)).toFixed(2) }}
          </div>
        </el-col>
        <el-col :span="6" class="todo-item">
          <div class="todo-label">{{ balLabel('payable') }}</div>
          <div class="todo-value" :class="Number(d.payable) >= 0 ? 'red' : 'green'">
            {{ Math.abs(Number(d.payable)).toFixed(2) }}
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 快捷入口 -->
    <el-card shadow="never" style="margin-top:16px">
      <template #header><span style="font-size:14px;font-weight:bold">ERP操作快捷入口</span></template>
      <el-row :gutter="16">
        <el-col :span="4" v-for="item in shortcuts" :key="item.label">
          <div class="shortcut-item" @click="$router.push(item.path)">
            <el-icon :size="28" color="#409eff"><component :is="item.icon" /></el-icon>
            <div class="shortcut-label">{{ item.label }}</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 按日期合计 -->
    <el-card shadow="never" style="margin-top:16px">
      <template #header>
        <div class="daily-header">
          <span style="font-size:14px;font-weight:bold">按日期合计</span>
          <el-radio-group v-model="dailyDays" size="small" @change="loadDaily">
            <el-radio-button :value="7">近7天</el-radio-button>
            <el-radio-button :value="30">近30天</el-radio-button>
            <el-radio-button :value="90">近90天</el-radio-button>
          </el-radio-group>
        </div>
      </template>

      <el-table :data="dailyItems" border stripe size="small" max-height="380" v-loading="dailyLoading">
        <el-table-column prop="date" label="日期" width="130" />
        <el-table-column prop="count" label="销售笔数" width="110" align="right" />
        <el-table-column prop="amount" label="销售额(元)" width="150" align="right">
          <template #default="{ row }">{{ Number(row.amount).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column prop="purchase_amount" label="采购额(元)" width="150" align="right">
          <template #default="{ row }">{{ Number(row.purchase_amount).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="销售占比" min-width="180">
          <template #default="{ row }">
            <el-progress :percentage="pct(row.amount)" :stroke-width="10"
              :format="() => Number(row.amount).toFixed(0)" />
          </template>
        </el-table-column>
      </el-table>

      <div class="daily-summary">
        <span>合计：<b>{{ daily.total_count }}</b> 笔</span>
        <span>销售额：<b class="blue">¥{{ Number(daily.total_amount).toFixed(2) }}</b></span>
        <span>日均：<b>{{ Number(daily.avg_amount).toFixed(2) }}</b></span>
        <span class="muted">{{ daily.start }} ~ {{ daily.end }}</span>
      </div>
    </el-card>

    <!-- 下方统计 -->
    <el-row :gutter="16" style="margin-top:16px">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span style="font-size:14px;font-weight:bold">库存预警</span></template>
          <div class="info-row">
            <span>预警商品数</span>
            <span class="value orange">{{ d.low_stock_count }}</span>
          </div>
          <div class="info-row">
            <span>库存总量</span>
            <span class="value">{{ d.inventory_total }}</span>
          </div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span style="font-size:14px;font-weight:bold">资金概况</span></template>
          <div class="info-row">
            <span>今日采购额</span>
            <span class="value">¥{{ Number(d.today_purchase).toFixed(2) }}</span>
          </div>
          <div class="info-row">
            <span>今日销售额</span>
            <span class="value">¥{{ Number(d.today_sales).toFixed(2) }}</span>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getDashboard, getSalesDaily } from '../api/modules'
import { ShoppingCart, Sell, Box, Sort, DataAnalysis, User, Money } from '@element-plus/icons-vue'

const d = reactive({
  today_sales: 0, today_sales_count: 0, today_purchase: 0, today_purchase_count: 0,
  pending_purchase_in: 0, pending_sales_out: 0, receivable: 0, payable: 0,
  low_stock_count: 0, inventory_total: 0
})

/* ---------- 按日期合计 ---------- */
const dailyDays = ref(7)
const dailyLoading = ref(false)
const dailyItems = ref([])
const daily = reactive({ total_amount: 0, total_count: 0, avg_amount: 0, start: '', end: '' })

const maxAmount = computed(() =>
  dailyItems.value.reduce((m, x) => Math.max(m, Number(x.amount) || 0), 0)
)

const pct = (v) => {
  const m = maxAmount.value
  if (!m) return 0
  return Math.round((Number(v) || 0) / m * 100)
}

const loadDaily = async () => {
  dailyLoading.value = true
  try {
    const r = await getSalesDaily(dailyDays.value)
    // 最近的日期排在前面
    dailyItems.value = (r.items || []).slice().reverse()
    Object.assign(daily, {
      total_amount: r.total_amount || 0,
      total_count: r.total_count || 0,
      avg_amount: r.avg_amount || 0,
      start: r.start, end: r.end
    })
  } finally {
    dailyLoading.value = false
  }
}

/** 余额为负表示对方多付/预付，文案随之变化 */
const balLabel = (key) => {
  const v = Number(key === 'receivable' ? d.receivable : d.payable)
  if (key === 'receivable') {
    return v > 0 ? '应收欠款(元)' : (v < 0 ? '预收/应退(元)' : '应收已结清')
  }
  return v > 0 ? '应付欠款(元)' : (v < 0 ? '预付/应收回(元)' : '应付已结清')
}

const shortcuts = [
  { label: '采购开单', icon: ShoppingCart, path: '/purchase' },  { label: '销售开单', icon: Sell, path: '/sales' },
  { label: '采购退货', icon: ShoppingCart, path: '/purchase-return' },
  { label: '销售退货', icon: Sell, path: '/sale-return' },
  { label: '库存调拨', icon: Sort, path: '/stock-transfer' },
  { label: '收付款', icon: Money, path: '/payment' },
]

onMounted(async () => {
  loadDaily()
  try {
    const r = await getDashboard()
    Object.assign(d, r)
  } catch (e) {}
})
</script>

<style scoped>
.stat-card {
  background: white;
  border-radius: 4px;
  padding: 20px;
  text-align: center;
  border: 1px solid #e8e8e8;
}
.stat-title {
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
}
.stat-value {
  font-size: 36px;
  font-weight: bold;
  color: #1890ff;
}
/* 采购用橙色区分 */
.stat-card.orange .stat-value { color: #e6a23c; }
.todo-item {
  text-align: center;
  padding: 12px 0;
  border-right: 1px solid #f0f0f0;
}
.todo-item:last-child { border-right: none; }
.todo-label {
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
}
.todo-value {
  font-size: 28px;
  font-weight: bold;
}
.shortcut-item {
  text-align: center;
  padding: 16px 0;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.2s;
}
.shortcut-item:hover {
  background: #f5f7fa;
}
.shortcut-label {
  font-size: 13px;
  color: #333;
  margin-top: 8px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #f5f5f5;
  font-size: 14px;
}
.info-row:last-child { border-bottom: none; }
.value { font-weight: bold; font-size: 16px; }
.orange { color: #e6a23c; }
.red { color: #f56c6c; }
.green { color: #67c23a; }
/* 按日期合计 */
.daily-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.daily-summary {
  display: flex;
  gap: 28px;
  align-items: baseline;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #f0f0f0;
  font-size: 14px;
  color: #606266;
}
.daily-summary b { font-size: 16px; }
.daily-summary .blue { color: #1890ff; }
.daily-summary .muted { color: #909399; font-size: 12px; }
</style>
