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
| 图片上传 | 本地 `/uploads` 目录 | ⚠ 待改 R2（阶段 2） |

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
    ├── schema.sql                 # 25 张表 + 10 个索引（D1 版）
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
# ---- 数据库 ----
# 建表（首次或重建）
wrangler d1 execute inventory --file=cf/schema.sql --remote

# 灌种子（角色/权限/admin/默认仓库，幂等）
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
wrangler d1 execute inventory --file=cf/schema.sql --local
wrangler d1 execute inventory --file=cf/seed.sql   --local
wrangler pages dev --port 8788
```

---

## 已实现范围（阶段 1）

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

**未实现的接口返回 `501`**，响应体里会说明属于哪个阶段，前端能看到明确提示而不是困惑的 404。

## 待办

| 阶段 | 内容 |
|---|---|
| 2 | 采购单 / 销售单 / 库存出入库 / 调拨 / 盘点 / **图片上传改 R2** |
| 3 | 退货 / 收付款 / 凭证 / 应收应付 |
| 4 | 报表 / 操作日志 / CSV 导出 / **存量数据从 SQLite 迁到 D1** |

阶段 2 的关键难点：D1 **没有交互式事务**，而 `apply_stock`（改库存 + 写流水）必须原子。
需要改用 `db.batch()` 并把「先读再判断再写」的逻辑改写成带条件的 SQL。

---

## 与 Python 版的语义差异

| 项 | Python 版 | Cloudflare 版 |
|---|---|---|
| `category_name` | 仅列表接口填充，新增/详情返回 null | **始终填充**（超集，不破坏调用方） |
| 密码哈希 | `salt:sha256hex` | **完全一致**（历史数据可直接迁移） |
| JWT | PyJWT HS256 | WebCrypto HS256（同为标准 JWT） |
| 时间格式 | `datetime.isoformat()` | 与之一致（`T` 分隔） |
| 时区 | `ZoneInfo("Asia/Shanghai")` | `Intl.DateTimeFormat`（同一时区） |

## 已知坑

| 坑 | 说明 |
|---|---|
| **esbuild 临时文件删不掉** | 系统 `%TEMP%` 里的 `esbuild-*` 残留会导致 `vite build` 报 `Access is denied`。清理后即可；或把 `TEMP` 指到工作区内。已在 `.gitignore` 预留 `.build-tmp/` |
| **深链接 404** | Vue 用 `createWebHistory()`，必须靠 `frontend/public/_redirects` 做 SPA 回退，否则 `/sales` 直接访问会 404 |
| **`_redirects` 会不会吞掉 API** | 不会。Pages Functions 优先于 `_redirects`，已验证 `/api/*` 仍返回 JSON |
| `PRAGMA` 无效 | D1 托管 WAL / busy_timeout，代码里已去除 |
| 没有文件系统 | 商品图片上传需要 R2，当前返回 501 |
| D1 无交互式事务 | 只能 `batch()`，阶段 2 需重构库存逻辑 |
