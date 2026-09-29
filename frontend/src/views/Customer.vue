<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>客户管理</span>
          <el-button v-permission="'customer:add'" type="primary" @click="handleAdd">
            <el-icon><Plus /></el-icon> 新增客户
          </el-button>
        </div>
      </template>
      
      <el-form :inline="true" :model="searchForm">
        <el-form-item label="关键词">
          <el-input v-model="searchForm.keyword" placeholder="名称/联系人/电话" clearable />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetSearch">重置</el-button>
        </el-form-item>
      </el-form>
      
      <el-table :data="tableData" v-loading="loading" border stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="客户名称" min-width="150" />
        <el-table-column prop="contact" label="联系人" width="120" />
        <el-table-column prop="phone" label="电话" width="140" />
        <el-table-column prop="email" label="邮箱" width="180" />
        <el-table-column prop="credit_limit" label="信用额度" width="120" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'">
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button v-permission="'customer:edit'" type="primary" link @click="handleEdit(row)">编辑</el-button>
            <el-button v-permission="'customer:delete'" type="danger" link @click="handleDelete(row)">删除</el-button>
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
    
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="600px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="客户名称" prop="name">
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
        <el-form-item label="信用额度">
          <el-input-number v-model="form.credit_limit" :min="0" />
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
import { getCustomers, createCustomer, updateCustomer, deleteCustomer, getCustomerOutstanding } from '../api/modules'
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
  credit_limit: 0,
  bank_name: '',
  bank_account: '',
  tax_number: '',
  remark: ''
})

const rules = {
  name: [{ required: true, message: '请输入客户名称', trigger: 'blur' }]
}

const loadData = async () => {
  loading.value = true
  try {
    const res = await getCustomers({
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
  Object.keys(form).forEach(key => form[key] = key === 'credit_limit' ? 0 : '')
  editId.value = null
}

const handleAdd = () => {
  resetForm()
  dialogTitle.value = '新增客户'
  dialogVisible.value = true
}

const handleEdit = (row) => {
  editId.value = row.id
  Object.keys(form).forEach(key => form[key] = row[key] || (key === 'credit_limit' ? 0 : ''))
  dialogTitle.value = '编辑客户'
  dialogVisible.value = true
}

const handleSubmit = async () => {
  await formRef.value.validate()
  submitLoading.value = true
  try {
    if (editId.value) {
      await updateCustomer(editId.value, form)
      ElMessage.success('更新成功')
    } else {
      await createCustomer(form)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    loadData()
  } finally {
    submitLoading.value = false
  }
}

const handleDelete = async (row) => {
  // 先查欠款
  let info = null
  try {
    info = await getCustomerOutstanding(row.id)
  } catch (e) {
    return
  }

  if (info.has_debt) {
    await alertInfo(
      '无法删除：该客户存在欠款',
      `<div>客户：<b>${info.customer_name}</b></div>
       <div>未结清应收款：<b style="color:#f56c6c">¥${Number(info.receivable).toFixed(2)}</b></div>
       <div>关联销售单：<b>${info.order_count}</b> 张</div>
       <div style="margin-top:8px;color:#909399">请先完成收款，或作废相关销售单后再删除。</div>`,
      'error'
    )
    return
  }

  await confirmDelete(
    `客户「${info.customer_name}」`,
    `<div>应收款：<b style="color:#67c23a">¥0.00</b>（已结清）</div>`
  )

  await deleteCustomer(row.id)
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
