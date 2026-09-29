"""数据库备份/恢复。用法：
    python backup_db.py              备份
    python backup_db.py --list       列出备份
    python backup_db.py --restore 文件名   恢复
"""
import sys
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.config import settings  # noqa: E402


def db_path() -> Path:
    url = settings.DATABASE_URL
    if not url.startswith("sqlite"):
        raise SystemExit("仅支持 SQLite 备份")
    return Path(url.replace("sqlite:///", ""))


def backup():
    src = db_path()
    if not src.exists():
        raise SystemExit(f"数据库不存在: {src}")
    settings.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    dst = settings.BACKUP_DIR / f"inventory_{datetime.now():%Y%m%d_%H%M%S}.db"
    # 用 SQLite 在线备份 API，保证一致性
    con = sqlite3.connect(str(src))
    try:
        bak = sqlite3.connect(str(dst))
        try:
            con.backup(bak)
        finally:
            bak.close()
    finally:
        con.close()
    print(f"备份完成: {dst}  ({dst.stat().st_size / 1024:.1f} KB)")
    return dst


def list_backups():
    if not settings.BACKUP_DIR.exists():
        print("暂无备份")
        return
    files = sorted(settings.BACKUP_DIR.glob("inventory_*.db"), reverse=True)
    if not files:
        print("暂无备份")
        return
    for f in files:
        print(f"{f.name}  {f.stat().st_size / 1024:.1f} KB  {datetime.fromtimestamp(f.stat().st_mtime):%Y-%m-%d %H:%M:%S}")


def restore(name: str):
    src = settings.BACKUP_DIR / name
    if not src.exists():
        raise SystemExit(f"备份不存在: {src}")
    dst = db_path()
    if dst.exists():
        safety = dst.with_suffix(f".before_restore_{datetime.now():%Y%m%d_%H%M%S}.db")
        shutil.copy2(dst, safety)
        print(f"已保存当前库: {safety}")
    shutil.copy2(src, dst)
    print(f"恢复完成: {dst}  <- {src}")


if __name__ == "__main__":
    if len(sys.argv) == 1:
        backup()
    elif sys.argv[1] == "--list":
        list_backups()
    elif sys.argv[1] == "--restore" and len(sys.argv) > 2:
        restore(sys.argv[2])
    else:
        print(__doc__)
