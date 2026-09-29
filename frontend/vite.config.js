import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    // 不要在每次构建前清空 dist：
    // watch 模式重建时会短暂出现「目录已空但新文件未写完」的窗口，
    // 期间访问页面会拿到 503/404。旧 hash 文件保留，需定期手动清理。
    emptyOutDir: false,
  },
  server: {
    port: 3040,
    proxy: {
      '/api': {
        target: 'http://localhost:3041',
        changeOrigin: true,
      },
      // 商品图片等上传文件由后端提供
      '/uploads': {
        target: 'http://localhost:3041',
        changeOrigin: true,
      }
    }
  }
})
