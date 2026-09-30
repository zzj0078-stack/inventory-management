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

const route = useRoute()
const router = useRouter()

const tabs = [
  { to: '/m', label: '工作台', icon: 'M3 11 12 4l9 7M5 10.5V20h14v-9.5' },
  { to: '/m/stock', label: '库存', icon: 'M3 8.5 12 4l9 4.5v7L12 20l-9-4.5zM3 8.5 12 13l9-4.5M12 13v7' },
  { to: '/m/sales', label: '销售单', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9.5 8h5M9.5 12h5' },
  { to: '/m/me', label: '我的', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a8 8 0 0 1 15 0' },
]

const title = computed(() => route.meta.title || '进销存')
const isTabRoute = computed(() => !!route.meta.tab)
const showTabBar = computed(() => isTabRoute.value)
const showBack = computed(() => !isTabRoute.value)

function isActive(t) {
  if (t.to === '/m') return route.path === '/m' || route.path === '/m/'
  return route.path.startsWith(t.to)
}

function goBack() {
  // 没有上一页（比如直接打开链接）时回工作台，避免退出应用
  if (window.history.length > 1) router.back()
  else router.push('/m')
}
</script>
