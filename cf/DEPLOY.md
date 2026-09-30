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
| 商品图片上传改 R2 | Workers 没有文件系统，当前返回 501，商品图暂用外链地址 |

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

**333 项检查**，覆盖：健康检查 / 鉴权 / 权限 / 角色 / 用户 / 分类 / 商品 / 客户 /
供应商 / 仓库 / 库存 / 采购单全流程（含价内税、分批收货、超收拦截）/ 销售单全流程
（含库存不足保护）/ 库存流水 / 调拨 / 盘点 / 删除保护 / 权限边界（403）/
销售退货（可退查询、超退拦截、部分→整单状态流转、作废回退）/ 采购退货 /
收付款四象限凭证与凭证号 / 应收应付公式自洽性 / 首页看板与销售日报 / 报表×4 / 操作日志 / 数据自检 / CSV 导出×6（含 BOM 字节校验）。

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
