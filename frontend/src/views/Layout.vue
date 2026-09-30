<template>
  <div class="layout" v-if="loaded">
    <el-container style="height: 100vh;">
      <el-aside width="200px" style="background-color: #001529;">
        <div class="logo">进销存系统</div>
        <el-menu
          :default-active="route.path"
          router
          background-color="#001529"
          text-color="#fff"
          active-text-color="#409eff"
          style="border-right: none;"
          :unique-opened="true"
        >
          <el-menu-item index="/dashboard" v-if="userStore.hasPermission('dashboard:view')"><el-icon><HomeFilled /></el-icon><span>首页</span></el-menu-item>
          
          <el-sub-menu index="base">
            <template #title><el-icon><Grid /></el-icon><span>基础数据</span></template>
            <el-menu-item index="/suppliers" v-if="userStore.hasPermission('supplier:view')">供应商管理</el-menu-item>
            <el-menu-item index="/customers" v-if="userStore.hasPermission('customer:view')">客户管理</el-menu-item>
            <el-menu-item index="/products" v-if="userStore.hasPermission('product:view')">商品管理</el-menu-item>
          </el-sub-menu>

          <el-sub-menu index="purchase">
            <template #title><el-icon><ShoppingCart /></el-icon><span>采购管理</span></template>
            <el-menu-item index="/purchase" v-if="userStore.hasPermission('purchase:view')">采购订单</el-menu-item>
            <el-menu-item index="/purchase-return" v-if="userStore.hasPermission('purchase_return:view')">采购退货</el-menu-item>
          </el-sub-menu>

          <el-sub-menu index="sales">
            <template #title><el-icon><Sell /></el-icon><span>销售管理</span></template>
            <el-menu-item index="/sales" v-if="userStore.hasPermission('sales:view')">销售订单</el-menu-item>
            <el-menu-item index="/sale-return" v-if="userStore.hasPermission('sale_return:view')">销售退货</el-menu-item>
          </el-sub-menu>

          <el-sub-menu index="inventory">
            <template #title><el-icon><Box /></el-icon><span>库存管理</span></template>
            <el-menu-item index="/inventory" v-if="userStore.hasPermission('inventory:view')">库存查询</el-menu-item>
            <el-menu-item index="/warehouses" v-if="userStore.hasPermission('warehouse:view')">仓库管理</el-menu-item>
            <el-menu-item index="/stock-transfer" v-if="userStore.hasPermission('transfer:view')">库存调拨</el-menu-item>
            <el-menu-item index="/stock-check" v-if="userStore.hasPermission('stockcheck:view')">库存盘点</el-menu-item>
            <el-menu-item index="/stock-log" v-if="userStore.hasPermission('stocklog:view')">出入库明细</el-menu-item>
          </el-sub-menu>

          <el-sub-menu index="finance">
            <template #title><el-icon><Money /></el-icon><span>财务管理</span></template>
            <el-menu-item index="/payment" v-if="userStore.hasPermission('finance:view')">收付款</el-menu-item>
          </el-sub-menu>

          <el-sub-menu index="report">
            <template #title><el-icon><DataAnalysis /></el-icon><span>报表统计</span></template>
            <el-menu-item index="/report" v-if="userStore.hasPermission('report:view')">报表中心</el-menu-item>
          </el-sub-menu>

          <el-sub-menu index="system" v-if="hasSystemMenu">
            <template #title><el-icon><Setting /></el-icon><span>系统管理</span></template>
            <el-menu-item index="/users" v-if="userStore.hasPermission('user:view')">用户管理</el-menu-item>
            <el-menu-item index="/roles" v-if="userStore.hasPermission('role:view')">角色权限</el-menu-item>
            <el-menu-item index="/logs" v-if="userStore.hasPermission('log:view')">操作日志</el-menu-item>
            <el-menu-item index="/health" v-if="userStore.hasPermission('system:check')">数据自检</el-menu-item>
            <el-menu-item index="/print" v-if="userStore.hasPermission('system:print')">打印模板</el-menu-item>
          </el-sub-menu>
        </el-menu>
      </el-aside>
      
      <el-container>
        <el-header style="background: white; display: flex; justify-content: flex-end; align-items: center; box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
          <div style="display: flex; align-items: center; gap: 16px;">
            <el-dropdown @command="handleCommand">
              <span style="cursor: pointer;">
                {{ userStore.userInfo?.full_name || '管理员' }}
                <el-icon><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="password">修改密码</el-dropdown-item>
                  <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-header>
        
        <el-main style="background: #f0f2f5;">
          <router-view />
        </el-main>
      </el-container>
    </el-container>
    
    <!-- 修改密码对话框 -->
    <el-dialog v-model="pwdDialogVisible" title="修改密码" width="400px">
      <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="100px">
        <el-form-item label="原密码" prop="old_password">
          <el-input v-model="pwdForm.old_password" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码" prop="new_password">
          <el-input v-model="pwdForm.new_password" type="password" show-password placeholder="至少 8 位，含特殊字符" />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirm_password">
          <el-input v-model="pwdForm.confirm_password" type="password" show-password />
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon :title="PASSWORD_RULES_TEXT" style="margin-left:100px" />
      </el-form>
      <template #footer>
        <el-button @click="pwdDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdLoading" @click="handleChangePassword">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../store/user'
import { changePassword } from '../api/modules'
import { passwordRule, PASSWORD_RULES_TEXT } from '../utils/password'
import { ElMessage } from 'element-plus'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const loaded = ref(false)

/** 系统管理子菜单是否可见 */
const hasSystemMenu = computed(() =>
  ['user:view', 'role:view', 'log:view', 'system:check', 'system:print']
    .some(c => userStore.hasPermission(c))
)

// 修改密码
const pwdDialogVisible = ref(false)
const pwdLoading = ref(false)
const pwdFormRef = ref(null)
const pwdForm = reactive({ old_password: '', new_password: '', confirm_password: '' })
const pwdRules = {
  old_password: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  new_password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    passwordRule()
  ],
  confirm_password: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    {
      validator: (rule, value, callback) => {
        if (value !== pwdForm.new_password) {
          callback(new Error('两次密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

onMounted(async () => {
  // 路由守卫通常已加载过，这里兜底
  if (!userStore.permLoaded) {
    await userStore.fetchUserInfo()
  }
  loaded.value = true
})

const handleCommand = (cmd) => {
  if (cmd === 'password') {
    pwdForm.old_password = ''
    pwdForm.new_password = ''
    pwdForm.confirm_password = ''
    pwdDialogVisible.value = true
  } else if (cmd === 'logout') {
    handleLogout()
  }
}

const handleChangePassword = async () => {
  await pwdFormRef.value.validate()
  pwdLoading.value = true
  try {
    await changePassword({
      old_password: pwdForm.old_password,
      new_password: pwdForm.new_password
    })
    ElMessage.success('密码修改成功')
    pwdDialogVisible.value = false
  } finally {
    pwdLoading.value = false
  }
}

const handleLogout = () => {
  userStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.logo {
  height: 50px;
  display: flex;
  justify-content: center;
  align-items: center;
  color: white;
  font-size: 16px;
  font-weight: bold;
}
</style>

<style>
/* 菜单行高 */
.el-menu-item, .el-sub-menu__title {
  height: 40px !important;
  line-height: 40px !important;
  font-size: 13px !important;
}
.el-menu-item .el-icon, .el-sub-menu__title .el-icon {
  font-size: 14px !important;
  margin-right: 6px !important;
}
.el-sub-menu .el-menu-item {
  padding-left: 50px !important;
}
</style>
