<template>
  <div>
    <!-- 顶部栏 -->
    <header class="appbar">
      <button v-if="showBack" class="appbar-btn" aria-label="返回" @click="goBack">‹</button>
      <span v-else class="appbar-btn" />

      <div class="appbar-title">{{ title }}</div>

      <button v-if="showBack" class="appbar-btn" aria-label="回工作台" @click="router.push('/m')">⌂</button>
      <span v-else class="appbar-btn" />
    </header>

    <router-view />

    <!-- 底部导航 -->
    <nav v-if="showTabBar" class="tabbar">
      <router-link
        v-for="t in tabs"
        :key="t.to"
        :to="t.to"
        class="tabbar-item"
        :class="{ active: isActive(t) }"
      >
        <svg class="tabbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path :d="t.icon" />
        </svg>
        <span>{{ t.label }}</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isBossView } from '../store'

const route = useRoute()
const router = useRouter()

/** 员工界面 Tab */
const STAFF_TABS = [
  { to: '/m', label: '工作台', icon: 'M3 11 12 4l9 7M5 10.5V20h14v-9.5' },
  { to: '/m/stock', label: '库存', icon: 'M3 8.5 12 4l9 4.5v7L12 20l-9-4.5zM3 8.5 12 13l9-4.5M12 13v7' },
  { to: '/m/sales', label: '销售单', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9.5 8h5M9.5 12h5' },
  { to: '/m/me', label: '我的', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a8 8 0 0 1 15 0' },
]

/** 老板界面 Tab */
const BOSS_TABS = [
  { to: '/m/boss', label: '看板', icon: 'M4 13h4v7H4zM10 9h4v11h-4zM16 5h4v15h-4z' },
  { to: '/m/boss/approve', label: '待审', icon: 'M9 12.5 11 15l4.5-5M5 3.5h14v17H5z' },
  { to: '/m/boss/reports', label: '报表', icon: 'M4 4h16v16H4zM8 15v-4M12 15V8M16 15v-6' },
  { to: '/m/me', label: '我的', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a8 8 0 0 1 15 0' },
]

/**
 * Tab 归属：
 *   - 走的是老板页面 → 老板 Tab（即使当前模式是员工，深链接进来也自洽）
 *   - 员工 Tab 页（工作台/库存/销售单）→ 员工 Tab
 *   - 其余（如 /m/me，两端共用）→ 按当前界面模式
 */
const tabs = computed(() => {
  if (route.path.startsWith('/m/boss')) return BOSS_TABS
  if (route.meta.staffTab) return STAFF_TABS
  return isBossView.value ? BOSS_TABS : STAFF_TABS
})

const title = computed(() => route.meta.title || '进销存')
const isTabRoute = computed(() => !!route.meta.tab)
const showTabBar = computed(() => isTabRoute.value)
const showBack = computed(() => !isTabRoute.value)

function isActive(t) {
  // /m 只有精确匹配，否则 /m/stock、/m/sales 都会把它点亮
  if (t.to === '/m') return route.path === '/m' || route.path === '/m/'
  // 其余取前缀匹配，但 /m/boss 不能被 /m/boss/approve 点亮
  if (t.to === '/m/boss') return route.path === '/m/boss' || route.path === '/m/boss/'
  return route.path === t.to || route.path.startsWith(t.to + '/')
}

function goBack() {
  // 没有上一页（比如直接打开链接）时回工作台，避免退出应用
  if (window.history.length > 1) router.back()
  else router.push('/m')
}
</script>
