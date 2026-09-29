import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { login as loginApi, getMe, logoutApi } from '../api/modules'
import api from '../api'

export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('token') || '')
  const userInfo = ref(null)
  const permissions = ref([])
  /** 权限是否已从后端加载过 */
  const permLoaded = ref(false)
  const roleName = ref('')

  const login = async (username, password) => {
    const res = await loginApi({ username, password })
    token.value = res.access_token
    userInfo.value = res.user
    localStorage.setItem('token', res.access_token)
    permLoaded.value = false
    await fetchPermissions()
    return res
  }

  const logout = async () => {
    try {
      if (token.value) await logoutApi()
    } catch (e) {
      // 忽略：本地照常退出
    }
    token.value = ''
    userInfo.value = null
    permissions.value = []
    roleName.value = ''
    permLoaded.value = false
    localStorage.removeItem('token')
  }

  const fetchUserInfo = async () => {
    if (!token.value) return
    try {
      const res = await getMe()
      userInfo.value = res
      await fetchPermissions()
    } catch (e) {
      logout()
    }
  }

  const fetchPermissions = async () => {
    try {
      const res = await api.get('/auth/my-permissions')
      permissions.value = res.permissions || []
      roleName.value = res.role_name || ''
    } catch (e) {
      permissions.value = []
      roleName.value = ''
    } finally {
      permLoaded.value = true
    }
  }

  /** 是否有权限（多个参数为 OR 语义） */
  const hasPermission = (...codes) => {
    if (permissions.value.includes('*')) return true
    return codes.some(c => permissions.value.includes(c))
  }

  /** 管理员角色（后端返回通配符） */
  const isAdminRole = computed(() => permissions.value.includes('*'))

  const isAdmin = computed(() => isAdminRole.value)

  return {
    token,
    userInfo,
    permissions,
    permLoaded,
    roleName,
    isAdminRole,
    login,
    logout,
    fetchUserInfo,
    fetchPermissions,
    hasPermission,
    isAdmin
  }
})
