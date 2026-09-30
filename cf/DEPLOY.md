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

## 已实现范围（阶段 1 + 阶段 2）

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

采购与销售共用 `cf/lib/orders.js` 的工厂，差异（表名/单号前缀/往来单位/收发货/
权限码/文案）全部由配置表达，避免两边逻辑各自漂移。

**未实现的接口返回 `501`**，响应体里会说明属于哪个阶段，前端能看到明确提示而不是困惑的 404。

## 待办

| 阶段 | 内容 |
|---|---|
| 3 | 退货 / 收付款 / 凭证 / 应收应付 |
| 4 | 报表 / 操作日志 / CSV 导出 / **存量数据从 SQLite 迁到 D1** |
| 补 | **商品图片上传改 R2**（Workers 没有文件系统，当前返回 501） |

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

**149 项检查**，覆盖：健康检查 / 鉴权 / 权限 / 角色 / 用户 / 分类 / 商品 / 客户 /
供应商 / 仓库 / 库存 / 采购单全流程（含价内税、分批收货、超收拦截）/ 销售单全流程
（含库存不足保护）/ 库存流水 / 调拨 / 盘点 / 删除保护 / 权限边界（403）。

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
| 密码哈希 | `salt:sha256hex` | **完全一致**（历史数据可直接迁移） |
| JWT | PyJWT HS256 | WebCrypto HS256（同为标准 JWT） |
| 时间格式 | `datetime.isoformat()` | 与之一致（`T` 分隔） |
| 时区 | `ZoneInfo("Asia/Shanghai")` | `Intl.DateTimeFormat`（同一时区） |
| 库存原子性 | 单事务 | `batch()` + 相对更新 + 守卫条件 |

## 已知坑

| 坑 | 说明 |
|---|---|
| **esbuild 临时文件删不掉** | 系统 `%TEMP%` 里的 `esbuild-*` 残留会导致 `vite build` 报 `Access is denied`。清理后即可；或把 `TEMP` 指到工作区内。已在 `.gitignore` 预留 `.build-tmp/` |
| **深链接 404** | Vue 用 `createWebHistory()`，必须靠 `frontend/public/_redirects` 做 SPA 回退，否则 `/sales` 直接访问会 404 |
| **`_redirects` 会不会吞掉 API** | 不会。Pages Functions 优先于 `_redirects`，已验证 `/api/*` 仍返回 JSON |
| **D1 清理测试数据要讲外键顺序** | 顺序错会整批回滚（`FOREIGN KEY constraint failed`），且报错不指出是哪条语句 |
| `PRAGMA` 无效 | D1 托管 WAL / busy_timeout，代码里已去除 |
| 没有文件系统 | 商品图片上传需要 R2，当前返回 501 |
| D1 无交互式事务 | 只能 `batch()`；库存已重构为「只读规划 + 原子批提交」，见上文 |
