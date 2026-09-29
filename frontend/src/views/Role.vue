<template>
  <div class="page-container">
    <el-row :gutter="20">
      <!-- 角色列表 -->
      <el-col :span="7">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>角色管理</span>
              <el-button v-permission="'role:add'" type="primary" size="small" @click="handleAddRole">
                <el-icon><Plus /></el-icon> 新增
              </el-button>
            </div>
          </template>
          <el-table :data="roles" border stripe @row-click="handleRoleClick" highlight-current-row v-loading="roleLoading">
            <el-table-column prop="name" label="角色名" width="90" />
            <el-table-column prop="description" label="描述" show-overflow-tooltip />
            <el-table-column label="权限数" width="80" align="center">
              <template #default="{ row }">{{ (row.permission_ids || []).length }}</template>
            </el-table-column>
            <el-table-column label="操作" width="110" align="center">
              <template #default="{ row }">
                <el-button v-permission="'role:edit'" type="primary" link size="small" @click.stop="handleEditRole(row)">编辑</el-button>
                <el-button v-permission="'role:delete'" type="danger" link size="small"
                  @click.stop="handleDeleteRole(row)" :disabled="row.name === 'admin'">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <!-- 权限配置 -->
      <el-col :span="17">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>权限配置 {{ selectedRole ? `- ${selectedRole.name}` : '' }}</span>
              <div v-if="selectedRole">
                <el-button size="small" @click="toggleAll(true)">全选</el-button>
                <el-button size="small" @click="toggleAll(false)">清空</el-button>
                <el-button v-permission="'role:edit'" type="primary" size="small" :loading="saving" @click="handleSaveRole">
                  保存权限
                </el-button>
              </div>
            </div>
          </template>

          <el-empty v-if="!selectedRole" description="请选择左侧角色进行权限配置" />

          <div v-else class="perm-panel">
            <div v-if="selectedRole.name === 'admin'" class="admin-tip">
              <el-tag type="danger" effect="dark" size="small">超级管理员</el-tag>
              <span>该角色固定拥有全部权限，不可修改。</span>
            </div>

            <div v-for="grp in groupedPerms" :key="grp.module" class="perm-group">
              <div class="perm-group-title">
                <el-checkbox
                  :model-value="isGroupAllChecked(grp)"
                  :indeterminate="isGroupIndeterminate(grp)"
                  :disabled="isAdminRole"
                  @change="v => toggleGroup(grp, v)"
                >
                  {{ grp.label }}
                </el-checkbox>
                <span class="perm-group-count">{{ checkedInGroup(grp) }} / {{ grp.perms.length }}</span>
              </div>
              <el-checkbox-group v-model="selectedPermIds" :disabled="isAdminRole" class="perm-group-body">
                <el-checkbox v-for="p in grp.perms" :key="p.id" :label="p.id">{{ p.name }}</el-checkbox>
              </el-checkbox-group>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 角色对话框 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="420px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="角色名" prop="name">
          <el-input v-model="form.name" placeholder="英文标识，如 salesman" :disabled="!!editRoleId" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="form.label" placeholder="中文名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" placeholder="角色职责说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmitRole">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getRoles, createRole, updateRole, deleteRole, getPermissions } from '../api/modules'
import { ElMessage } from 'element-plus'
import { confirmDelete } from '../utils/confirm'

const roleLoading = ref(false)
const submitLoading = ref(false)
const saving = ref(false)
const roles = ref([])
const permissions = ref([])
const selectedRole = ref(null)
const selectedPermIds = ref([])
const dialogVisible = ref(false)
const dialogTitle = ref('')
const formRef = ref(null)
const editRoleId = ref(null)

const form = reactive({ name: '', label: '', description: '' })
const rules = { name: [{ required: true, message: '请输入角色名', trigger: 'blur' }] }

const isAdminRole = computed(() => selectedRole.value?.name === 'admin')

/** 按模块分组（保持后端返回顺序） */
const groupedPerms = computed(() => {
  const map = new Map()
  permissions.value.forEach(p => {
    const key = p.module
    if (!map.has(key)) {
      map.set(key, { module: key, label: p.module_label || p.module, perms: [] })
    }
    map.get(key).perms.push(p)
  })
  return [...map.values()]
})

const checkedInGroup = grp =>
  grp.perms.filter(p => selectedPermIds.value.includes(p.id)).length

const isGroupAllChecked = grp => grp.perms.length > 0 && checkedInGroup(grp) === grp.perms.length
const isGroupIndeterminate = grp => {
  const c = checkedInGroup(grp)
  return c > 0 && c < grp.perms.length
}

const toggleGroup = (grp, checked) => {
  const ids = grp.perms.map(p => p.id)
  if (checked) {
    const set = new Set([...selectedPermIds.value, ...ids])
    selectedPermIds.value = [...set]
  } else {
    selectedPermIds.value = selectedPermIds.value.filter(id => !ids.includes(id))
  }
}

const toggleAll = (checked) => {
  if (isAdminRole.value) return
  selectedPermIds.value = checked ? permissions.value.map(p => p.id) : []
}

const loadRoles = async () => {
  roleLoading.value = true
  try {
    roles.value = await getRoles()
  } finally {
    roleLoading.value = false
  }
}

const loadPermissions = async () => {
  permissions.value = await getPermissions()
}

const handleRoleClick = (row) => {
  selectedRole.value = row
  selectedPermIds.value = [...(row.permission_ids || [])]

  if (row.name === 'admin') {
    // 管理员显示为全选
    selectedPermIds.value = permissions.value.map(p => p.id)
  }
}

const handleAddRole = () => {
  editRoleId.value = null
  form.name = ''
  form.label = ''
  form.description = ''
  dialogTitle.value = '新增角色'
  dialogVisible.value = true
}

const handleEditRole = (row) => {
  editRoleId.value = row.id
  form.name = row.name
  form.label = row.label || ''
  form.description = row.description || ''
  dialogTitle.value = '编辑角色'
  dialogVisible.value = true
}

const handleSubmitRole = async () => {
  await formRef.value.validate()
  submitLoading.value = true
  try {
    const payload = {
      name: form.name,
      description: form.label ? `${form.label}${form.description ? ' - ' + form.description : ''}` : form.description,
      permission_ids: []
    }
    if (editRoleId.value) {
      await updateRole(editRoleId.value, { ...payload, permission_ids: selectedRole.value?.permission_ids || [] })
      ElMessage.success('更新成功')
    } else {
      await createRole(payload)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    await loadRoles()
  } finally {
    submitLoading.value = false
  }
}

const handleSaveRole = async () => {
  if (!selectedRole.value || isAdminRole.value) return
  saving.value = true
  try {
    await updateRole(selectedRole.value.id, {
      name: selectedRole.value.name,
      description: selectedRole.value.description,
      permission_ids: selectedPermIds.value
    })
    ElMessage.success('权限保存成功')
    await loadRoles()
    const fresh = roles.value.find(r => r.id === selectedRole.value.id)
    if (fresh) {
      selectedRole.value = fresh
      selectedPermIds.value = [...(fresh.permission_ids || [])]
    }
  } catch (e) {
    // 错误已由拦截器提示
  } finally {
    saving.value = false
  }
}

const handleDeleteRole = async (row) => {
  await confirmDelete(`角色「${row.name}」`, '该角色下的用户将失去对应权限。')
  await deleteRole(row.id)
  ElMessage.success('删除成功')
  if (selectedRole.value?.id === row.id) selectedRole.value = null
  await loadRoles()
}

onMounted(async () => {
  await loadPermissions()
  await loadRoles()
})
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.perm-panel {
  max-height: 620px;
  overflow-y: auto;
  padding-right: 8px;
}
.admin-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: #fef0f0;
  border-radius: 4px;
  font-size: 13px;
  color: #909399;
}
.perm-group {
  border: 1px solid #ebeef5;
  border-radius: 4px;
  margin-bottom: 10px;
}
.perm-group-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #fafafa;
  border-bottom: 1px solid #ebeef5;
  font-weight: bold;
  font-size: 13px;
}
.perm-group-count {
  font-weight: normal;
  color: #909399;
  font-size: 12px;
}
.perm-group-body {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  padding: 10px 12px;
}
</style>
