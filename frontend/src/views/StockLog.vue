<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>库存出入库明细</span>
          <div>
            <el-button v-permission="'stocklog:init'" v-if="stat.need_init" type="warning" @click="doInit(false)">
              <el-icon><MagicStick /></el-icon> 生成期初流水
            </el-button>
            <el-button v-permission="'stocklog:export'" @click="doExport"><el-icon><Download /></el-icon> 导出CSV</el-button>
          </div>
        </div>
      </template>

      <el-alert
        v-if="stat.need_init"
        title="当前库存有数据但没有任何流水记录（多为导入的历史数据）。可点击「生成期初流水」按现有库存补一条期初记录。"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom:12px"
      />

      <el-form :inline="true" :model="sf">
        <el-form-item label="类型">
          <el-select v-model="sf.type" clearable placeholder="全部" :value-on-clear="null" style="width:160px">
            <el-option value="init" label="期初库存" />
            <el-option value="purchase_in" label="采购入库" /><el-option value="sale_out" label="销售出库" />
            <el-option value="sale_return_in" label="退货入库" /><el-option value="purchase_return_out" label="退货出库" />
            <el-option value="transfer_in" label="调拨入库" /><el-option value="transfer_out" label="调拨出库" />
            <el-option value="adjust_in" label="盘盈" /><el-option value="adjust_out" label="盘亏" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库">
          <el-select v-model="sf.warehouse_id" clearable placeholder="全部" :value-on-clear="null" style="width:150px">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item><el-button type="primary" @click="load">查询</el-button></el-form-item>
      </el-form>

      <el-table :data="list" v-loading="loading" border stripe style="width:100%">
        <el-table-column prop="id" label="ID" width="70" align="center" />
        <el-table-column prop="product_name" label="商品" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.product_name || `#${row.product_id}` }}</template>
        </el-table-column>
        <el-table-column prop="warehouse_name" label="仓库" width="140">
          <template #default="{ row }">{{ row.warehouse_name || `#${row.warehouse_id}` }}</template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="typeColor[row.type] || 'info'">{{ typeMap[row.type] || row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="90" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.quantity > 0 ? '#67c23a' : '#f56c6c', fontWeight: 'bold' }">
              {{ row.quantity > 0 ? '+' : '' }}{{ row.quantity }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="before_quantity" label="变动前" width="90" align="right" />
        <el-table-column prop="after_quantity" label="变动后" width="90" align="right" />
        <el-table-column prop="related_no" label="关联单号" width="170">
          <template #default="{ row }">{{ row.related_no || '-' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="110">
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
        <el-table-column prop="created_at" label="时间" width="180">
          <template #default="{ row }">{{ row.created_at ? new Date(row.created_at).toLocaleString() : '-' }}</template>
        </el-table-column>
      </el-table>

      <el-pagination
        style="margin-top:16px;justify-content:flex-end"
        v-model:current-page="pg.page" v-model:page-size="pg.size"
        :total="pg.total" layout="total,prev,pager,next" @change="load" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getStockLogs, getWarehouses, getStockLogStat, initStockLogs, downloadExport } from '../api/modules'
import { ElMessage, ElMessageBox } from 'element-plus'

const typeMap = {
  init: '期初库存', purchase_in: '采购入库', sale_out: '销售出库',
  sale_return_in: '退货入库', purchase_return_out: '退货出库',
  transfer_in: '调拨入库', transfer_out: '调拨出库',
  adjust_in: '盘盈', adjust_out: '盘亏'
}
const typeColor = {
  init: 'info', purchase_in: 'success', sale_out: 'danger',
  sale_return_in: 'success', purchase_return_out: 'warning',
  transfer_in: 'success', transfer_out: 'warning',
  adjust_in: 'success', adjust_out: 'danger'
}

const loading = ref(false)
const list = ref([])
const warehouses = ref([])
const stat = reactive({ log_count: 0, inventory_count: 0, need_init: false })
const sf = reactive({ type: null, warehouse_id: null })
const pg = reactive({ page: 1, size: 20, total: 0 })

const load = async () => {
  loading.value = true
  try {
    const r = await getStockLogs({
      page: pg.page, page_size: pg.size,
      type: sf.type, warehouse_id: sf.warehouse_id
    })
    list.value = r.items
    pg.total = r.total
  } finally {
    loading.value = false
  }
}

const loadStat = async () => {
  const r = await getStockLogStat()
  Object.assign(stat, r)
}

const doInit = async () => {
  try {
    await ElMessageBox.confirm(
      `<div style="line-height:1.9">
        将按当前库存为每个商品/仓库生成一条「期初库存」流水。<br/>
        已有流水不会被修改。
       </div>`,
      '生成期初流水',
      { dangerouslyUseHTMLString: true, type: 'warning', confirmButtonText: '确认生成' }
    )
  } catch { return }
  const r = await initStockLogs(false)
  ElMessage.success(r.message || '已生成')
  loadStat()
  load()
}

const doExport = async () => {
  await downloadExport('stocklog')
  ElMessage.success('已导出')
}

onMounted(async () => {
  load()
  loadStat()
  warehouses.value = await getWarehouses()
})
</script>

<style scoped>
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>
