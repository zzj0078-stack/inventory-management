<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>仓库管理</span>
          <el-button v-permission="'warehouse:add'" type="primary" @click="handleAdd">
            <el-icon><Plus /></el-icon> 新增仓库
          </el-button>
        </div>
      </template>

      <el-table :data="list" v-loading="loading" border stripe style="width:100%">
        <el-table-column prop="id" label="ID" width="70" align="center" />
        <el-table-column prop="name" label="仓库名称" min-width="180" />
        <el-table-column prop="address" label="地址" min-width="240" />
        <el-table-column prop="manager" label="负责人" width="120" />
        <el-table-column prop="phone" label="联系电话" width="150" />
        <el-table-column prop="status" label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
              {{ row.status === 1 ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center">
          <template #default="{ row }">
            <el-button v-permission="'warehouse:edit'" type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button v-permission="'warehouse:delete'" type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dlgVisible" :title="title" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="仓库名称" prop="name">
          <el-input v-model="form.name" placeholder="如：深圳主仓库" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" placeholder="仓库地址" />
        </el-form-item>
        <el-form-item label="负责人">
          <el-input v-model="form.manager" placeholder="仓管姓名" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="form.phone" placeholder="手机号" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getWarehouses, createWarehouse, updateWarehouse, deleteWarehouse } from '../api/modules'
import { ElMessage } from 'element-plus'
import { confirmDelete } from '../utils/confirm'

const loading = ref(false)
const submitting = ref(false)
const list = ref([])
const dlgVisible = ref(false)
const title = ref('')
const formRef = ref(null)
const editId = ref(null)

const form = reactive({ name: '', address: '', manager: '', phone: '' })
const rules = { name: [{ required: true, message: '请输入仓库名称', trigger: 'blur' }] }

const load = async () => {
  loading.value = true
  try {
    list.value = await getWarehouses()
  } finally {
    loading.value = false
  }
}

const reset = () => {
  form.name = ''
  form.address = ''
  form.manager = ''
  form.phone = ''
  editId.value = null
}

const handleAdd = () => {
  reset()
  title.value = '新增仓库'
  dlgVisible.value = true
}

const handleEdit = (row) => {
  editId.value = row.id
  form.name = row.name || ''
  form.address = row.address || ''
  form.manager = row.manager || ''
  form.phone = row.phone || ''
  title.value = '编辑仓库'
  dlgVisible.value = true
}

const submit = async () => {
  await formRef.value.validate()
  submitting.value = true
  try {
    if (editId.value) {
      await updateWarehouse(editId.value, form)
      ElMessage.success('更新成功')
    } else {
      await createWarehouse(form)
      ElMessage.success('创建成功')
    }
    dlgVisible.value = false
    load()
  } finally {
    submitting.value = false
  }
}

const handleDelete = async (row) => {
  await confirmDelete(`仓库「${row.name}」`, '仓库内仍有库存时无法删除。')
  await deleteWarehouse(row.id)
  ElMessage.success('删除成功')
  load()
}

onMounted(() => load())
</script>

<style scoped>
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>
