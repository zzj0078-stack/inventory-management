# PWA：添加到主屏幕（桌面端）

桌面端与移动端各有一份 manifest，但**共用同一个 Service Worker**。

| 文件 | 作用 |
|------|------|
| `index.html` | 桌面端 PWA meta（`theme-color`、`apple-mobile-web-app-*`）、启动画面、安装提示条 |
| `public/manifest.json` | 桌面端清单：`start_url: /`、6 个应用快捷方式 |
| `public/sw.js` | **统一 Service Worker**（桌面端 + 移动端共用） |
| `public/icon-{192,512}.png` | 桌面端图标（由 `cf/make_mobile_icons.py` 生成） |
| `public/mobile-manifest.json` | 移动端清单：`start_url: /m/` |
| `public/mobile-icon-{192,512}.png` | 移动端图标（同一脚本生成） |

## ⚠️ 为什么只有一个 Service Worker

SW 的默认 scope 是**脚本所在目录**。两个脚本都放在根目录时 scope 都是 `/`，
而**同一个 scope 只能存在一个注册** —— 如果桌面端注册 `/sw.js`、移动端注册
`/mobile-sw.js`，两者会互相覆盖，最终生效的是「最后访问的那个页面」，行为不确定。
（这是曾经的真实 bug：`/mobile-sw.js` 已被删除。）

所以统一成一份 `/sw.js`，两个入口（`src/main.js`、`src/mobile/main.js`）都注册它。

缓存策略刻意保守，避免「改了却看到旧页面」：

| 请求 | 策略 |
|------|------|
| 导航（`mode === 'navigate'`） | **网络优先**；断网才回退 shell（`/m/*` → `/m/`，其余 → `/index.html`） |
| `/assets/*`（文件名带 hash，内容不变） | 缓存优先 |
| `/api/*`、`/uploads/*` | 完全不接管 |
| 非 GET、跨域 | 不接管 |

## ⚠️ 图标必须是真正的 PNG

图标一律由 `python cf/make_mobile_icons.py` 生成，**不要手写**。

历史问题：`icon-192.png` / `icon-512.png` 曾被写成「SVG 内容 + `.png` 后缀」，
Pages 按 `image/png` 返回，浏览器解析失败 —— 安装到主屏幕后图标是空白。
另外「圆角 + 透明」再 `convert("RGB")` 会把透明像素变成**黑色**，四角出现黑三角。

现在生成的是**满幅、无透明**的 RGB PNG（`#2f6fed` 底 + 白色「进」），
既满足 maskable 的安全区要求，也不会露黑边。

## 使用方式

安装入口只在 **https 或 localhost** 下注册（`http://` 的局域网 IP 不行，浏览器限制）。

### 桌面端 Chrome/Edge
1. 打开站点（线上 https://inventory-b4k.pages.dev ，本地 http://localhost:3040）
2. 点地址栏右侧的「安装」图标，或页面底部弹出的「安装到主屏幕」提示条

### Android Chrome
打开站点 → 菜单（⋮）→「添加到主屏幕」

### iOS Safari
打开站点 → 分享 →「添加到主屏幕」
