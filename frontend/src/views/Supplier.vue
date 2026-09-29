<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>供应商管理</span>
          <el-button v-permission="'supplier:add'" type="primary" @click="handleAdd">
            <el-icon><Plus /></el-icon> 新增供应商
          </el-button>
        </div>
      </template>
      
      <!-- 搜索栏 -->
      <el-form :inline="true" :model="searchForm">
        <el-form-item label="关键词">
          <el-input v-model="searchForm.keyword" placeholder="名称/联系人/电话" clearable />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetSearch">重置</el-button>
        </el-form-item>
      </el-form>
      
      <!-- 表格 -->
      <el-table :data="tableData" v-loading="loading" border stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="供应商名称" min-width="150" />
        <el-table-column prop="contact" label="联系人" width="120" />
        <el-table-column prop="phone" label="电话" width="140" />
        <el-table-column prop="email" label="邮箱" width="180" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'">
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button v-permission="'supplier:edit'" type="primary" link @click="handleEdit(row)">编辑</el-button>
            <el-button v-permission="'supplier:delete'" type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      
      <!-- 分页 -->
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next"
        @change="loadData"
      />
    </el-card>
    
    <!-- 新增/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="600px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="供应商名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="联系人" prop="contact">
          <el-input v-model="form.contact" />
        </el-form-item>
        <el-form-item label="电话" prop="phone">
          <el-input v-model="form.phone" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" type="textarea" />
        </el-form-item>
        <el-form-item label="开户银行">
          <el-input v-model="form.bank_name" />
        </el-form-item>
        <el-form-item label="银行账号">
          <el-input v-model="form.bank_account" />
        </el-form-item>
        <el-form-item label="税号">
          <el-input v-model="form.tax_number" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, getSupplierOutstanding } from '../api/modules'
import { ElMessage, ElMessageBox } from 'element-plus'
import { confirmDelete, alertInfo } from '../utils/confirm'

const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const dialogVisible = ref(false)
const dialogTitle = ref('')
const formRef = ref(null)
const editId = ref(null)

const searchForm = reactive({ keyword: '' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

const form = reactive({
  name: '',
  contact: '',
  phone: '',
  email: '',
  address: '',
  bank_name: '',
  bank_account: '',
  tax_number: '',
  remark: ''
})

const rules = {
  name: [{ required: true, message: '请输入供应商名称', trigger: 'blur' }]
}

const loadData = async () => {
  loading.value = true
  try {
    const res = await getSuppliers({
      page: pagination.page,
      page_size: pagination.pageSize,
      keyword: searchForm.keyword
    })
    tableData.value = res.items
    pagination.total = res.total
  } finally {
    loading.value = false
  }
}

const resetSearch = () => {
  searchForm.keyword = ''
  pagination.page = 1
  loadData()
}

const resetForm = () => {
  Object.keys(form).forEach(key => form[key] = '')
  editId.value = null
}

const handleAdd = () => {
  resetForm()
  dialogTitle.value = '新增供应商'
  dialogVisible.value = true
}

const handleEdit = (row) => {
  editId.value = row.id
  Object.keys(form).forEach(key => form[key] = row[key] || '')
  dialogTitle.value = '编辑供应商'
  dialogVisible.value = true
}

const handleSubmit = async () => {
  await formRef.value.validate()
  submitLoading.value = true
  try {
    if (editId.value) {
      await updateSupplier(editId.value, form)
      ElMessage.success('更新成功')
    } else {
      await createSupplier(form)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    loadData()
  } finally {
    submitLoading.value = false
  }
}

const handleDelete = async (row) => {
  let info = null
  try {
    info = await getSupplierOutstanding(row.id)
  } catch (e) {
    return
  }

  if (info.has_debt) {
    await alertInfo(
      '无法删除：该供应商存在欠款',
      `<div>供应商：<b>${info.supplier_name}</b></div>
       <div>未结清应付款：<b style="color:#f56c6c">¥${Number(info.payable).toFixed(2)}</b></div>
       <div>关联采购单：<b>${info.order_count}</b> 张</div>
       <div style="margin-top:8px;color:#909399">请先完成付款，或作废相关采购单后再删除。</div>`,
      'error'
    )
    return
  }

  await confirmDelete(
    `供应商「${info.supplier_name}」`,
    `<div>应付款：<b style="color:#67c23a">¥0.00</b>（已结清）</div>`
  )

  await deleteSupplier(row.id)
  ElMessage.success('删除成功')
  loadData()
}

onMounted(() => loadData())
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
