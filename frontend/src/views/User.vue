<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>用户管理</span>
          <el-button v-permission="'user:add'" type="primary" @click="handleAdd">
            <el-icon><Plus /></el-icon> 新增用户
          </el-button>
        </div>
      </template>

      <el-form :inline="true" :model="searchForm">
        <el-form-item label="关键词">
          <el-input v-model="searchForm.keyword" placeholder="用户名/姓名/手机/邮箱" clearable style="width:200px" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="searchForm.role_id" placeholder="全部角色" clearable :value-on-clear="null" style="width:150px">
            <el-option v-for="r in roles" :key="r.id" :label="r.description || r.name" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" placeholder="全部" clearable :value-on-clear="null" style="width:110px">
            <el-option :value="1" label="启用" /><el-option :value="0" label="禁用" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetSearch">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="tableData" v-loading="loading" border stripe style="width:100%">
        <el-table-column prop="id" label="ID" width="60" align="center" />
        <el-table-column prop="username" label="登录名" width="120" show-overflow-tooltip />
        <el-table-column prop="full_name" label="姓名" width="110">
          <template #default="{ row }">{{ row.full_name || '-' }}</template>
        </el-table-column>
        <el-table-column label="角色" width="150">
          <template #default="{ row }">
            <el-tag v-if="row.is_admin" type="danger" size="small">超级管理员</el-tag>
            <el-tag v-else-if="row.role_name" type="primary" size="small">{{ row.role_label || row.role_name }}</el-tag>
            <el-tag v-else type="warning" size="small">未分配角色</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="权限数" width="90" align="center">
          <template #default="{ row }">
            <span v-if="row.is_admin" style="color:#f56c6c;font-weight:bold">全部</span>
            <span v-else :style="{ color: row.permission_count ? '#606266' : '#e6a23c' }">
              {{ row.permission_count ?? 0 }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱" min-width="170" show-overflow-tooltip />
        <el-table-column prop="phone" label="手机" width="130">
          <template #default="{ row }">{{ row.phone || '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" align="center">
          <template #default="{ row }">
            <el-button v-permission="'user:edit'" type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button v-permission="'user:resetpwd'" type="warning" link size="small" @click="handleResetPwd(row)">重置密码</el-button>
            <el-button v-permission="'user:delete'" type="danger" link size="small"
              @click="handleDelete(row)" :disabled="row.username === 'admin'">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        style="margin-top:16px;justify-content:flex-end"
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next"
        @change="loadData"
      />
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="登录名" prop="username">
          <el-input v-model="form.username" placeholder="英文或拼音，用于登录" :disabled="!!editId" />
        </el-form-item>
        <el-form-item v-if="!editId" label="密码" prop="password">
          <el-input v-model="form.password" type="password" placeholder="至少 8 位，含特殊字符" show-password />
        </el-form-item>
        <el-form-item label="姓名" prop="full_name">
          <el-input v-model="form.full_name" placeholder="真实姓名" />
        </el-form-item>
        <el-form-item label="角色" prop="role_id">
          <el-select v-model="form.role_id" placeholder="请选择角色（决定该用户的权限）" style="width:100%">
            <el-option v-for="r in roles" :key="r.id" :label="r.description || r.name" :value="r.id">
              <span style="float:left">{{ r.description || r.name }}</span>
              <span style="float:right;color:#909399;font-size:12px">
                {{ r.name === 'admin' ? '全部权限' : (r.permission_ids || []).length + ' 项' }}
              </span>
            </el-option>
          </el-select>
          <div class="form-hint">用户权限完全由角色决定，如需调整请到「角色权限」页面配置。</div>
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="用于登录与通知" />
        </el-form-item>
        <el-form-item label="手机">
          <el-input v-model="form.phone" placeholder="选填" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="禁用" />
        </el-form-item>
        <el-alert
          v-if="!editId"
          type="info"
          :closable="false"
          show-icon
          :title="PASSWORD_RULES_TEXT"
          style="margin-left:100px"
        />
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
import { getUsers, createUser, updateUser, deleteUser, getRoles, resetPassword } from '../api/modules'
import { ElMessage, ElMessageBox } from 'element-plus'
import { confirmDelete } from '../utils/confirm'
import { passwordRule, validatePassword, PASSWORD_RULES_TEXT } from '../utils/password'

const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const roles = ref([])
const dialogVisible = ref(false)
const dialogTitle = ref('')
const formRef = ref(null)
const editId = ref(null)

const searchForm = reactive({ keyword: '', role_id: null, status: null })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

const form = reactive({
  username: '',
  password: '',
  full_name: '',
  email: '',
  phone: '',
  role_id: null,
  status: 1
})

const rules = {
  username: [{ required: true, message: '请输入登录名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    passwordRule()
  ],
  full_name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' }
  ],
  role_id: [{ required: true, message: '请选择角色，否则该用户无任何权限', trigger: 'change' }]
}

const loadData = async () => {
  loading.value = true
  try {
    const res = await getUsers({
      page: pagination.page,
      page_size: pagination.pageSize,
      keyword: searchForm.keyword,
      role_id: searchForm.role_id,
      status: searchForm.status
    })
    tableData.value = res.items
    pagination.total = res.total
  } finally {
    loading.value = false
  }
}

const loadRoles = async () => {
  try {
    const r = await getRoles()
    roles.value = Array.isArray(r) ? r : []
    if (!roles.value.length) {
      ElMessage.warning('未获取到任何角色，请先到「角色权限」页面创建角色')
    }
  } catch (e) {
    roles.value = []
    // 拦截器已提示具体原因（如 403 权限不足）
  }
}

const resetSearch = () => {
  searchForm.keyword = ''
  searchForm.role_id = null
  searchForm.status = null
  pagination.page = 1
  loadData()
}

const resetForm = () => {
  form.username = ''
  form.password = ''
  form.full_name = ''
  form.email = ''
  form.phone = ''
  form.role_id = null
  form.status = 1
  editId.value = null
}

const handleAdd = async () => {
  resetForm()
  if (!roles.value.length) await loadRoles()
  dialogTitle.value = '新增用户'
  dialogVisible.value = true
}

const handleEdit = async (row) => {
  if (!roles.value.length) await loadRoles()
  editId.value = row.id
  form.username = row.username
  form.password = ''
  form.full_name = row.full_name || ''
  form.email = row.email || ''
  form.phone = row.phone || ''
  form.role_id = row.role_id
  form.status = row.status
  dialogTitle.value = '编辑用户'
  dialogVisible.value = true
}

const handleSubmit = async () => {
  await formRef.value.validate()
  submitLoading.value = true
  try {
    if (editId.value) {
      const payload = {
        username: form.username,
        full_name: form.full_name,
        email: form.email,
        phone: form.phone,
        role_id: form.role_id,
        status: form.status
      }
      await updateUser(editId.value, payload)
      ElMessage.success('更新成功')
    } else {
      await createUser({
        username: form.username,
        password: form.password,
        full_name: form.full_name,
        email: form.email,
        phone: form.phone,
        role_id: form.role_id
      })
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    loadData()
  } catch (e) {
    // 错误已由拦截器提示
  } finally {
    submitLoading.value = false
  }
}

const handleResetPwd = async (row) => {
  try {
    const { value } = await ElMessageBox.prompt(
      `为用户「${row.username}」设置新密码：`,
      '重置密码',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: '',
        inputType: 'password',
        inputPlaceholder: '至少 8 位，必须含特殊字符（如 ! @ # $ % ^ & *）'
      }
    )

    const err = validatePassword(value)
    if (err) {
      ElMessage.error(err)
      return
    }

    await resetPassword({ user_id: row.id, new_password: value })
    ElMessage.success(`用户「${row.username}」的密码已重置`)
  } catch (e) {
    // 取消或失败（接口错误已由拦截器提示）
  }
}

const handleDelete = async (row) => {
  await confirmDelete(
    `用户「${row.full_name || row.username}」`,
    `登录名：${row.username}　角色：${row.role_label || row.role_name || '未分配'}`
  )
  await deleteUser(row.id)
  ElMessage.success('删除成功')
  loadData()
}

onMounted(async () => {
  await loadRoles()
  await loadData()
})
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.form-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
  margin-top: 2px;
}
</style>
