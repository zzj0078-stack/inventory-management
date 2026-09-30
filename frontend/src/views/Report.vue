<template>
  <div class="page-container">
    <el-card>
      <template #header><span>报表中心</span></template>
      <el-tabs v-model="activeTab" @tab-change="loadTab">
        <el-tab-pane label="销售报表" name="sales">
          <el-row :gutter="20" style="margin-bottom:16px">
            <el-col :span="6"><el-statistic title="销售总额" :value="salesData.total_amount" prefix="¥" :precision="2" /></el-col>
            <el-col :span="6"><el-statistic title="销售单数" :value="salesData.order_count" /></el-col>
          </el-row>
          <el-divider content-position="left">按客户统计</el-divider>
          <el-table :data="salesData.by_customer || []" border>
            <el-table-column prop="name" label="客户" min-width="200" />
            <el-table-column prop="amount" label="金额" width="150">
              <template #default="{row}">¥{{ Number(row.amount).toFixed(2) }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="采购报表" name="purchase">
          <el-row :gutter="20" style="margin-bottom:16px">
            <el-col :span="6"><el-statistic title="采购总额" :value="purchaseData.total_amount" prefix="¥" :precision="2" /></el-col>
            <el-col :span="6"><el-statistic title="采购单数" :value="purchaseData.order_count" /></el-col>
          </el-row>
          <el-divider content-position="left">按供应商统计</el-divider>
          <el-table :data="purchaseData.by_supplier || []" border>
            <el-table-column prop="name" label="供应商" min-width="200" />
            <el-table-column prop="amount" label="金额" width="150">
              <template #default="{row}">¥{{ Number(row.amount).toFixed(2) }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="利润分析" name="profit">
          <el-row :gutter="20" style="margin-bottom:16px">
            <el-col :span="costVisible ? 6 : 24"><el-statistic title="销售收入" :value="profitData.total_sale" prefix="¥" :precision="2" /></el-col>
            <el-col v-if="costVisible" :span="6"><el-statistic title="销售成本" :value="profitData.total_cost" prefix="¥" :precision="2" /></el-col>
            <el-col v-if="costVisible" :span="6"><el-statistic title="毛利润" :value="profitData.profit" prefix="¥" :precision="2" :value-style="{color: profitData.profit >= 0 ? '#67c23a' : '#f56c6c'}" /></el-col>
            <el-col v-if="costVisible" :span="6"><el-statistic title="毛利率" :value="profitData.profit_rate" suffix="%" :precision="1" /></el-col>
          </el-row>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>
<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getSalesReport, getPurchaseReport, getProfitReport } from '../api/modules'
const activeTab = ref('sales')
const salesData = reactive({ total_amount: 0, order_count: 0, by_customer: [] })
const purchaseData = reactive({ total_amount: 0, order_count: 0, by_supplier: [] })
const profitData = reactive({ total_sale: 0, total_cost: 0, profit: 0, profit_rate: 0, cost_visible: true })
/** 后端在没有 product:cost 权限时会返回 cost_visible=false，并抹掉成本/毛利 */
const costVisible = computed(() => profitData.cost_visible !== false)
const loadTab = async (tab) => {
  if (tab === 'sales') { const r = await getSalesReport(); Object.assign(salesData, r) }
  else if (tab === 'purchase') { const r = await getPurchaseReport(); Object.assign(purchaseData, r) }
  else if (tab === 'profit') { const r = await getProfitReport(); Object.assign(profitData, r) }
}
onMounted(() => loadTab('sales'))
</script>
