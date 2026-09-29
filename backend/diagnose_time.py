"""时间诊断：打印系统时间、Python 时间与数据库实际存储值，定位时间偏差。

用法：
    python diagnose_time.py
"""
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import inspect, text as sql_text
from app.database import engine, SessionLocal, Base
from app.models import *          # noqa: F401,F403
from app.core.timeutil import now_local

CHECK_TABLES = [
    ("users", ["created_at", "updated_at"]),
    ("suppliers", ["created_at"]),
    ("customers", ["created_at"]),
    ("products", ["created_at"]),
    ("purchase_orders", ["created_at", "updated_at", "approve_at"]),
    ("sales_orders", ["created_at", "updated_at", "approve_at"]),
    ("payments", ["created_at"]),
    ("operation_logs", ["created_at"]),
]


def main():
    print("=" * 68)
    print("系统时间")
    print("=" * 68)
    print(f"  Python datetime.now()  : {datetime.now()}")
    print(f"  now_local()            : {now_local()}")
    print(f"  时区                   : {datetime.now().astimezone().tzinfo}")

    db = SessionLocal()
    try:
        # 数据库内建时间函数
        for expr, label in [
            ("CURRENT_TIMESTAMP", "SQLite CURRENT_TIMESTAMP (UTC)"),
            ("datetime('now','localtime')", "SQLite localtime"),
        ]:
            try:
                v = db.execute(sql_text(f"SELECT {expr}")).scalar()
                print(f"  {label:<34}: {v}")
            except Exception as e:
                print(f"  {label:<34}: 不可用 ({e})")

        print()
        print("=" * 68)
        print("数据库实际存储值（每表取最近 3 行）")
        print("=" * 68)

        insp = inspect(engine)
        for table, cols in CHECK_TABLES:
            if not insp.has_table(table):
                print(f"\n[{table}] 表不存在")
                continue

            have = {c["name"] for c in insp.get_columns(table)}
            use = [c for c in cols if c in have]
            if not use:
                continue

            select_cols = "id, " + ", ".join(use)
            rows = db.execute(
                sql_text(f'SELECT {select_cols} FROM "{table}" ORDER BY id DESC LIMIT 3')
            ).fetchall()

            print(f"\n[{table}]")
            if not rows:
                print("  (无数据)")
                continue
            for r in rows:
                parts = [f"id={r[0]}"]
                for i, c in enumerate(use):
                    parts.append(f"{c}={r[i + 1]}")
                print("  " + "  ".join(parts))

    finally:
        db.close()

    print()
    print("=" * 68)
    print("判读方法")
    print("=" * 68)
    print("  · created_at 比 Python 当前时间早约 8 小时  -> 该表数据是 UTC，需修正")
    print("  · created_at 与 Python 当前时间接近          -> 已是本地时间，正常")
    print("  · approve_at 与 created_at 相差约 8 小时     -> created_at 为 UTC（approve_at 一直是本地）")


if __name__ == "__main__":
    main()
