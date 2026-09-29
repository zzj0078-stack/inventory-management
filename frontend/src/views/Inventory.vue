<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>库存管理</span>
          <div>
            <el-button v-permission="'inventory:export'" @click="doExport"><el-icon><Download /></el-icon> 导出CSV</el-button>
            <el-button v-permission="'warehouse:view'" @click="$router.push('/warehouses')"><el-icon><House /></el-icon> 仓库管理</el-button>
            <el-button v-permission="'inventory:view'" type="danger" @click="showLowStock">
              <el-icon><Warning /></el-icon> 库存预警
            </el-button>
            <el-button v-permission="'stockcheck:view'" type="warning" @click="$router.push('/stock-check')">
              <el-icon><DataAnalysis /></el-icon> 库存盘点
            </el-button>
          </div>
        </div>
      </template>
      
      <el-form :inline="true" :model="searchForm">
        <el-form-item label="关键词">
          <el-input v-model="searchForm.keyword" placeholder="商品名称/编码" clearable style="width:200px" />
        </el-form-item>
        <el-form-item label="仓库">
          <el-select v-model="searchForm.warehouse_id" placeholder="全部仓库" clearable :value-on-clear="null" style="width:160px">
            <el-option v-for="item in warehouses" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="库存预警">
          <el-checkbox v-model="searchForm.low_stock">仅显示预警商品</el-checkbox>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetSearch">重置</el-button>
        </el-form-item>
      </el-form>
      
      <el-table :data="tableData" v-loading="loading" border stripe style="width:100%">
        <el-table-column prop="id" label="ID" width="60" align="center" />
        <el-table-column prop="product_name" label="商品名称" min-width="220" show-overflow-tooltip />
        <el-table-column prop="product_sku" label="商品编码" width="150" show-overflow-tooltip />
        <el-table-column prop="warehouse_name" label="仓库" width="140" />
        <el-table-column prop="quantity" label="库存数量" width="100" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.quantity <= 0 ? '#f56c6c' : '#67c23a', fontWeight: 'bold' }">
              {{ row.quantity }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="min_stock" label="最低库存" width="90" align="right" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.quantity <= 0" type="danger" size="small">缺货</el-tag>
            <el-tag v-else-if="row.min_stock && row.quantity <= row.min_stock" type="warning" size="small">预警</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="updated_at" label="更新时间" width="180">
          <template #default="{ row }">
            {{ row.updated_at ? new Date(row.updated_at).toLocaleString() : '-' }}
          </template>
        </el-table-column>
      </el-table>
      
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next"
        @change="loadData"
      />
    </el-card>
    
    <!-- 库存盘点对话框 -->
    <el-dialog v-model="stockCheckVisible" title="库存盘点 - 预警商品" width="800px">
      <el-table :data="stockCheckData" border>
        <el-table-column prop="product_name" label="商品名称" min-width="150" />
        <el-table-column prop="product_sku" label="商品编码" width="120" />
        <el-table-column prop="warehouse_name" label="仓库" width="120" />
        <el-table-column prop="current_stock" label="当前库存" width="100">
          <template #default="{ row }">
            <span style="color: #f56c6c">{{ row.current_stock }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="min_stock" label="最低库存" width="100" />
        <el-table-column prop="deficit" label="缺口" width="100">
          <template #default="{ row }">
            <span style="color: #f56c6c; font-weight: bold">{{ row.deficit }}</span>
          </template>
        </el-table-column>
      </el-table>
      
      <el-empty v-if="stockCheckData.length === 0" description="暂无库存预警商品" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getInventory, getWarehouses, stockCheck, downloadExport } from '../api/modules'
import { ElMessage } from 'element-plus'

const loading = ref(false)
const tableData = ref([])
const warehouses = ref([])
const stockCheckVisible = ref(false)
const stockCheckData = ref([])

const searchForm = reactive({
  keyword: '',
  warehouse_id: null,
  low_stock: false
})
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

const loadData = async () => {
  loading.value = true
  try {
    const res = await getInventory({
      page: pagination.page,
      page_size: pagination.pageSize,
      keyword: searchForm.keyword,
      warehouse_id: searchForm.warehouse_id,
      low_stock: searchForm.low_stock || null
    })
    tableData.value = res.items
    pagination.total = res.total
  } finally {
    loading.value = false
  }
}

const loadWarehouses = async () => {
  warehouses.value = await getWarehouses()
}

const resetSearch = () => {
  searchForm.keyword = ''
  searchForm.warehouse_id = null
  searchForm.low_stock = false
  pagination.page = 1
  loadData()
}

const handleStockCheck = async () => {
  const res = await stockCheck()
  stockCheckData.value = res.data || []
  stockCheckVisible.value = true
}

const showLowStock = () => {
  searchForm.low_stock = true
  loadData()
}

const doExport = async () => {
  await downloadExport('inventory')
  ElMessage.success('已导出')
}

onMounted(() => {
  loadData()
  loadWarehouses()
})
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.el-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
