<template>
  <div class="login-page">
    <div class="login-brand">
      <div class="login-logo">进</div>
      <h1>进销存 · 移动端</h1>
      <p>业务员 / 仓库 外出办公</p>
    </div>

    <form class="card" @submit.prevent="submit">
      <div class="field">
        <label class="field-label">登录名</label>
        <input
          v-model.trim="form.username"
          class="input"
          autocomplete="username"
          autocapitalize="none"
          placeholder="请输入登录名"
        />
      </div>

      <div class="field">
        <label class="field-label">密码</label>
        <input
          v-model="form.password"
          type="password"
          class="input"
          autocomplete="current-password"
          placeholder="请输入密码"
        />
      </div>

      <button class="btn btn-primary btn-block" type="submit" :disabled="loading">
        {{ loading ? '登录中…' : '登录' }}
      </button>

      <div class="field-hint center mt12">
        登录后可在「我的」里修改密码
      </div>
    </form>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, errMsg } from '../api'
import { setToken, clearSession, toast, session } from '../store'
import { loadSession } from '../router'

const route = useRoute()
const router = useRouter()

const form = reactive({ username: '', password: '' })
const loading = ref(false)

async function submit() {
  if (!form.username) return toast.error('请输入登录名')
  if (!form.password) return toast.error('请输入密码')

  loading.value = true
  try {
    const res = await api.login({ username: form.username, password: form.password })
    setToken(res.access_token)
    session.user = res.user
    session.state = '未加载'
    // 预加载权限，避免进首页再闪一次
    await loadSession()
    toast.success(`欢迎，${res.user.full_name || res.user.username}`)
    const target = route.query.redirect || '/m'
    router.replace(target)
  } catch (e) {
    // 401 的具体文案由拦截器给出（用户名或密码错误）
    if (!e.friendlyMessage) toast.error(errMsg(e, '登录失败'))
    clearSession()
  } finally {
    loading.value = false
  }
}
</script>
