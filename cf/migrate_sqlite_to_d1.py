"""把本地 SQLite（backend/inventory.db）的存量数据导出为 D1 可执行的 SQL。

用法：
    python cf/migrate_sqlite_to_d1.py                     # 生成 cf/migrate-data.sql
    python cf/migrate_sqlite_to_d1.py --dry-run           # 只统计行数，不写文件

    # 应用到 D1（本地调试用 --local，线上用 --remote）
    wrangler d1 execute inventory --file=cf/migrate-data.sql --local
    wrangler d1 execute inventory --file=cf/migrate-data.sql --remote

设计要点：
  * 按外键顺序输出（父表在前），D1 强制外键，顺序错会整批回滚
  * 默认用 INSERT OR IGNORE：可重复执行，已存在的行自动跳过。
    SQLite 的 ON CONFLICT 算法**不作用于外键**，所以外键错误仍会正常报出来，
    不会被静默吞掉。
  * --replace 改为「先按反序 DELETE 再 INSERT」，用于整体覆盖
  * 保留原始 id，保证外键指向不变
  * roles / permissions / role_permissions 属于种子数据（cf/seed.sql 已负责），
    默认跳过；需要时用 --include-seed

注意：生成的 cf/migrate-data.sql 含业务数据，已在 .gitignore 中忽略。
"""
import argparse
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_DB = os.path.join(ROOT, "backend", "inventory.db")
DEFAULT_OUT = os.path.join(HERE, "migrate-data.sql")

# 外键顺序：父表在前（与 cf/schema.sql 一致）
TABLES = [
    "roles",
    "permissions",
    "role_permissions",
    "users",
    "categories",
    "suppliers",
    "customers",
    "warehouses",
    "products",
    "inventory",
    "purchase_orders",
    "purchase_items",
    "purchase_returns",
    "purchase_return_items",
    "sales_orders",
    "sales_items",
    "sale_returns",
    "sale_return_items",
    "payments",
    "stock_logs",
    "stock_transfers",
    "stock_transfer_items",
    "stock_checks",
    "stock_check_items",
    "operation_logs",
]

# 由 cf/seed.sql 负责的种子数据（D1 里已有，重复灌会撞唯一键）
SEED_TABLES = {"roles", "permissions", "role_permissions"}


def quote_ident(name):
    return '"' + str(name).replace('"', '""') + '"'


def lit(v):
    """把 Python 值转成 SQL 字面量"""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (bytes, bytearray)):
        return "X'" + bytes(v).hex() + "'"
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB, help="源 SQLite 文件")
    ap.add_argument("--out", default=DEFAULT_OUT, help="输出 SQL 文件")
    ap.add_argument("--tables", help="只迁移这些表（逗号分隔）")
    ap.add_argument("--include-seed", action="store_true", help="连种子数据一起迁移")
    ap.add_argument("--replace", action="store_true", help="先 DELETE 再 INSERT（整体覆盖）")
    ap.add_argument("--dry-run", action="store_true", help="只打印行数，不写文件")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print(f"源数据库不存在：{args.db}")
        return 1

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    existing = {
        r[0]
        for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }

    wanted = list(TABLES)
    if args.tables:
        sel = {t.strip() for t in args.tables.split(",") if t.strip()}
        wanted = [t for t in TABLES if t in sel]
    elif not args.include_seed:
        wanted = [t for t in TABLES if t not in SEED_TABLES]

    wanted = [t for t in wanted if t in existing]

    # 收集数据
    payload = {}
    for t in wanted:
        rows = list(cur.execute(f"SELECT * FROM {quote_ident(t)}"))
        payload[t] = rows

    print("源库:", args.db)
    print("迁移表: %d 个" % len(wanted))
    total = 0
    for t in wanted:
        n = len(payload[t])
        total += n
        if n:
            print("  %-24s %5d 行" % (t, n))
    print("  合计 %d 行" % total)

    skipped = [t for t in TABLES if t in existing and t not in wanted]
    if skipped:
        print("跳过:", ", ".join(skipped))

    if args.dry_run:
        print("\n--dry-run：未写文件")
        con.close()
        return 0

    # 生成 SQL
    out = []
    out.append("-- ============================================================")
    out.append("--  存量数据迁移：本地 SQLite -> Cloudflare D1")
    out.append("--  由 cf/migrate_sqlite_to_d1.py 生成，请勿手改")
    out.append("--")
    out.append("--  执行：")
    out.append("--    wrangler d1 execute inventory --file=cf/migrate-data.sql --remote")
    out.append("-- ============================================================")
    out.append("")

    if args.replace:
        out.append("-- 整体覆盖：先按外键反序清空")
        for t in reversed(wanted):
            out.append(f"DELETE FROM {quote_ident(t)};")
        out.append("")

    for t in wanted:
        rows = payload[t]
        if not rows:
            continue

        cols = list(rows[0].keys())
        collist = ", ".join(quote_ident(c) for c in cols)
        verb = "INSERT INTO" if args.replace else "INSERT OR IGNORE INTO"

        out.append(f"-- ---------- {t}（{len(rows)} 行）----------")
        for r in rows:
            vals = ", ".join(lit(r[c]) for c in cols)
            out.append(f"{verb} {quote_ident(t)} ({collist}) VALUES ({vals});")
        out.append("")

    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

    con.close()
    print(f"\n已生成：{args.out}")
    print("下一步：")
    print(f"  wrangler d1 execute inventory --file={os.path.relpath(args.out, ROOT)} --local")
    print(f"  wrangler d1 execute inventory --file={os.path.relpath(args.out, ROOT)} --remote")
    return 0


if __name__ == "__main__":
    sys.exit(main())
