/**
 * 移动端入口
 *
 * 只引 vue / vue-router / 自己的样式 —— **不引 Element Plus**，
 * 所以手机包体远小于桌面端（桌面端主包 ~1.2 MB）。
 */
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles.css'

const app = createApp(App)
app.use(router)
app.mount('#app')

// Service Worker：让「添加到主屏幕」后能像 App 一样打开。
// 与桌面端共用同一份 /sw.js —— 两个 SW 同 scope 会互相覆盖，必须只注册一个。
// 只在 https 或 localhost 下注册，失败不影响使用。
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败（如不支持）时静默忽略，不影响功能 */
    })
  })
}
