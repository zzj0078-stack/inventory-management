# 进销存系统 —— Cloudflare 部署说明

## 为什么是「重写」而不是「部署」

原后端是 **FastAPI + SQLAlchemy（6279 行 Python，104 个接口）**。
Cloudflare Pages Functions / Workers 跑的是 **JavaScript/WASM**，
而 Python Workers 是基于 Pyodide 的 beta 方案，没有 `sqlite3` 文件访问，
**SQLAlchemy 无法工作**。

所以本次是**用 JS 重写后端**，D1 替代 SQLite 文件。

| 层 | 原来 | 现在 |
|---|---|---|
| 后端 | FastAPI + SQLAlchemy | Pages Functions（`functions/api/[[route]].js`） |
| 数据库 | `backend/inventory.db`（文件） | Cloudflare D1（SQLite 兼容） |
| 前端 | 不变，同一份 Vue 构建产物 | 不变 |
| 图片上传 | 本地 `/uploads` 目录 | Cloudflare **KV**（binding `IMAGES`） |

原有 FastAPI 后端**完整保留**在 `backend/`，本地开发/回退仍可用。

---

## 线上资源

| 项 | 值 |
|---|---|
| 生产地址 | https://inventory-b4k.pages.dev |
| Pages 项目 | `inventory` |
| D1 数据库 | `inventory` / `848e0f62-70d6-4d4a-9cb5-d55147f6394e` |
| D1 绑定名 | `DB` |
| 默认账号 | `admin` / `admin123` ← **首次登录后请立即修改** |
| JWT 密钥 | Cloudflare Secret `SECRET_KEY`（不在仓库里） |

---

## 目录结构（Cloudflare 部分）

```
D:\Harness\public\
├── wrangler.toml                  # Pages + D1 配置
├── .dev.vars.example              # 本地密钥模板（.dev.vars 已 gitignore）
├── functions/
│   └── api/
│       └── [[route]].js           # 入口：CORS + 鉴权 + 权限 + 路由分发
└── cf/
    ├── migrations/                # D1 结构迁移（唯一入口）
    │   └── 0001_baseline_schema.sql
    ├── schema.sql                 # 基线快照（= 0001 迁移的内容，仅作参考）
    ├── seed.sql                   # 角色/权限/admin/默认仓库（由 gen_seed.py 生成）
    ├── gen_seed.py                # 从本地 SQLite 生成 seed.sql
    ├── smoke-test.mjs             # 71 项冒烟测试，本地/线上通用
    ├── DEPLOY.md                  # 本文档
    ├── lib/                       # 共享库
    │   ├── time.js                # 业务时区（Asia/Shanghai）
    │   ├── crypto.js              # 密码哈希 + JWT（WebCrypto）
    │   ├── db.js                  # D1 封装
    │   ├── http.js                # 响应/错误/分页
    │   ├── perms.js               # 权限判定
    │   ├── permissions.js         # 权限模块中文分组
    │   ├── password.js            # 密码强度策略
    │   ├── users.js               # 用户响应体构造
    │   └── oplog.js               # 操作日志
    └── routes/                    # 业务路由
        ├── auth.js                # 登录/改密/权限/角色
        ├── users.js
        ├── products.js            # 商品 + 分类
        ├── customers.js
        ├── suppliers.js
        └── inventory.js           # 仓库 + 库存查询
```

---

## 常用命令

```bash
# ---- 数据库结构变更（唯一入口：D1 migrations）----
# 改了表结构（加字段/加表/加索引）就该新建一个迁移，不要再手改 schema.sql
wrangler d1 migrations create inventory "add xxx column"   # 生成 cf/migrations/000N_xxx.sql
# 编辑生成的 .sql，写入 ALTER TABLE / CREATE TABLE 等语句
wrangler d1 migrations list  inventory --remote            # 看有哪些还没应用
wrangler d1 migrations apply inventory --remote            # 应用到线上
wrangler d1 migrations apply inventory --local             # 应用到本地

# 应用前建议先导一份线上备份（含真实业务数据，勿提交）
wrangler d1 export inventory --remote --output=cf/_backup_$(date +%Y%m%d).sql --skip-confirmation

# ---- 灌种子（角色/权限/admin/默认仓库，幂等）----
wrangler d1 execute inventory --file=cf/seed.sql --remote

# 查看数据
wrangler d1 execute inventory --remote --command "SELECT COUNT(*) FROM products"

# ---- 密钥 ----
wrangler pages secret put SECRET_KEY --project-name=inventory

# ---- 部署 ----
# 1) 构建前端（注意：必须在工作区内指定 TEMP，见「已知坑」）
cd frontend && npm run build && cd ..
# 2) 部署
wrangler pages deploy frontend/dist --project-name=inventory --branch=main

# ---- 测试 ----
node cf/smoke-test.mjs                                    # 本地
node cf/smoke-test.mjs https://inventory-b4k.pages.dev    # 线上

# ---- 本地联调 ----
copy .dev.vars.example .dev.vars       # 填入随机 SECRET_KEY
wrangler d1 migrations apply inventory --local
wrangler d1 execute inventory --file=cf/seed.sql --local
wrangler pages dev --port 8788
```

### 结构变更要改两边（重要）

本地后端是 SQLite + Alembic，线上是 D1 + wrangler migrations，**两套机制、两个库**：

| | 本地开发库 | 线上生产库 |
|---|---|---|
| 库 | `backend/inventory.db`（SQLite） | Cloudflare D1 `inventory` |
| 模型定义 | `backend/app/models/*.py` | 无 ORM，手写 SQL 在 `cf/routes/*.js` |
| 迁移工具 | `python -m alembic` | `wrangler d1 migrations` |
| 迁移文件 | `backend/alembic/versions/*.py` | `cf/migrations/*.sql` |
| 记录表 | `alembic_version` | `d1_migrations` |

**加一个字段要同时做两件事**：

```bash
# 1) 本地：改模型 → 生成并应用 Alembic 迁移
cd backend
python -m alembic revision --autogenerate -m "add xxx column"
python -m alembic upgrade head

# 2) 线上：手写 D1 迁移 → 应用
cd ..
wrangler d1 migrations create inventory "add xxx column"
#   编辑 cf/migrations/000N_*.sql，写入 ALTER TABLE t ADD COLUMN xxx ...;
wrangler d1 migrations apply inventory --remote

# 3) 别忘了 cf/routes/ 里对应的 SQL 读写也要跟着改（D1 侧没有 ORM）
```

只改一边的后果：本地能跑、线上报「no such column」；或线上能跑、本地报错。

---

## 已实现范围（阶段 1 – 阶段 4）

### 阶段 1：认证 + 基础资料

| 模块 | 接口 |
|---|---|
| 认证 | 登录 / 退出 / me / 我的权限 / 改密 / 重置密码 / 密码规则 |
| 角色权限 | 角色 CRUD / 权限清单 / 角色-权限关联 |
| 用户 | 列表 / 详情 / 新增 / 编辑 / 删除 |
| 商品 | 列表 / 详情 / 新增 / 编辑 / 删除（含引用检查）/ 分类 CRUD |
| 客户 | CRUD + 应收查询 + 删除前欠款校验 |
| 供应商 | CRUD + 应付查询 + 删除前欠款校验 |
| 仓库 | 列表 / 新增 / 编辑 / 删除（含库存校验） |
| 库存 | 库存列表 / 预警 |

### 阶段 2：采购 / 销售 / 库存

| 模块 | 接口 |
|---|---|
| 采购单 | 列表 / 详情 / 新增 / 编辑 / 删除 / 审核 / **分批收货** / 作废 |
| 销售单 | 列表 / 详情 / 新增 / 编辑 / 删除 / 审核 / **分批发货** / 作废 |
| 库存流水 | 列表（可按商品/仓库/类型筛选）/ 统计 / 生成期初流水 |
| 库存调拨 | 列表 / 详情 / 新增 / 审核（源仓出+目标仓入）/ 作废 |
| 库存盘点 | 列表 / 底稿预览 / 详情 / 新增 / 审核调账 / 作废 |

### 阶段 3：退货 / 收付款 / 凭证 / 应收应付

| 模块 | 接口 |
|---|---|
| 销售退货 | 列表（含金额汇总）/ 详情 / **可退原单** / **可退明细** / 新增 / 审核 / 入库 / 作废 |
| 采购退货 | 列表（含金额汇总）/ 详情 / **可退原单** / **可退明细** / 新增 / 审核 / 出库 / 作废 |
| 收付款 | 列表（按类型筛选）/ 新增 / 编辑 / 删除 —— 含**四象限凭证**与凭证号 |
| 应收应付 | 一个接口返回应收/应付 + 6 项明细口径 |

- 采购/销售单据共用 `cf/lib/orders.js`，退货共用 `cf/lib/returns.js`，
  差异（表名/单号前缀/往来单位/数量字段/收发货/权限码/文案）全部由配置表达，
  避免两边逻辑各自漂移。
- **退货必须关联原单**，数量严格校验（超出可退数量直接 400 并给出具体数字）。
- 退货会按已退数量**反推原单状态**：无退货→回发货态；部分退回→5；全部退回→6。
  作废退货单同样会重算（可能从 6 退回 5）。
- 凭证为**层次 2**（只生成摘要与借贷科目提示，不做真实分录），四象限规则：

| 类型 × 对象 | 借方 | 贷方 |
|---|---|---|
| 收款 · 客户 | 银行存款（按方式） | 应收账款 |
| 收款 · 供应商 | 银行存款（按方式） | 应付账款 |
| 付款 · 供应商 | 应付账款 | 银行存款（按方式） |
| 付款 · 客户 | 应收账款 | 银行存款（按方式） |

凭证号按会计期间流水：`记-YYYY-MM-0001`。收付款方式决定借方现金科目
（现金→库存现金，银行转账/微信/支付宝→银行存款，银行承兑→应收票据）。

### 阶段 4：报表 / 日志 / 自检 / 导出

| 模块 | 接口 |
|---|---|
| 首页看板 | 今日销售/采购额与笔数、待收/待发货数、应收应付、低库存预警、库存总量 |
| 销售日报 | 最近 N 天（1–365，缺日补 0），含销售额/笔数/采购额与日均 |
| 报表 | 销售（按客户/按商品）、采购（按供应商/按商品）、利润（按商品，含毛利率）、库存（含金额与低库存标记） |
| 操作日志 | 列表（按模块筛选 + 关键词搜 target/action/username） |
| 数据自检 | 全量扫描孤儿外键、负库存、单据金额不符；`/fix` 一键修复可自动处理的部分 |
| CSV 导出 | 6 类：inventory / sales / purchase / stocklog / payments / logs（带 BOM，Excel 不乱码） |

**四个阶段的接口已全部实现，未命中路由一律返回 404。**
（`PENDING` 机制保留为空数组，将来加新模块时填回去即可恢复友好的 501 提示。）

## 待办

| 项 | 说明 |
|---|---|
| ~~商品图片上传改 R2~~ | **已完成**：Workers 没有文件系统，改用 Cloudflare KV 存储（见下文「商品图片上传」） |

## 接口数量

| 项 | 数量 |
|---|---|
| Python 版 | 104 |
| Cloudflare 版 | **112** |

多出的 8 个：
- `GET /api/ext/sale-returns/{id}`、`GET /api/ext/purchase-returns/{id}` —— **2 个退货详情接口**（Python 版没有，前端编辑/打印需要）
- 导出按 kind 拆成 6 条独立路由 —— 这样**每种导出能各自声明权限**
  （对应 Python 的 `EXPORT_PERM`，而不是一条笼统的路由）

---

## 商品图片上传（Cloudflare KV）

Workers **没有文件系统**，图片必须放对象存储。原计划用 R2，但 R2 需要先在
控制台「启用」（还要绑支付方式）；**KV 开箱即用**，免费额度对 20 人内部系统
绰绰有余，所以改用 KV。

| 项 | 值 |
|---|---|
| 绑定名 | `IMAGES` |
| 命名空间 | `inventory-images` / `44155434db3642028dee0c02106f7cce` |
| 单值上限 | 25 MiB（本项目接口限制 **5 MB**） |
| 免费额度 | 1 GB 存储 / 10 万次读 / 1000 次写 每天 |
| 存储 key | `products/<yyyymmdd>_<12位随机hex><ext>` |
| 对外 URL | `/uploads/products/<名>` |

**URL 与 Python 版完全一致** —— 历史 `image_url` 值无需改动，前端一行都不用改。

### 为什么走 Function 而不是对象存储的公开域名

`functions/uploads/[[path]].js` 从 KV 读出来再返回：

- **同源**，前端 `<img src="/uploads/...">` 直接可用，没有跨域问题
- 不用绑自定义域名，也不用开任何「公开访问」
- 可以自己加 `Cache-Control` 与 `ETag`

图片 URL 不需要登录即可访问（`<img>` 不会带 Authorization 头），
但文件名含 **12 位随机 hex**，不可枚举 —— 相当于能力型 URL。

### 接口行为

```
POST /api/products/upload-image   （multipart/form-data，字段名 file）
```

| 校验 | 行为 |
|---|---|
| 格式 | 仅 JPG / PNG / GIF / WEBP / BMP，否则 400 并列出允许格式 |
| 大小 | ≤ 5 MB，超出提示当前大小 |
| 空文件 | 400 |
| 缺 `file` 字段 | 400 并提示字段名 |
| 未登录 | 401 |

扩展名优先取原文件名，非法（如无扩展名）则按 MIME 推断。

**验证脚本**（26 项断言）：

```bash
# 本地（miniflare 模拟 KV，免账号）
wrangler pages dev --port 8788 --kv IMAGES
node cf/verify-upload.mjs

# 线上
node cf/verify-upload.mjs https://inventory-b4k.pages.dev admin 密码
```

### 注意事项

- KV 是**最终一致**的：写入后在极短时间内（通常毫秒级同区域）可读。
  文件名每次都不一样，所以不会出现「读到旧图」的问题。
- **删除商品不会删除对应图片**（与 Python 版一致）—— 避免多商品共用同一图片时误删。
  需要清理时用 `wrangler kv key delete --namespace-id <id> --remote <key>`。

---

## 移动端（业务员 / 仓库外出办公）

桌面端是管理后台，手机上表格挤成一团。移动端是**独立的第二入口**，只做
现场高频动作：查库存价格、开销售单、发货、收货、登记收款、看客户欠款。

| 项 | 值 |
|---|---|
| 入口 | `frontend/mobile.html` → `/m/*` |
| 路由 | `frontend/src/mobile/router.js`，全部挂在 `/m/` 下 |
| 页面 | 工作台 / 库存价格 / 销售单 / 我的（4 个 Tab）+ 开销售单 / 销售单详情 / 采购收货 / 采购单详情 / 客户欠款 / 登记收款 / 出入库明细 |
| 存储 | 登录态用同一套 `localStorage.token`，与桌面端不冲突 |

### 为什么不复用桌面端的 API 层

`src/api/modules.js` 依赖 `src/api/index.js`，而后者 import 了 Element Plus 和桌面端 router。
移动端如果复用它，**会把 1.2 MB 的桌面组件库一起打进手机包**。

所以移动端有自己的 `src/mobile/api.js`（只封装用到的 ~30 个接口）+ 自己的轻量
toast / 底部确认弹层 / 移动优先 CSS。**桌面端一行代码都不用改**，零回归风险。

实测包体：

| | JS (gzip) | CSS (gzip) |
|---|---|---|
| 桌面端 | 412 KB | 48 KB |
| **移动端** | **65 KB** | **3 KB** |

（两个入口共享同一个 vue/vue-router/axios chunk，但移动端**不加载** `main-*.js`。）

### PWA：添加到主屏幕

| 文件 | 作用 |
|---|---|
| `public/mobile-manifest.json` | standalone 显示、`start_url: /m/`、3 个图标 |
| `public/mobile-icon-{192,512}.png` | 由 `cf/make_mobile_icons.py` 用 Pillow 生成（桌面端 `icon-{192,512}.png` 同一次生成） |
| `public/sw.js` | **统一 Service Worker**（桌面端 + 移动端共用；`/mobile-sw.js` 已删除，见下） |

#### ⚠️ 只有一个 Service Worker（曾是 bug）

SW 的默认 scope 是脚本所在目录。两个脚本都在根目录时 scope 都是 `/`，
而**同一 scope 只能存在一个注册** —— 桌面端注册 `/sw.js`、移动端注册
`/mobile-sw.js` 会互相覆盖，最终生效的是「最后访问的那个页面」。

现在统一为一份 `/sw.js`，`src/main.js` 与 `src/mobile/main.js` 都注册它。
导航请求按路径选择回退 shell（`/m/*` → `/m/`，其余 → `/index.html`）。

#### ⚠️ 图标必须是真正的 PNG

`icon-{192,512}.png` 曾经是「SVG 内容 + `.png` 后缀」，Pages 按 `image/png`
返回导致解析失败，**安装到主屏幕后图标空白**；且「圆角+透明」再 `convert("RGB")`
会把透明像素变黑，四角出现黑三角。

现在由 `cf/make_mobile_icons.py` 生成**满幅无透明**的 RGB PNG（`#2f6fed` + 白色「进」），
满足 maskable 安全区要求。**图标不要手写，一律用脚本生成。**

Service Worker 策略刻意保守，避免「改了却看到旧页面」这类最难查的问题：

- **导航请求：网络优先**，只有断网才回退缓存的 shell
- `/assets/*`（文件名带 hash、内容永不变）：缓存优先
- `/api/*`、`/uploads/*`：完全不接管
- 非 GET、跨域：不接管

### ⚠️ 一个必须记住的坑：`_redirects` 要指向 `/mobile` 而不是 `/mobile.html`

Cloudflare Pages 有 **clean URL** 行为：请求 `/mobile.html` 会被 **308** 重定向到 `/mobile`。
如果 `_redirects` 写成 `/m/*  /mobile.html  200`，实际链路会变成：

```
/m/sales/5  →(改写)→  /mobile.html  →(308)→  /mobile
```

**路径被丢掉** —— 分享链接、收藏、下拉刷新全部回到首页。

正确写法（本仓库已改）：

```
/m/*    /mobile   200
/m      /mobile   200
/*      /index.html    200
```

`/m` 要单独一条：`/m/*` 里的 `*` 至少匹配一个字符，`/m`（无斜杠）匹配不到，
不补这条的话用户手输 `example.com/m` 会落到桌面端。

### 移动端接口契约验证

手机 UI 没法在命令行里点，但页面绑定的字段名如果和后端对不上，用户看到的就是空白。
`cf/verify-mobile-api.mjs` 把每个页面读的字段逐个断言一遍，等于替 UI 做了契约核对：

```bash
node cf/verify-mobile-api.mjs http://127.0.0.1:8788
node cf/verify-mobile-api.mjs https://inventory-b4k.pages.dev admin 密码
```

**它抓到的问题（都是真问题）：**

| # | 问题 | 影响 |
|---|---|---|
| 1 | `/api/inventory` 不返回价格 | 移动端查库存看不到售价 → 已加 `sale_price`/`purchase_price`/`spec`/`unit`（超集） |
| 2 | 出入库明细 `type` 是**精确**匹配 | 手机端传 `'transfer'` 前缀查不到任何数据 → 改为完整 type |
| 3 | 采购单日期字段是 `purchase_date` | 写成 `order_date` 会导致列表日期显示空白 |
| 4 | 出入库明细**不支持 `keyword`** | 搜索框是摆设 → 已给后端补上（桌面端也可用） |

### 移动端开发期间顺带修掉的 3 个后端问题

**① `DELETE /api/users/{id}` 会 500**

用户被 8 张表引用（单据的 `created_by`/`approve_by` + `operation_logs.user_id`）。
D1 **强制外键**，直接删就报 `FOREIGN KEY constraint failed`。
Python 版跑在**默认关闭外键的 SQLite** 上，是静默留下孤儿引用 —— 一直没暴露。

现在的行为：**无历史记录**才真删；**有历史记录改为停用**（`status=0`，登录返回 403
「用户已被禁用」），保住审计链。桌面端会弹出 warning 说明原因。

**② 数据自检的 `/fix` 把整个自检跑了两遍**

`collectIssues` 原本要把整张表读进内存再比对（还要先加载 4 张主表的全部 id），
数据一多单次就要 5 秒；`/fix` 跑两遍 ≈ 11 秒，直接把连接拖断。

两处优化：

- 外键检查改成 `LEFT JOIN ... IS NULL` **anti-join**，只返回问题行，且能走索引
- **没东西可修时不再重扫**（`fixed.length ? await collectIssues() : issues`）

实测 `/fix` 从 ~11s 降到 ~2s。

**③ 冒烟测试里「审核」没有断言**

`await req('PUT', .../approve)` 没有 `check(...)`，所以一旦它失败会被静默吞掉，
后面几十个失败全都指向「发货」，把真正的根因埋掉。已补断言 —— 这次就是靠它
定位到问题其实是**本地 dev 代理掉连接**。

### 本地 `wrangler pages dev` 会偶发掉连接（已知环境问题）

密集连续请求时，本地代理会报 `Network connection lost`，**请求根本没到达 worker**
（服务端日志里没有对应的 info 行）。表现是某个没有断言的调用静默失败，
进而引发一大片连锁失败。

冒烟测试已内置**连接级失败重试**（3 次 + 退避），并在末尾单独报出重试次数，
以免把「环境抖动」误读成「接口不稳定」。**判定依据是没有拿到任何 HTTP 状态** ——
拿到 400/500 这类业务错误绝不重试。

生产环境不存在这个问题（线上 343/343 一次通过）。

---

## D1 限制与用量（实测）

用 `node cf/verify-d1-cost.mjs <base> <user> <pass>` 可以随时把每种操作的真实成本打出来
（接口会把 D1 用量挂在响应头 `X-D1-Queries` / `X-D1-Rows-Read` / `X-D1-Rows-Written` 上）。

### 官方限制（[D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)）

| 项 | 限制 |
|---|---|
| **每个查询最大绑定参数** | **100** |
| **每个 Worker 调用的查询次数** | **1000（付费）/ 50（免费）** |
| **LIKE / GLOB 模式最大长度** | **50 字节** |
| 单条 SQL 语句长度 | 100 KB |
| 单次 SQL 执行时长 | 30 秒 |
| 单行 / 单值上限 | 2 MB |
| 免费每日额度 | 读 500 万行 / 写 10 万行 / 存储 5 GB |

> 文档明确：**批处理里每条语句各自**受上述限制约束。

### 踩到并修掉的 4 个真问题

**① LIKE 模式超过 50 字节 → 500**

实测：

```
模式 50 字节 → 200 OK
模式 56 字节 → 500  D1_ERROR: LIKE or GLOB pattern too complex
```

也就是**搜索框里输入超过约 16 个汉字（或 48 个 ASCII 字符）就会把接口打崩**。
粘贴一个长商品名就触发。

修复：`likeArg()` 按 UTF-8 **字节**截断（不是 `String.length`，那是 UTF-16 码元），
保证 `%关键词%` 不超过 46 字节。搜索框里粘贴长文本仍能正常出结果。

**② 动态 `IN (?,?,...)` 超过 100 个参数 → 500**

150 个商品的实测：

```
500  利润报表（全部商品）      too many SQL variables
500  销售单列表 page_size=100   too many SQL variables
500  销售单详情（150 明细）     too many SQL variables
```

**销售单列表和详情都打不开** —— 这是主流程。

修复：新增 `allInChunks()`（`cf/lib/db.js`），所有动态 IN 分块（每块 50 个，留余量）；
利润报表改成 **JOIN**（根本不需要 IN）；订单列表摘要也从两段 IN 改成一次 JOIN。

**③ 列表接口是 N+1，一页 20 条就要 100+ 次查询**

`for (const o of orders) await decorate(ctx, cfg, o)` —— 每张单 4~6 条查询
（明细、往来单位、仓库、创建人、商品）。在**免费计划的 50 次/调用**下，
一页十几单就打不开。

修复：改批量装饰（`decorateMany` / `returnOutMany`），每种关联只查一次。
实测（45 张销售单）：

| page_size | 修复前（推算） | 修复后（实测） |
|---|---|---|
| 10 | ~55 次 | **7 次** |
| 20 | ~105 次 ❌ | **7 次** |
| 100 | ~505 次 ❌ | **9 次** |

**查询数基本与页大小无关了。** 顺带把退货列表的 5 条汇总查询合成 1 条条件聚合，
退货列表从 7 次降到 **2 次**。

**④ 批量写入逐行一条语句**

盘点建底稿 / 生成期初流水 / 订单明细，原来都是「一行一条 INSERT」。
500 个商品建底稿 = 500 条语句，在免费计划下必然超。

修复：新增 `multiRowInsert()`，合并成多行 `VALUES`（按 100 参数上限反推每语句行数）。
实测（150 行）：

| 操作 | 修复前 | 修复后 |
|---|---|---|
| 生成期初流水（150 行） | ~151 条语句 | **21 次查询** |
| 盘点建底稿（150 项） | ~150 条语句 | **12 次查询** |
| 新建销售单（150 明细） | ~155 条语句 | **22 次查询** |

> 注意：多行插入减少的是**查询次数**，不减少 `rows_written`（按行计费）。

### 写入行数配额：够用，不用优化

实测单次操作最大写入量：

| 操作 | 写入行数 | 占每日额度（免费 10 万） |
|---|---|---|
| 生成期初流水（150 行） | 301 | 0.30% |
| 新建销售单（150 明细） | 153 | 0.15% |
| 盘点建底稿（150 项） | 153 | 0.15% |

按「每天 300 次写操作 × 平均 88 行」折算 ≈ **2.6 万行/天，占免费额度 26%**。
实际观测（本库）：`rows_written_24h` 约 2 千行，占 **2%**。

**结论：写入行数不是瓶颈，每次调用的查询次数才是。**

### 索引与写入放大的取舍

本库**只有 1 个索引**（`ix_payments_voucher_no`），其余 `ix_*_id` 都已删除
（`id INTEGER PRIMARY KEY` 本身已索引，重复建纯属浪费）。

官方说明：**写入被索引的列时，索引会额外计 1 行写入**。所以索引越少写入越省。
当前只有 1 个索引，写入放大几乎为零 —— 对写入配额是好事。
代价是部分 JOIN/筛选走全表扫描（`rows_read` 偏大），但当前量级
（几十万行以内）完全无感，**不建议为了读性能盲目加索引**。

`WHERE date(created_at) = ?` 这类写法用不上索引（函数包裹了列）。
看板与销售日报目前这么写，量级小可以接受；将来数据到百万行再改成区间比较。

### 关于计划选择

| | 免费 | 付费（$5/月） |
|---|---|---|
| 查询次数/调用 | **50** | 1000 |
| 写入行/天 | 100,000 | 5000 万/月 |
| 读取行/天 | 5,000,000 | 250 亿/月 |

**20 人内部系统免费计划基本够用**（实测最贵的「首页看板」16 次、
「新建 150 明细销售单」22 次，都在 50 以内）。
但如果有「一次盘点上千个商品」这类需求，建议升到付费 —— 单次调用 50 次查询
会挡住大仓库的全量盘点。

### ⚠️ 冒烟测试要求**干净库**

`cf/smoke-test.mjs` 的断言里有大量写死的数字（销售额 = 80、库存 = 10 等），
**库里存在真实业务数据时必然失败** —— 那是测试假设失效，不是功能坏了。

对**已有真实数据**的库跑测试前，先确认它不会破坏数据；收尾**不要**跑
`cf/reset-business-data.sql`（那会清空全部业务数据）。

---

## 存量数据迁移

```bash
# 1. 从本地 SQLite 导出（默认跳过 roles/permissions/role_permissions 种子表）
python cf/migrate_sqlite_to_d1.py
python cf/migrate_sqlite_to_d1.py --dry-run        # 只看行数
python cf/migrate_sqlite_to_d1.py --include-seed   # 连种子一起迁
python cf/migrate_sqlite_to_d1.py --replace        # 先按反序 DELETE 再 INSERT

# 2. 应用到 D1
wrangler d1 execute inventory --file=cf/migrate-data.sql --local
wrangler d1 execute inventory --file=cf/migrate-data.sql --remote
```

设计要点：

- **按外键顺序输出**（父表在前）—— D1 强制外键，顺序错会整批回滚
- 默认 `INSERT OR IGNORE`：**可重复执行**，已存在的行自动跳过。
  SQLite 的 `ON CONFLICT` 算法**不作用于外键**，所以外键错误仍会正常报出来，不会被静默吞掉
- **保留原始 id**，保证外键指向不变
- 生成的 `cf/migrate-data.sql` 含业务数据，**已在 `.gitignore` 中忽略**

已在本机做过端到端验证：全新库 → 建表 → 灌种子 → 迁移，行数与源库完全一致
（用户 1 / 仓库 1 / 日志 6 / 角色 7 / 权限 84 / 角色权限 242）。

> 当前 `backend/inventory.db` 里**没有业务数据**（商品/单据/收付款均为 0），
> 所以这次迁移只走了 8 行（1 用户 + 1 仓库 + 6 日志）。工具已就绪，将来有数据直接用。

---

## D1 没有事务，库存怎么保证原子

Python 版把「改库存 + 写流水 + 改单据状态」放在一个 SQLAlchemy 事务里。
D1 只有 `db.batch()`（整批原子，没有交互式事务），所以改成两段式：

1. **`planStock()`（`cf/lib/stock.js`）只读**：做完全部校验（库存是否够、待收/待发数量），
   算好 `before` / `after`，返回要执行的语句
2. **`db.batch()` 一次性原子提交**：库存 + 流水 + 明细累计 + 主单状态

库存用**相对更新**而不是写绝对值：

```sql
UPDATE inventory SET quantity = quantity + excluded.quantity
 WHERE inventory.quantity + excluded.quantity >= 0
```

- 相对更新 → 并发下不会丢失更新（避免「A 读到 10、B 也读到 10、两人都写 8」）
- 守卫条件 → 即使校验和写入之间发生竞态，库存也不会变负

失败时（如销售发货库存不足）在 `batch()` **之前**就抛 400，所以不会产生半成品数据 ——
冒烟测试专门验证了「失败发货后库存未变」。

---

## 冒烟测试

```bash
# 本地（默认 admin/admin123）
node cf/smoke-test.mjs

# 线上
node cf/smoke-test.mjs https://inventory-b4k.pages.dev admin 你的密码

# 也可用环境变量
SMOKE_USER=xxx SMOKE_PASS=yyy node cf/smoke-test.mjs https://inventory-b4k.pages.dev
```

**338 项检查**，覆盖：健康检查 / 鉴权 / 权限 / 角色 / 用户 / 分类 / 商品 / 客户 /
供应商 / 仓库 / 库存 / 采购单全流程（含价内税、分批收货、超收拦截）/ 销售单全流程
（含库存不足保护）/ 库存流水 / 调拨 / 盘点 / 删除保护 / 权限边界（403）/
销售退货（可退查询、超退拦截、部分→整单状态流转、作废回退）/ 采购退货 /
收付款四象限凭证与凭证号 / 应收应付公式自洽性 / 首页看板与销售日报 / 报表×4 / 操作日志 / 数据自检 / CSV 导出×6（含 BOM 字节校验）/ **商品图片上传**（KV 存储，含回读字节比对）。

> ⚠ 线上如果已经按安全建议改过 admin 密码，必须传入新密码，
> 否则登录 401 是预期行为，不是故障。

测试会创建 `__冒烟测试*` 前缀的数据。**已收货/已发货的单据接口不允许删除，
有库存的商品也不允许删除**，所以收尾必须跑清理脚本：

```bash
wrangler d1 execute inventory --file=cf/smoke-cleanup.sql --remote   # 或 --local
```

清理脚本按三重条件识别测试数据（名称前缀 / 单据 remark 前缀 / 明细引用了测试商品），
并保证**外键顺序正确**（子表→父表，`operation_logs` 必须早于 `users`），
跑完能精确回到初始状态（1 用户 / 7 角色 / 1 仓库，其余全 0）。

---

## 与 Python 版的语义差异

| 项 | Python 版 | Cloudflare 版 |
|---|---|---|
| `category_name` | 仅列表接口填充，新增/详情返回 null | **始终填充**（超集，不破坏调用方） |
| 采购/销售明细商品校验 | 新增时不校验商品是否存在 | **校验**（提前报错，避免外键失败） |
| 退货单响应明细 | 只回 product_id/quantity/price/amount | 额外带商品名/规格/单位（超集） |
| 结束日期过滤 | `created_at <= 'YYYY-MM-DD'` **漏掉当天** | 补成 `23:59:59.999999`（见下 ①） |
| 数据自检金额口径 | `Σ明细` vs `total_amount`，**忽略运费** | `Σ明细 + 运费` vs `total_amount`（见下 ②） |
| CSV 导出状态文案 | 残缺映射，status≥4 直接崩 | 完整状态表（见下 ③） |
| 密码哈希 | `salt:sha256hex` | **完全一致**（历史数据可直接迁移） |
| JWT | PyJWT HS256 | WebCrypto HS256（同为标准 JWT） |
| 时间格式 | `datetime.isoformat()` | 与之一致（`T` 分隔） |
| 时区 | `ZoneInfo("Asia/Shanghai")` | `Intl.DateTimeFormat`（同一时区） |
| 库存原子性 | 单事务 | `batch()` + 相对更新 + 守卫条件 |

### 移植中发现并修正的 3 个 Python 版 bug

**① 结束日期漏掉当天数据（影响所有列表筛选和报表）**

`created_at` 存的是 `'YYYY-MM-DD HH:MM:SS.ffffff'`（TEXT），
直接和 `'2026-09-30'` 比字符串时 `'2026-09-30 10:00:00' > '2026-09-30'`
（前 10 位相同时长的那串更大），于是 `<= '2026-09-30'` 为**假** —— 当天数据全部丢失。

用「开始 = 结束 = 今天」查报表时，Python 版返回 0，Cloudflare 版返回正确值。
已加回归测试锁住这个行为。

**② 数据自检的金额口径错误，而且「一键修复」会毁数据**

Python 版比较 `Σ明细金额` 与 `total_amount`，但整单合计 = **Σ明细 + 运费**。
只要运费非 0 就误报「金额不符」，执行修复会把 `total_amount` 重算成
不含运费的值 —— **静默丢掉运费**。

Cloudflare 版改成 `Σ明细 + 运费`，修复同口径。已用「人为制造脏数据」验证：
把 110 改成 9999 → 自检报出「明细合计 105.00 + 运费 5.00 = 110.00 ≠ 单据金额 9999.00」
→ 一键修复 → 正确回到 **110**（本地和线上都验过）。

**③ CSV 导出的状态映射残缺**

Python 版用 `["待审核","已审核","已出库","已作废"][o.status]`：

- `status = 3`（已发货/已收货）被错标成「已作废」
- `status >= 4`（已关闭/部分退货/已退货）**直接 IndexError 崩掉**

Cloudflare 版改用完整状态表。已加回归测试：销售导出显示「已退货」、采购导出显示「部分退货」。

### 关于「数据自检」的说明

正常操作下系统不会产生脏数据（接口层拦住了：商品有库存/被引用就不让删，
单据金额总是按明细+运费重算），所以自检在健康库上恒为绿色。
自检与修复的价值在于**历史数据迁入后**或**绕过接口直接改库之后**的兜底。
因此它有一条独立的验证脚本：

```bash
node cf/verify-healthfix.mjs http://127.0.0.1:8788        # 本地
node cf/verify-healthfix.mjs https://inventory-b4k.pages.dev admin 密码   # 线上
```

（需先用 SQL 人为制造金额不一致；脚本会验证自检能报出、修复按正确口径重算、复检干净。19 项断言。）

## 路由面覆盖检查

```bash
node cf/verify-routes.mjs https://inventory-b4k.pages.dev
```

把全部路由从模块里枚举出来，逐条真实请求一次，确认**没有一条是 404**（404 = 路由没注册）。
比数数量更强的证据 —— 数量对不代表每条都接对了。

线上实测：**已注册可达 112 / 112**。

## 已知坑

| 坑 | 说明 |
|---|---|
| **esbuild 临时文件删不掉** | 系统 `%TEMP%` 里的 `esbuild-*` 残留会导致 `vite build` 报 `Access is denied`。清理后即可；或把 `TEMP` 指到工作区内。已在 `.gitignore` 预留 `.build-tmp/` |
| **深链接 404** | Vue 用 `createWebHistory()`，必须靠 `frontend/public/_redirects` 做 SPA 回退，否则 `/sales` 直接访问会 404 |
| **`_redirects` 会不会吞掉 API** | 不会。Pages Functions 优先于 `_redirects`，已验证 `/api/*` 仍返回 JSON |
| **D1 清理测试数据要讲外键顺序** | 顺序错会整批回滚（`FOREIGN KEY constraint failed`），且报错不指出是哪条语句 |
| `PRAGMA` 无效 | D1 托管 WAL / busy_timeout，代码里已去除 |
| 没有文件系统 | 图片存 Cloudflare KV（binding `IMAGES`），见「商品图片上传」 |
| D1 无交互式事务 | 只能 `batch()`；库存已重构为「只读规划 + 原子批提交」，见上文 |
