<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>库存盘点</span>
          <el-button v-permission="'stockcheck:add'" type="primary" @click="openAdd"><el-icon><Plus /></el-icon> 新建盘点单</el-button>
        </div>
      </template>

      <el-table :data="list" v-loading="loading" border stripe style="width:100%">
        <el-table-column prop="check_no" label="盘点单号" width="180" />
        <el-table-column prop="warehouse_name" label="仓库" min-width="160" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.warehouse_name || '-' }}</span></template>
        </el-table-column>
        <el-table-column label="盘点项" width="90" align="center">
          <template #default="{row}">{{ (row.items||[]).length }}</template>
        </el-table-column>
        <el-table-column label="差异项" width="90" align="center">
          <template #default="{row}">
            <span :style="{color: diffCount(row) ? '#e6a23c' : '#909399'}">{{ diffCount(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="盈亏合计" width="110" align="right">
          <template #default="{row}">
            <span :style="{color: diffSum(row) === 0 ? '#909399' : (diffSum(row) > 0 ? '#67c23a' : '#f56c6c')}">
              {{ diffSum(row) > 0 ? '+' : '' }}{{ diffSum(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="110" align="center">
          <template #default="{row}">
            <el-tag :type="['info','success','danger'][row.status]">{{ statusText[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="220" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.remark || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{row}">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center">
          <template #default="{row}">
            <el-button type="primary" link @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.status===0" v-permission="'stockcheck:approve'" type="success" link @click="doApprove(row)">审核调账</el-button>
            <el-button v-if="row.status===0" v-permission="'stockcheck:cancel'" type="danger" link @click="doCancel(row)">作废</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination style="margin-top:16px;justify-content:flex-end"
        v-model:current-page="pg.page" v-model:page-size="pg.size"
        :total="pg.total" layout="total,prev,pager,next" @change="load" />
    </el-card>

    <!-- 新建 -->
    <el-dialog v-model="addVisible" title="新建盘点单" width="900px">
      <el-form :model="form" label-width="100px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="盘点仓库" required>
              <el-select v-model="form.warehouse_id" placeholder="选择仓库" style="width:100%" @change="loadPreview">
                <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0;gap:12px">
        <span style="font-size:13px;color:#606266">
          填写实盘数量，差异自动计算。当前共 {{ form.items.length }} 项。
        </span>
        <div style="flex-shrink:0">
          <el-button size="small" @click="fillActual">实盘=账面</el-button>
          <el-button size="small" @click="loadPreview">重新读取账面</el-button>
        </div>
      </div>

      <el-table :data="form.items" border max-height="400" style="width:100%">
        <el-table-column prop="product_name" label="商品" min-width="200" show-overflow-tooltip />
        <el-table-column prop="spec" label="规格" min-width="130" show-overflow-tooltip />
        <el-table-column prop="unit" label="单位" width="70" align="center" />
        <el-table-column prop="system_quantity" label="账面数" width="90" align="right" />
        <el-table-column label="实盘数" width="130" align="center">
          <template #default="{ row }">
            <el-input
              v-model.number="row.actual_quantity"
              type="number"
              min="0"
              size="small"
              style="width:100%"
              @change="onActualChange(row)"
            />
          </template>
        </el-table-column>
        <el-table-column label="差异" width="90" align="right">
          <template #default="{row}">
            <span :style="{color: diff(row) === 0 ? '#909399' : (diff(row) > 0 ? '#67c23a' : '#f56c6c'), fontWeight:'bold'}">
              {{ diff(row) > 0 ? '+' : '' }}{{ diff(row) }}
            </span>
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="addVisible=false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交盘点单</el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <el-dialog v-model="detailVisible" title="盘点单详情" width="800px">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="盘点单号">{{ detail.check_no }}</el-descriptions-item>
        <el-descriptions-item label="仓库">{{ detail.warehouse_name }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="['info','success','danger'][detail.status]">{{ statusText[detail.status] }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ fmt(detail.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ detail.remark }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="detail.items || []" border style="margin-top:12px" max-height="360">
        <el-table-column prop="product_name" label="商品" min-width="160" />
        <el-table-column prop="spec" label="规格" width="110" />
        <el-table-column prop="unit" label="单位" width="70" align="center" />
        <el-table-column prop="system_quantity" label="账面数" width="90" align="right" />
        <el-table-column prop="actual_quantity" label="实盘数" width="90" align="right" />
        <el-table-column prop="diff" label="差异" width="90" align="right">
          <template #default="{row}">
            <span :style="{color: row.diff === 0 ? '#909399' : (row.diff > 0 ? '#67c23a' : '#f56c6c')}">
              {{ row.diff > 0 ? '+' : '' }}{{ row.diff }}
            </span>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="detailVisible=false">关闭</el-button>
        <el-button v-if="detail.status===0" v-permission="'stockcheck:approve'" type="primary" @click="doApprove(detail)">审核调账</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import {
  getStockChecks, getStockCheck, createStockCheck, approveStockCheck, cancelStockCheck,
  previewStockCheck, getWarehouses
} from '../api/modules'
import { ElMessage, ElMessageBox } from 'element-plus'
import { confirmAction, confirmCancel } from '../utils/confirm'

const statusText = ['待审核', '已审核', '已作废']
const fmt = d => (d ? new Date(d).toLocaleString() : '-')
const diff = row => (row.actual_quantity || 0) - (row.system_quantity || 0)
const diffCount = row => (row.items || []).filter(i => i.diff !== 0).length
const diffSum = row => (row.items || []).reduce((s, i) => s + (i.diff || 0), 0)

const loading = ref(false)
const submitting = ref(false)
const list = ref([])
const warehouses = ref([])
const addVisible = ref(false)
const detailVisible = ref(false)
const detail = ref({})

const pg = reactive({ page: 1, size: 20, total: 0 })
const form = reactive({ warehouse_id: null, remark: '', items: [] })

const load = async () => {
  loading.value = true
  try {
    const r = await getStockChecks({ page: pg.page, page_size: pg.size })
    list.value = r.items
    pg.total = r.total
  } finally {
    loading.value = false
  }
}

const loadPreview = async () => {
  if (!form.warehouse_id) return
  const r = await previewStockCheck({ warehouse_id: form.warehouse_id })
  form.items = (r.items || []).map(i => ({ ...i }))

  const nonZero = form.items.filter(i => i.system_quantity !== 0).length
  if (form.items.length && nonZero === 0) {
    const wh = warehouses.value.find(w => w.id === form.warehouse_id)
    ElMessage.warning(`仓库「${wh?.name || form.warehouse_id}」当前无库存，账面数均为 0`)
  }
}

const fillActual = () => {
  form.items.forEach(i => { i.actual_quantity = i.system_quantity })
}

/** 输入框可能给出字符串/负数，统一成非负整数 */
const onActualChange = (row) => {
  let v = Number(row.actual_quantity)
  if (!isFinite(v) || v < 0) v = 0
  row.actual_quantity = Math.floor(v)
}

const openAdd = async () => {
  warehouses.value = await getWarehouses()
  form.warehouse_id = warehouses.value[0]?.id ?? null
  form.remark = ''
  form.items = []
  addVisible.value = true
  await loadPreview()
}

const openDetail = async row => {
  detail.value = await getStockCheck(row.id)
  detailVisible.value = true
}

const submit = async () => {
  if (!form.warehouse_id) return ElMessage.warning('请选择盘点仓库')
  if (!form.items.length) return ElMessage.warning('盘点明细为空')

  form.items.forEach(onActualChange)

  submitting.value = true
  try {
    await createStockCheck({
      warehouse_id: form.warehouse_id,
      remark: form.remark,
      items: form.items.map(i => ({
        product_id: i.product_id,
        system_quantity: Number(i.system_quantity) || 0,
        actual_quantity: Number(i.actual_quantity) || 0
      }))
    })
    ElMessage.success('盘点单已创建')
    addVisible.value = false
    load()
  } catch (e) {
    // 错误已由拦截器提示
  } finally {
    submitting.value = false
  }
}

const doApprove = async row => {
  await confirmAction(
    '确认按盘点结果调账',
    `盘点单：<b>${row.check_no}</b><br/>
     仓库：${row.warehouse_name}<br/>
     差异项：<b>${diffCount(row)}</b> 项，盈亏合计 <b>${diffSum(row) > 0 ? '+' : ''}${diffSum(row)}</b><br/>
     <span style="color:#f56c6c">审核后库存将按实盘数调整，不可撤销。</span>`,
    '确认调账'
  )
  await approveStockCheck(row.id)
  ElMessage.success('库存已调整')
  detailVisible.value = false
  load()
}

const doCancel = async row => {
  await confirmCancel(`盘点单「${row.check_no}」`)
  await cancelStockCheck(row.id)
  ElMessage.success('已作废')
  load()
}

onMounted(async () => {
  load()
  warehouses.value = await getWarehouses()
})
</script>

<style scoped>
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>
