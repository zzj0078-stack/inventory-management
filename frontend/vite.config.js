import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    // 不要在每次构建前清空 dist：
    // watch 模式重建时会短暂出现「目录已空但新文件未写完」的窗口，
    // 期间访问页面会拿到 503/404。旧 hash 文件保留，需定期手动清理。
    emptyOutDir: false,
    rollupOptions: {
      // 双入口：
      //   index.html  桌面端（Element Plus，主包 ~1.2 MB）
      //   mobile.html 移动端（不引 Element Plus，包体小得多）
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        mobile: fileURLToPath(new URL('./mobile.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 3040,
    // 绑 IPv4。不写 host 时 Vite 会绑到 ::1（IPv6），
    // 结果 http://127.0.0.1:3040 打不开，只有 localhost 能开，
    // 看起来就像「本地连不上数据库」。
    // 显式绑 127.0.0.1 后 127.0.0.1 和 localhost 都能访问。
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3041',
        changeOrigin: true,
      },
      // 商品图片等上传文件由后端提供
      '/uploads': {
        target: 'http://127.0.0.1:3041',
        changeOrigin: true,
      }
    }
  }
})
