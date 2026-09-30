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
            <span class="chip" :class="isAdmin ? 'red' : 'gray'">
              {{ isAdmin ? '超级管理员' : u.role_label || u.role_name || '未分配角色' }}
            </span>
          </div>
        </div>
      </div>
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
import { session, isAdmin, clearSession, toast, confirmSheet } from '../store'

const router = useRouter()

const u = computed(() => session.user || {})
const initial = computed(() => {
  const name = (session.user && (session.user.full_name || session.user.username)) || '?'
  return String(name).slice(0, 1)
})

const links = [
  { label: '客户欠款', to: '/m/customers' },
  { label: '销售单', to: '/m/sales' },
  { label: '采购收货', to: '/m/purchase' },
  { label: '出入库明细', to: '/m/logs' },
]

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
