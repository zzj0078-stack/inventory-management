# AGENTS.md — 仓库约定（AI 代理与协作者请先读）

本文件是**硬性约定**，不是建议。违反约定会引入难以排查的问题。

---

## 1. 脚本、测试、工具一律用纯 ASCII

**适用范围**：`cf/*.mjs`（顶层脚本与测试）、`tools/**`、以及任何
`.bat` / `.ps1` / `.cmd` / `.mjs` 的**脚本与测试**文件。

**不适用**（可用中文）：`cf/lib/**`、`cf/routes/**`（应用源码）、
`cf/migrations/**`、`*.md` 文档、`.vue` 组件、`.sql`。

**规则**：这些文件的内容**全部使用纯 ASCII**，包括：

- 注释
- 打印到控制台的字符串（`console.log` / `echo` / `Write-Host`）
- 变量名、标签、测试用例描述

不得直接写入中文。若确实需要中文文案（例如断言页面上的中文 UI），
**用 Unicode 转义**表达：

```js
// 需要在脚本里断言页面上的中文时，用转义而不是直接写中文
const T = {
  installTitle: '\u5b89\u88c5\u5230\u4e3b\u5c4f\u5e55', // 安装到主屏幕
  installNow: '\u7acb\u5373\u5b89\u88c5', // 立即安装
}
```

### 自动检查（写完后直接跑）

```bash
node cf/check-ascii.mjs          # 有违规则退出码 1
node cf/check-ascii.mjs --list   # 额外列出被检查的每个文件
```

存量文件（`cf/smoke-test.mjs` 等 10 个）已在检查器里登记为**豁免**，
不强制重写 —— 为了美观重写正在工作的脚本只增加风险。
但**新增文件必须合规**，否则检查失败。

### 为什么

在这个 Windows 环境下，通过 PowerShell 的 `Set-Content` / `Out-File` /
`>` 重定向写入**非 ASCII 内容**会按系统代码页（GBK/936）编码，导致：

1. **文件内容乱码** —— 中文变成 `娣卞害娓呯悊` 这样的乱码；
2. **字符串字面量引号失配** —— 乱码可能产生额外引号或把引号吃掉，
   文件变成语法错误，脚本直接无法运行（实测 `SyntaxError: Invalid
   or unexpected token`）；
3. **排查成本极高** —— 报错指向的行看起来很"正常"（乱码），
   容易误判成逻辑 bug，实际是编码问题。

纯 ASCII 完全不受代码页影响，任何工具链下都是确定的。

### 已有的踩坑记录

| 症状 | 真实原因 |
|---|---|
| `启动系统.bat` 报一堆"不是内部或外部命令" | 中文注释被 GBK 写坏，行结构被破坏 |
| 测试脚本 `SyntaxError: Invalid or unexpected token` | 中文断言字符串被写坏，引号失配 |
| 用 PowerShell 替换脚本内容失败但无报错 | 文件里的中文已乱码，正则匹配不到 |

### 文档文件不受此限

`*.md`、`.vue`、`.js`（应用源码）、`.sql` 等**由 `write`/`edit` 工具维护**
的文件可以正常使用中文 —— 这些工具按 UTF-8 写入，没有上述问题。
本约定只针对**脚本与测试**，尤其是可能被 shell 重定向创建的那些。

---

## 2. 改动前先读，不要凭猜测修改

- 修 bug 前**先复现**，看到实际现象再动手。
- 用户报告"某处有问题"时，**先确认指的是哪个具体位置**，
  再对齐预期。曾经因为自行推断问题点而改错地方，浪费一轮。
- 声称"已验证"必须有证据：命令输出、断言计数、截图。
  **不要用"看起来对"代替验证。**

---

## 3. 脚本落盘方式

写脚本、测试、工具时：

- **优先用 `write` / `edit` 工具**创建（UTF-8 安全）。
- 必须用 shell 重定向时，**内容只能是纯 ASCII**（见第 1 条）。
- 不要把中文内容用 `Set-Content -Encoding UTF8` 写入 ——
  PowerShell 5.1 的 `-Encoding UTF8` 会写 BOM，且在此环境下实测仍会写坏中文。

---

## 4. 结构与数据变更要改两边

本地是 SQLite + Alembic，线上是 Cloudflare D1 + wrangler migrations，
**两套机制、两个库**：

| | 本地开发库 | 线上生产库 |
|---|---|---|
| 库 | `backend/inventory.db` | Cloudflare D1 `inventory` |
| 模型 | `backend/app/models/*.py` | 无 ORM，手写 SQL 在 `cf/routes/*.js` |
| 迁移 | `python -m alembic` | `wrangler d1 migrations` |
| 迁移文件 | `backend/alembic/versions/*.py` | `cf/migrations/*.sql` |

加字段要同时改：本地模型 + Alembic 迁移、D1 迁移、`cf/routes/` 里的读写 SQL。
只改一边的后果：本地能跑线上报 `no such column`，或反之。

---

## 5. 部署与验证

```bash
# 本地联调（miniflare，免账号）
wrangler pages dev --port 8788

# 结构变更
wrangler d1 migrations apply inventory --remote

# 部署
cd frontend && npm run build && cd ..
wrangler pages deploy frontend/dist --project-name=inventory --branch=main
```

部署后按需运行验证脚本（`node cf/verify-*.mjs [base] [user] [pass]`）。
注意 `cf/smoke-test.mjs` 要求**干净库**，库里有真实业务数据时会必然失败 ——
那是测试假设失效，不是功能坏了。

### 干净重建 dist

`frontend/vite.config.js` 里设了 `emptyOutDir: false`（避免 watch 模式出现
「目录已空但新文件未写完」的窗口）。代价是 `dist/assets` 会累积历史 hash 文件，
部署前若发现文件数异常增长，先手动删掉 `frontend/dist` 再构建。

### git 推送：由人工执行，不要自动推

**分工约定**：

| 动作 | 谁做 |
|---|---|
| `wrangler pages deploy`（部署到 Cloudflare） | **自动**，改完就部署并验证线上 |
| `wrangler d1 migrations apply --remote` | 按需，结构变更时执行 |
| `git commit`（提交到本地） | **自动**，每个可交付的改动一个提交 |
| `git push`（推送到 GitHub） | **人工**，代理不要推 |

即：代理负责「部署上线 + 本地提交」，**推送留给人工**。
所以工作区出现 `main...origin/main [ahead N]` 是**正常状态**，不是遗漏，
不要反复重试 `git push`（本机到 GitHub 链路不稳定，重试会长时间卡住）。

需要推送时人工执行：

```bash
git -c http.lowSpeedLimit=0 -c http.lowSpeedTime=999 -c http.connectTimeout=180 push origin main
```

（放宽超时参数是因为本机到 GitHub 链路很慢，默认 21 秒连接超时不够，
会报 `Failed to connect to github.com port 443`。）

---

## 6. 敏感文件

**已在 `.gitignore` 中忽略，绝不要提交**：

- `.dev.vars`（含本地 `SECRET_KEY`）
- `.wrangler/`（本地 D1 副本）
- `cf/migrate-data.sql`（含业务数据）
- `cf/_backup_*.sql`（线上备份）
- `frontend/dist/`、`.build-tmp/`

提交前用 `git status --porcelain` 确认没有意外文件混入。
