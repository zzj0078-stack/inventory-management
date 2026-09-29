"""把历史数据中按 UTC 存储的时间修正为本地时间（+8 小时）。

背景：早期模型用 server_default=func.now()，SQLite 的 CURRENT_TIMESTAMP 返回 UTC，
导致 created_at / updated_at 比本地时间早 8 小时。

现在模型已改为 Python 侧 now_local()，新数据正确；本脚本只修历史数据。

只处理 created_at / updated_at，不动 approve_at（它原本就是本地时间）。

用法：
    python fix_time_offset.py            # 预览将要修改的记录数
    python fix_time_offset.py --apply    # 执行（只允许一次）
    python fix_time_offset.py --apply --force   # 强制再执行
"""
import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import DateTime as SADateTime, inspect, text as sql_text

from app.database import engine, SessionLocal, Base
from app.models import *          # noqa: F401,F403  必须导入以注册所有表
from app.core.timeutil import LOCAL_OFFSET_HOURS

# 只修正这两个列（原 server_default=func.now() -> UTC）
AFFECTED_COLUMNS = {"created_at", "updated_at"}

MARKER = Path(__file__).resolve().parent / ".time_fixed"

# 表 -> 需修正的时间列
TIME_COLUMNS = {}


def collect_time_columns():
    insp = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue
        cols = [c["name"] for c in insp.get_columns(table.name)
                if isinstance(c["type"], SADateTime) and c["name"] in AFFECTED_COLUMNS]
        if cols:
            TIME_COLUMNS[table.name] = cols


def run(apply: bool, force: bool):
    if MARKER.exists() and apply and not force:
        print(f"检测到已完成标记：{MARKER}")
        print("如确需再次执行，请加 --force（会再次 +8 小时，可能重复偏移）")
        return

    collect_time_columns()
    if not TIME_COLUMNS:
        print("未发现可修正的时间列")
        return

    db = SessionLocal()
    total = 0
    try:
        offset = f"+{LOCAL_OFFSET_HOURS} hours"

        for table_name, cols in TIME_COLUMNS.items():
            # 统计非空行数
            where = " OR ".join(f"{c} IS NOT NULL" for c in cols)
            n = db.execute(
                sql_text(f'SELECT COUNT(*) FROM "{table_name}" WHERE {where}')
            ).scalar() or 0

            if n and apply:
                sets = ", ".join(
                    f"{c} = datetime({c}, '{offset}')" for c in cols
                )
                db.execute(
                    sql_text(f'UPDATE "{table_name}" SET {sets} WHERE {where}')
                )

            total += n
            print(f"  {table_name:<24} {n} 行")

        if apply:
            db.commit()
            MARKER.write_text(
                f"applied offset +{LOCAL_OFFSET_HOURS}h to created_at/updated_at\n",
                encoding="utf-8"
            )
            print(f"\n已完成，共 {total} 行（每列 +{LOCAL_OFFSET_HOURS} 小时）")
        else:
            print(f"\n预览：共 {total} 行待修正。确认后加 --apply 执行。")
    except Exception as e:
        db.rollback()
        print(f"失败：{type(e).__name__}: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run("--apply" in sys.argv, "--force" in sys.argv)
