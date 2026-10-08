<template>
  <div class="page with-tabbar">
    <!-- 账号信息 -->
    <div class="card">
      <div class="profile">
        <div class="avatar">{{ initial }}</div>
        <div class="grow">
          <div class="bold" style="font-size: 17px">{{ u.full_name || u.username || '—' }}</div>
          <div class="small muted mt8">{{ u.username }}</div>
          <div class="mt8">
            <span class="chip" :class="isAdmin ? 'red' : isBossRole ? 'orange' : 'gray'">
              {{ isAdmin ? '超级管理员' : u.role_label || u.role_name || '未分配角色' }}
            </span>
            <span v-if="isBossRole" class="chip" :class="isBossView ? '' : 'gray'" style="margin-left: 6px">
              {{ viewLabel }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 界面切换（仅老板角色可见） -->
    <div v-if="isBossRole" class="card">
      <div class="card-title">界面</div>
      <div class="tiny muted-3">
        老板界面看经营数据与审核；员工界面用于开单、发货、收货等日常操作。
      </div>
      <button class="btn btn-block mt12" @click="toggleView">
        切换到{{ isBossView ? '员工' : '老板' }}界面
      </button>
    </div>

    <!-- 安装到主屏幕（已安装则不显示） -->
    <div v-if="canOfferInstall()" class="card">
      <div class="card-title">安装到主屏幕</div>
      <div class="tiny muted-3">
        装到桌面后像 App 一样全屏打开，不用每次输网址。
      </div>
      <button class="btn btn-primary btn-block mt12" @click="openInstallGuide">
        安装到主屏幕
      </button>
    </div>

    <!-- 常用入口 -->
    <div class="card card-tight">
      <button v-for="l in links" :key="l.to" class="list-item" @click="router.push(l.to)">
        <div class="between">
          <span>{{ l.label }}</span>
          <span class="muted-3">›</span>
        </div>
      </button>
      <button class="list-item" @click="pwdVisible = true">
        <div class="between">
          <span>修改密码</span>
          <span class="muted-3">›</span>
        </div>
      </button>
    </div>

    <button class="btn btn-danger btn-block" @click="logout">退出登录</button>

    <div class="center tiny muted-3 mt16">
      移动端 · 数据与桌面端实时同步<br />
      需要更多功能请用电脑打开桌面端
    </div>

    <!-- 修改密码弹层 -->
    <div v-if="pwdVisible" class="mask" @click.self="pwdVisible = false">
      <div class="sheet">
        <div class="sheet-title">修改密码</div>

        <div class="field">
          <label class="field-label">原密码</label>
          <input v-model="pwd.old_password" type="password" class="input" autocomplete="current-password" />
        </div>
        <div class="field">
          <label class="field-label">新密码</label>
          <input v-model="pwd.new_password" type="password" class="input" autocomplete="new-password"
                 placeholder="至少 8 位，含特殊字符" />
        </div>
        <div class="field">
          <label class="field-label">确认新密码</label>
          <input v-model="pwd.confirm" type="password" class="input" autocomplete="new-password" />
        </div>

        <div class="field-hint">至少 8 位，需含至少 1 个特殊字符（如 ! @ # $ % ^ &amp; *），不能有空格</div>

        <div class="btn-row mt16">
          <button class="btn" @click="pwdVisible = false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submitPwd">
            {{ saving ? '提交中…' : '确定' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { api, errMsg } from '../api'
import {
  session,
  isAdmin,
  isBossRole,
  isBossView,
  setViewMode,
  hasPerm,
  clearSession,
  toast,
  confirmSheet,
  canOfferInstall,
  openInstallGuide,
} from '../store'

const router = useRouter()

const u = computed(() => session.user || {})
const initial = computed(() => {
  const name = (session.user && (session.user.full_name || session.user.username)) || '?'
  return String(name).slice(0, 1)
})

const viewLabel = computed(() => (isBossView.value ? '老板界面' : '员工界面'))

function toggleView() {
  const toBoss = !isBossView.value
  setViewMode(toBoss ? 'boss' : 'staff')
  // 换界面同时换落地页，否则会停在一个跟新 Tab 不匹配的页面上
  router.replace(toBoss ? '/m/boss' : '/m')
}

/** 只显示当前账号有权限的入口，避免点进去吃 403 */
const allLinks = [
  { label: '客户欠款', to: '/m/customers', perm: 'customer:view' },
  { label: '销售单', to: '/m/sales', perm: 'sales:view' },
  { label: '采购收货', to: '/m/purchase/receive', perm: 'purchase:receive' },
  { label: '出入库明细', to: '/m/logs', perm: 'stocklog:view' },
]
const links = allLinks.filter((l) => hasPerm(l.perm))

const pwdVisible = ref(false)
const saving = ref(false)
const pwd = reactive({ old_password: '', new_password: '', confirm: '' })

async function submitPwd() {
  if (!pwd.old_password) return toast.error('请输入原密码')
  if (!pwd.new_password) return toast.error('请输入新密码')
  if (pwd.new_password !== pwd.confirm) return toast.error('两次输入的新密码不一致')

  saving.value = true
  try {
    await api.changePassword({ old_password: pwd.old_password, new_password: pwd.new_password })
    toast.success('密码已修改，请重新登录')
    pwdVisible.value = false
    pwd.old_password = pwd.new_password = pwd.confirm = ''
    clearSession()
    router.replace({ name: 'login' })
  } catch (e) {
    if (!e.friendlyMessage) toast.error(errMsg(e, '修改失败'))
  } finally {
    saving.value = false
  }
}

async function logout() {
  const ok = await confirmSheet({
    title: '退出登录',
    message: '确定要退出当前账号吗？',
    confirmText: '退出',
    danger: true,
  })
  if (!ok) return
  clearSession()
  router.replace({ name: 'login' })
}
</script>
