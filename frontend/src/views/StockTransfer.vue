<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>库存调拨</span>
          <el-button v-permission="'transfer:add'" type="primary" @click="openAdd"><el-icon><Plus /></el-icon> 新增调拨单</el-button>
        </div>
      </template>

      <el-table :data="list" v-loading="loading" border stripe style="width:100%">
        <el-table-column prop="transfer_no" label="调拨单号" width="180" />
        <el-table-column prop="from_warehouse_name" label="源仓库" min-width="150" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.from_warehouse_name || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="to_warehouse_name" label="目标仓库" min-width="150" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.to_warehouse_name || '-' }}</span></template>
        </el-table-column>
        <el-table-column label="商品数" width="90" align="center">
          <template #default="{row}">{{ (row.items||[]).length }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="110" align="center">
          <template #default="{row}">
            <el-tag :type="['info','warning','success','danger'][row.status]">{{ statusText[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="200" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.remark || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{row}">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center">
          <template #default="{row}">
            <el-button type="primary" link @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.status===0" v-permission="'transfer:approve'" type="success" link @click="doApprove(row)">审核执行</el-button>
            <el-button v-if="row.status===0" v-permission="'transfer:cancel'" type="danger" link @click="doCancel(row)">作废</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination style="margin-top:16px;justify-content:flex-end"
        v-model:current-page="pg.page" v-model:page-size="pg.size"
        :total="pg.total" layout="total,prev,pager,next" @change="load" />
    </el-card>

    <!-- 新增 -->
    <el-dialog v-model="addVisible" title="新增调拨单" width="900px">
      <el-form :model="form" label-width="100px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="源仓库" required>
              <el-select v-model="form.from_warehouse_id" placeholder="选择源仓库" style="width:100%"
                @change="onFromWarehouseChange">
                <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="目标仓库" required>
              <el-select v-model="form.to_warehouse_id" placeholder="选择目标仓库" style="width:100%">
                <el-option
                  v-for="w in warehouses.filter(x => x.id !== form.from_warehouse_id)"
                  :key="w.id" :label="w.name" :value="w.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>

        <el-divider>调拨明细</el-divider>
        <el-table :data="form.items" border>
          <el-table-column label="商品" min-width="260">
            <template #default="{row}">
              <el-select v-model="row.product_id" filterable placeholder="选择商品" style="width:100%">
                <el-option v-for="p in products" :key="p.id" :label="p.name + (p.spec ? ' / ' + p.spec : '')" :value="p.id" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="源仓库存" width="110" align="right">
            <template #default="{row}">
              <span :style="{ color: stockOf(row.product_id) === 0 ? '#f56c6c' : '#606266', fontWeight: 'bold' }">
                {{ stockOf(row.product_id) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="调拨数量" width="180">
            <template #default="{row}">
              <el-input v-model.number="row.quantity" type="number" min="1" size="small" style="width:100%" />
            </template>
          </el-table-column>
          <el-table-column width="90" align="center" label="操作">
            <template #default="{$index}">
              <el-button type="danger" link @click="form.items.splice($index,1)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button link type="primary" style="margin-top:8px"
          @click="form.items.push({product_id:null,quantity:1})">+ 添加明细</el-button>
      </el-form>
      <template #footer>
        <el-button @click="addVisible=false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <el-dialog v-model="detailVisible" title="调拨单详情" width="800px">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="调拨单号">{{ detail.transfer_no }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="['info','warning','success','danger'][detail.status]">{{ statusText[detail.status] }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="源仓库">{{ detail.from_warehouse_name }}</el-descriptions-item>
        <el-descriptions-item label="目标仓库">{{ detail.to_warehouse_name }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ fmt(detail.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="备注">{{ detail.remark }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="detail.items || []" border style="margin-top:12px">
        <el-table-column prop="product_name" label="商品" min-width="160" />
        <el-table-column prop="spec" label="规格" width="120" />
        <el-table-column prop="unit" label="单位" width="80" align="center" />
        <el-table-column prop="quantity" label="数量" width="100" align="right" />
      </el-table>
      <template #footer>
        <el-button @click="detailVisible=false">关闭</el-button>
        <el-button v-if="detail.status===0" v-permission="'transfer:approve'" type="primary" @click="doApprove(detail)">审核执行</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import {
  getStockTransfers, getStockTransfer, createStockTransfer,
  approveStockTransfer, cancelStockTransfer,
  getWarehouses, getInventory, getProducts
} from '../api/modules'
import { ElMessage, ElMessageBox } from 'element-plus'
import { confirmAction, confirmCancel } from '../utils/confirm'

const statusText = ['待审核', '已审核', '已完成', '已作废']
const fmt = d => (d ? new Date(d).toLocaleString() : '-')

const loading = ref(false)
const submitting = ref(false)
const list = ref([])
const warehouses = ref([])
const products = ref([])
/** { [warehouseId]: { [productId]: quantity } } */
const stockByWarehouse = ref({})
const addVisible = ref(false)
const detailVisible = ref(false)
const detail = ref({})

const pg = reactive({ page: 1, size: 20, total: 0 })
const form = reactive({ from_warehouse_id: null, to_warehouse_id: null, remark: '', items: [] })

/** 源仓库下该商品的可用库存 */
const stockOf = (pid) => {
  if (!pid || !form.from_warehouse_id) return '-'
  const wh = stockByWarehouse.value[form.from_warehouse_id]
  return wh ? (wh[pid] ?? 0) : 0
}

const load = async () => {
  loading.value = true
  try {
    const r = await getStockTransfers({ page: pg.page, page_size: pg.size })
    list.value = r.items
    pg.total = r.total
  } finally {
    loading.value = false
  }
}

const loadBase = async () => {
  // 三个接口独立容错：任一失败不影响其余，避免整页卡死
  const [w, p, inv] = await Promise.allSettled([
    getWarehouses(),
    getProducts({ page: 1, page_size: 1000 }),
    getInventory({ page: 1, page_size: 1000 })
  ])

  warehouses.value = w.status === 'fulfilled' ? (w.value || []) : []
  products.value = p.status === 'fulfilled'
    ? ((p.value?.items || []).map(x => ({ id: x.id, name: x.name, spec: x.spec })))
    : []

  // 按仓库分别汇总库存，而不是所有仓库求和
  const m = {}
  if (inv.status === 'fulfilled') {
    ;(inv.value?.items || []).forEach(i => {
      if (!m[i.warehouse_id]) m[i.warehouse_id] = {}
      m[i.warehouse_id][i.product_id] = (m[i.warehouse_id][i.product_id] || 0) + i.quantity
    })
  }
  stockByWarehouse.value = m

  if (w.status !== 'fulfilled') {
    ElMessage.warning('仓库列表加载失败：当前角色缺少「查看仓库」权限')
  }
  if (p.status !== 'fulfilled') {
    ElMessage.warning('商品列表加载失败：当前角色缺少「查看商品」权限')
  }
}

/** 切换源仓库后重新校验已填数量 */
const onFromWarehouseChange = () => {
  if (form.to_warehouse_id === form.from_warehouse_id) {
    const alt = warehouses.value.find(w => w.id !== form.from_warehouse_id)
    form.to_warehouse_id = alt ? alt.id : null
  }
  form.items.forEach(row => {
    if (!row.product_id) return
    const have = stockOf(row.product_id)
    if (typeof have === 'number' && row.quantity > have) {
      row.quantity = Math.max(1, have)
    }
  })
}

const openAdd = async () => {
  try {
    await loadBase()
  } catch (e) {
    // loadBase 内部已容错，这里兜底保证弹窗照常打开
  }

  if (!warehouses.value.length) {
    ElMessage.warning('未获取到仓库，请先在「仓库管理」新增仓库，或为该角色勾选「查看仓库」权限')
  }

  form.from_warehouse_id = warehouses.value[0]?.id ?? null
  form.to_warehouse_id = warehouses.value[1]?.id ?? null
  form.remark = ''
  form.items = [{ product_id: null, quantity: 1 }]
  addVisible.value = true
}

const openDetail = async row => {
  detail.value = await getStockTransfer(row.id)
  detailVisible.value = true
}

const submit = async () => {
  if (!warehouses.value.length) {
    return ElMessage.warning('系统无可用仓库，请先在「仓库管理」新增仓库')
  }
  if (!form.from_warehouse_id || !form.to_warehouse_id) return ElMessage.warning('请选择源仓库和目标仓库')
  if (form.from_warehouse_id === form.to_warehouse_id) return ElMessage.warning('源仓库与目标仓库不能相同')

  // 规范化数量
  form.items.forEach(r => {
    let v = Number(r.quantity)
    if (!isFinite(v) || v < 1) v = 1
    r.quantity = Math.floor(v)
  })

  const items = form.items.filter(i => i.product_id && i.quantity > 0)
  if (!items.length) return ElMessage.warning('请添加调拨明细（选择商品并填写数量）')

  // 用后端最新数据再校验一次源仓库存，避免前端缓存过期
  try {
    const inv = await getInventory({
      page: 1, page_size: 1000, warehouse_id: form.from_warehouse_id
    })
    const fresh = {}
    ;(inv.items || []).forEach(i => {
      fresh[i.product_id] = (fresh[i.product_id] || 0) + i.quantity
    })
    for (const it of items) {
      const have = fresh[it.product_id] ?? 0
      if (it.quantity > have) {
        const p = products.value.find(x => x.id === it.product_id)
        return ElMessage.warning(
          `「${p?.name || '商品'}」源仓库存仅 ${have}，调拨数量不能超过`
        )
      }
    }
  } catch (e) {
    // 校验失败不阻塞，交由后端把关
  }

  submitting.value = true
  try {
    await createStockTransfer({
      from_warehouse_id: form.from_warehouse_id,
      to_warehouse_id: form.to_warehouse_id,
      remark: form.remark,
      items: items.map(i => ({ product_id: i.product_id, quantity: Number(i.quantity) }))
    })
    ElMessage.success('调拨单已创建')
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
    '确认执行调拨',
    `调拨单：<b>${row.transfer_no}</b><br/>
     ${row.from_warehouse_name} → ${row.to_warehouse_name}<br/>
     <span style="color:#f56c6c">执行后库存将立即变动，不可撤销。</span>`,
    '确认执行'
  )
  await approveStockTransfer(row.id)
  ElMessage.success('调拨完成')
  detailVisible.value = false
  await Promise.all([load(), loadBase()])
}

const doCancel = async row => {
  await confirmCancel(`调拨单「${row.transfer_no}」`)
  await cancelStockTransfer(row.id)
  ElMessage.success('已作废')
  load()
}

onMounted(async () => { await load(); await loadBase() })
</script>

<style scoped>
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>
