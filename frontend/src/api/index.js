import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import router from '../router'

const api = axios.create({
  baseURL: '/api',
  timeout: 20000,
})

/** 把后端错误统一转成可读字符串 */
function formatError(error) {
  const resp = error.response
  if (!resp) {
    if (error.code === 'ECONNABORTED') return '请求超时，请检查后端服务是否运行'
    return '网络错误：无法连接后端 (http://localhost:3041)'
  }

  const data = resp.data
  const detail = data && data.detail

  // FastAPI 校验错误：detail 是数组
  if (Array.isArray(detail)) {
    return detail.map(d => {
      const field = Array.isArray(d.loc) ? d.loc.filter(x => x !== 'body').join('.') : ''
      return field ? `${field}: ${d.msg}` : d.msg
    }).join('；')
  }

  if (typeof detail === 'string' && detail) return detail

  if (resp.status === 404) return `接口不存在 (404)：${resp.config?.url || ''}`
  if (resp.status === 422) return '参数校验失败 (422)'
  if (resp.status === 500) return '服务器内部错误 (500)，请查看后端控制台日志'
  return `请求失败 (${resp.status})`
}

/** 500 用弹窗展示完整原因，便于复制 */
function showServerError(detail, url) {
  ElMessageBox.alert(
    `<div style="line-height:2;word-break:break-all">
       <div><b>请求：</b>${String(url || '').replace(/</g, '&lt;')}</div>
       <div><b>原因：</b><span style="color:#f56c6c">${String(detail).replace(/</g, '&lt;')}</span></div>
       <div style="margin-top:8px;color:#909399;font-size:12px">完整堆栈请查看后端控制台窗口</div>
     </div>`,
    '服务器错误 (500)',
    { dangerouslyUseHTMLString: true, confirmButtonText: '知道了', type: 'error' }
  ).catch(() => {})
}

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  },
  (error) => Promise.reject(error)
)

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const status = error.response?.status

    if (status === 401) {
      localStorage.removeItem('token')
      router.push('/login')
      ElMessage.error('登录已过期，请重新登录')
    } else if (status === 500) {
      showServerError(error.response?.data?.detail || '未知错误', error.config?.url)
    } else {
      ElMessage.error({
        message: formatError(error),
        duration: 6000,
        showClose: true
      })
    }

    console.error(
      '[API ERROR]',
      error.config?.method?.toUpperCase(),
      error.config?.url,
      error.response?.status,
      error.response?.data
    )
    return Promise.reject(error)
  }
)

export default api
