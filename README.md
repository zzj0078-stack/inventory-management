# 进销存管理系统

20 人销售型公司使用的进销存 + OA 系统。Web 端（Vue3 + Element Plus），后端 FastAPI + SQLite。

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

### 5. Windows 一键脚本（可选）

`.bat` 脚本**不硬编码 Python 路径**，启动时会自动探测，无需手工修改：

| 优先级 | 来源 |
|--------|------|
| 1 | 环境变量 `INVENTORY_PYTHON`（手动指定） |
| 2 | 项目虚拟环境 `backend\.venv` 或 `.venv` |
| 3 | `py -3` 启动器 |
| 4 | PATH 中的 `python`（跳过微软商店占位程序） |
| 5 | 常见安装目录 `%LOCALAPPDATA%\Programs\Python\Python3xx`、`C:\Python3xx` 等 |

找不到时会提示安装方式，或指定已有解释器：

```powershell
setx INVENTORY_PYTHON "C:\Path\to\python.exe"
```

一键脚本流程：`go.bat` = 停旧进程 → 构建前端 → 启动后端 → 打开浏览器。

---

## 快速开始（本机已有环境）

### 1. 初始化数据库（首次或重置）

```
双击 reset_db.bat          # 会二次确认，输入 YES 才执行
```

或手动：

```powershell
cd backend
Remove-Item .\inventory.db -Force
python init_db.py
python create_test_data.py
```

### 2. 启动

```
双击 go.bat
```

- 后端：http://localhost:3041
- API 文档：http://localhost:3041/docs
- 前端：http://localhost:3041（单端口，go.bat 启动前会重建前端）

默认账号：`admin` / `admin123`

### 3. 开发模式（改前端代码无需构建）

```
双击 watch.bat
```

`vite build --watch` 常驻，保存源文件后 1-2 秒自动重建，浏览器按 `F5` 即可看到改动。

### 4. 重启后端（改完后端代码后）

用 `go.bat` 或 `watch.bat` 重新启动即可，两者都会先停止旧进程。

启动窗口会打印路由自检：

```
[INFO] total routes: 90
[OK]   全部关键路由已加载
```

若出现 `[WARN] 缺失路由`，说明代码未更新或重启失败。

---

## 脚本清单

> 所有 `.bat` 均为纯 ASCII（英文），避免 cmd 按 GBK 解析 UTF-8 导致乱码/命令解析失败。
> 所有停止逻辑按**端口**（3040/3041）精确匹配，不会误杀其它 Python / Node 程序。

| 脚本 | 作用 |
|------|------|
| `go.bat` | **日常启动**：停旧进程 → 重建前端 → 启动后端 → 打开浏览器 |
| `watch.bat` | **开发模式**：启动后端 + `vite build --watch`，保存即重建 |
| `stop.bat` | 停止服务（仅 3040/3041） |
| `clean.bat` | 清理 `dist` / `__pycache__` / 日志（保留数据库与图片） |
| `fix.bat` | 数据修复菜单：时间偏移 / 税额口径 / 退货状态 / 对账诊断 |
| `logs.bat` | 服务状态 + 日志查看（后端 / 错误 / vite / 实时跟踪） |
| `backup.bat` | 备份数据库并列出历史备份 |
| `reset_db.bat` | 重置数据库（清空并重建，仅保留 admin，需输入 YES 确认） |
| `package_for_deploy.bat` | 打包 Linux 部署包（含前端构建） |


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
├── deploy/                # Linux 部署脚本（deploy.sh / service.sh / backup.sh / DEPLOY.md）
├── tools/                 # 脚本公共组件（按端口停服务、隐藏启动、端口探测、倒计时）
├── go.bat                 # 日常启动（重建前端 + 启后端）
├── watch.bat              # 开发模式（自动重建）
├── stop.bat               # 停止服务
├── clean.bat              # 清理构建产物与缓存
├── fix.bat                # 数据修复菜单
├── logs.bat               # 服务状态 + 日志
├── backup.bat             # 备份数据库
├── reset_db.bat           # 重置数据库
└── package_for_deploy.bat # 打包 Linux 部署包
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
- 权限码格式：`模块:动作`，如 `purchase:approve`
- 前端菜单按 `hasPermission(code)` 显隐；`role_id === 1`（admin）全放行
- 后端接口未强制校验（内部系统，前端控制为主）

权限清单见 `backend/init_db.py` 的 `ALL_PERMISSIONS`。

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
- 表结构由 SQLAlchemy `create_all` 生成；**新增字段需删除库重建**（无迁移框架）

### 备份

```
双击 backup.bat
```

或：

```powershell
cd backend
D:\Harness\Py312\python.exe backup_db.py            # 备份
D:\Harness\Py312\python.exe backup_db.py --list     # 列出
D:\Harness\Py312\python.exe backup_db.py --restore inventory_20260101_120000.db
```

备份文件在 `backend/backups/`。

### 导出

各列表页「导出CSV」按钮，或直接 `GET /api/ext/export/{inventory|sales|purchase|stocklog|logs}`（带 `Authorization: Bearer <token>`）。CSV 带 BOM，Excel 打开不乱码。

---

## 打印

- 模板页：`/print`，可「设置公司信息」（公司名、地址、电话），存 localStorage，全局生效
- 采购/销售列表 → 详情 → 打印：按金蝶销售单格式输出（抬头 + 客户信息 + 明细表 + 金额大写 + 备注 + 双签章位）
- 金额大写由前端 `amountInChinese()` 转换

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
2. 无数据库迁移，改模型字段需重建库
3. 后端未做接口级权限校验（仅前端控制）
4. 微信小程序端未开发
5. 打印为浏览器打印，非服务端 PDF 生成
