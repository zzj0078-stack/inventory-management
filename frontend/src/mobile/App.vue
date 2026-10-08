<template>
  <router-view />

  <!-- 安装到主屏幕引导（安卓调系统安装框，iOS 给图文步骤） -->
  <InstallGuide />

  <!-- 全局提示（替代 ElMessage） -->
  <div class="toast-wrap">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.message }}</div>
  </div>

  <!-- 全局底部确认（替代 ElMessageBox.confirm） -->
  <div v-if="confirmState.visible" class="mask" @click.self="resolveConfirm(false)">
    <div class="sheet">
      <div class="sheet-title">{{ confirmState.title }}</div>
      <div class="sheet-text">{{ confirmState.message }}</div>
      <div class="btn-row">
        <button class="btn" @click="resolveConfirm(false)">{{ confirmState.cancelText }}</button>
        <button
          class="btn"
          :class="confirmState.danger ? 'btn-solid-danger' : 'btn-primary'"
          @click="resolveConfirm(true)"
        >
          {{ confirmState.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toasts, confirmState, resolveConfirm } from './store'
import InstallGuide from './views/InstallGuide.vue'
</script>
