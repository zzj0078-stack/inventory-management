# 进销存管理系统

20 人销售型公司使用的进销存 + OA 系统。Web 端（Vue3 + Element Plus），后端 FastAPI + SQLite。

**线上部署**：Cloudflare Pages（静态前端）+ Cloudflare D1（数据库）

---

## 从 GitHub 克隆后如何跑起来

### 1. 环境要求

| 项 | 版本 |
|----|------|
| Python | 3.9+（推荐 3.12） |
| Node.js | 18+ |
| 操作系统 | Windows（开发）/ Linux（部署） |

### 2. 后端

```powershell
cd backend

# 安装依赖
python -m pip install -r requirements.txt

# 复制配置模板，并按需修改（务必改 SECRET_KEY）
Copy-Item .env.example .env

# 初始化空数据库（建表 + 82 权限 + 8 角色 + admin 账号，无演示数据）
python init_db.py

# 可选：灌入演示数据
python create_test_data.py
```

### 3. 前端

```powershell
cd frontend
npm install
npm run build          # 构建到 dist/，由后端单端口托管
```

### 4. 启动

```powershell
cd backend
python run.py
```

访问 http://localhost:3041 ，默认账号 `admin` / `admin123`。

> ⚠️ **首次登录后立即修改 admin 密码。**

---

## 目录结构

```
public/
├── backend/
│   ├── app/
│   │   ├── api/           # 路由层
│   │   ├── models/        # SQLAlchemy 模型
│   │   ├── schemas/       # Pydantic 校验
│   │   ├── core/          # 安全 / 日志 / 库存公共逻辑
│   │   ├── config.py      # 配置（读 .env）
│   │   ├── database.py    # 引擎 + SQLite WAL
│   │   └── main.py        # 应用入口（含前端静态托管）
│   ├── alembic/           # 数据库迁移（env.py + versions/）
│   ├── alembic.ini        # 迁移配置（纯 ASCII，URL 由 env.py 注入）
│   ├── run.py             # 启动脚本（路径无关）
│   ├── init_db.py         # 初始化表 + 权限 + admin
│   ├── create_test_data.py# 演示数据
│   ├── backup_db.py       # 备份/恢复
│   └── .env               # 环境变量
├── frontend/
│   ├── src/
│   │   ├── api/           # axios 封装 + 接口定义
│   │   ├── store/         # Pinia（用户 / 权限）
│   │   ├── router/        # 路由
│   │   └── views/         # 页面
│   └── vite.config.js
├── cf/                    # Cloudflare 部署相关
├── deploy/                # Linux 部署脚本
├── functions/             # Cloudflare Pages Functions
├── tools/                 # 脚本公共组件
└── wrangler.toml          # Cloudflare 配置
```

---

## 功能模块

| 模块 | 页面 | 能力 |
|------|------|------|
| 首页 | `/dashboard` | 今日销售额/笔数、待入库、待出库、应收应付、库存预警、快捷入口 |
| 基础数据 | `/suppliers` `/customers` `/products` | 增删改查、搜索、分页；商品支持多单位、规格、颜色、尺码、图片 |
| 采购管理 | `/purchase` | 建单 → 审核 → 入库（自动加库存 + 写流水）；交货地址、发票号；金蝶格式打印 |
| 采购退货 | `/purchase-return` | 建单 → 审核 → 出库（自动减库存） |
| 销售管理 | `/sales` | 建单 → 审核 → 出库（自动减库存 + 库存校验）；送货地址、发票号；金蝶格式打印 |
| 销售退货 | `/sale-return` | 建单 → 审核 → 入库（自动加库存） |
| 库存管理 | `/inventory` | 库存查询、预警筛选、导出 CSV |
| 库存调拨 | `/stock-transfer` | 开单 → 审核执行（源仓出、目标仓入） |
| 库存盘点 | `/stock-check` | 生成底稿 → 填实盘数 → 审核调账（盘盈/盘亏自动调整） |
| 出入库明细 | `/stock-log` | 全量库存流水，含变动前后数量 |
| 财务管理 | `/payment` | 收付款单、应收应付统计、凭证号 |
| 报表统计 | `/report` | 销售报表（按客户/商品）、采购报表（按供应商/商品）、利润分析 |
| 系统管理 | `/users` `/roles` `/logs` `/print` | 用户管理、角色权限（RBAC）、操作日志、打印模板 |

---

## 权限模型

- `roles` ↔ `permissions` 多对多（`role_permissions`）
- 权限码格式：`模块:动作`，如 `purchase:approve`，共 84 项，分 20 个模块
- **后端是真正的边界**：`app/core/perm_matrix.py` 集中定义 90+ 条
  `(HTTP 方法, 路径正则, 所需权限)` 规则，由纯 ASGI 的 `PermissionMiddleware` 拦截；
  未命中规则的接口默认「登录即可访问」，`PUBLIC` 集合内的接口免登录
- 前端 `v-permission` 指令 / `router` 守卫只负责菜单与按钮的**显隐**
- 权限清单见 `app/core/permissions.py` 的 `PERMISSION_GROUPS`

### 密码策略

**唯一事实来源：`backend/app/core/password_policy.py`**（前端 `frontend/src/utils/password.js`
是同一套规则的镜像，仅用于即时提示）。

| 规则 | 说明 |
|------|------|
| 长度 | 8 - 64 位 |
| 特殊字符 | **至少 1 个**。ASCII 全部可见标点以及常见全角标点 |
| 空格 | 不允许（含 Tab） |

---

## 库存流水

所有库存变动统一走 `app/core/stock.py::apply_stock`，保证「改库存」与「写流水」原子：

| type | 触发 |
|------|------|
| `purchase_in` | 采购入库 |
| `sale_out` | 销售出库 |
| `sale_return_in` | 销售退货入库 |
| `purchase_return_out` | 采购退货出库 |
| `transfer_in` / `transfer_out` | 库存调拨 |
| `adjust_in` / `adjust_out` | 盘点盈亏 |

库存为负时抛 `400`，不允许负库存。

---

## 数据库

- 默认 SQLite：`backend/inventory.db`（路径由 `config.py` 转绝对，不受 cwd 影响）
- 已启用 `WAL` + `busy_timeout=30s`，支持读写并发
- 表结构由 SQLAlchemy 模型定义，**用 Alembic 做迁移**（见下节）

### 数据库迁移（Alembic）—— 新增字段不用再删库

改了 `app/models/*.py` 之后，不再需要「删库重建」，走三步：

```powershell
cd backend

# 1) 生成迁移脚本（对比模型与当前库，自动写出 ALTER/CREATE）
python -m alembic revision --autogenerate -m "add xxx column"

# 2) 看一眼生成的脚本（在 alembic/versions/ 下），确认没有误删表
#    autogenerate 不是万能的：字段重命名会被识别成「删旧列+加新列」，
#    需要手工改成 op.alter_column(... new_column_name=...) 以免丢数据

# 3) 执行迁移（数据保留）
python -m alembic upgrade head
```

其他常用命令：

| 命令 | 作用 |
|------|------|
| `python -m alembic current` | 查看当前库的迁移版本 |
| `python -m alembic history` | 查看迁移历史 |
| `python -m alembic upgrade head` | 升到最新 |
| `python -m alembic downgrade -1` | 回退一个版本 |
| `python -m alembic stamp head` | 只改版本号、不执行 SQL（库结构已手工同步时用） |

要点：

- **数据库连接复用后端配置**：`alembic/env.py` 直接读 `app.config.settings.DATABASE_URL`，
  不在 `alembic.ini` 里重复写一份，避免两处漂移
- **SQLite 已开 batch 模式**（`render_as_batch=True`）：SQLite 原生只支持 `ADD COLUMN`，
  改类型/删列/改约束需要重建表，batch 模式会自动生成「建新表→拷数据→换名」
- **`alembic.ini` 必须保持纯 ASCII**：alembic 用系统 locale 编码读它，
  在中文 Windows（GBK）下写中文注释会直接 `UnicodeDecodeError` 崩溃
- 本机已有库的初始化方式：先生成 baseline（对空库 autogenerate），再对现有库
  `python -m alembic stamp head` 标记为「已在基线」，之后就能正常增量迁移

### 备份

```powershell
cd backend
python backup_db.py                                 # 备份
python backup_db.py --list                          # 列出
python backup_db.py --restore inventory_20260101_120000.db   # 还原
```

### 导出

各列表页「导出CSV」按钮，或直接 `GET /api/ext/export/{inventory|sales|purchase|stocklog|logs}`。

---

## 环境变量（`backend/.env`）

| 变量 | 默认 | 说明 |
|------|------|------|
| `DATABASE_URL` | `sqlite:///./inventory.db` | 留空用默认 |
| `SECRET_KEY` | `change-me-...` | **生产必须修改** |
| `TOKEN_EXPIRE_MINUTES` | `480` | 登录有效期 |
| `HOST` / `PORT` | `0.0.0.0` / `3041` | 服务监听 |
| `FRONTEND_DIST` | `../frontend/dist` | 前端产物目录 |
| `BACKUP_DIR` | `backend/backups` | 备份目录 |

---

## 已知限制

1. SQLite 单文件，多实例部署需换 PostgreSQL
2. 微信小程序端未开发
3. 打印为浏览器打印，非服务端 PDF 生成
4. Alembic 的 `--autogenerate` 不识别字段重命名（会当成删旧列+加新列），
   重命名字段时需手工改迁移脚本，否则会丢该列数据
