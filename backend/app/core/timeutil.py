"""统一时间工具

SQLite 的 CURRENT_TIMESTAMP（func.now()）返回 UTC，
而 Python 的 datetime.now() 返回服务器本地时间。
两者混用会导致同一张表里时间相差时区偏移。

本项目统一使用【固定时区】的本地时间（默认 Asia/Shanghai），
不依赖服务器系统时区设置 —— 服务器时区设成 UTC 也不会导致时间错乱。

可用环境变量 APP_TIMEZONE 覆盖，例如 APP_TIMEZONE=Asia/Shanghai
"""
import os
from datetime import datetime, timedelta
from pathlib import Path

# 确保 .env 中的 APP_TIMEZONE 生效（独立脚本运行时 config 可能尚未导入）
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
except Exception:
    pass

try:
    from zoneinfo import ZoneInfo          # Python 3.9+
    _HAS_ZONEINFO = True
except ImportError:
    _HAS_ZONEINFO = False

APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Shanghai")

# 数据库统一存 naive datetime（不带 tzinfo），便于前端直接展示
_TZ = None
if _HAS_ZONEINFO:
    try:
        _TZ = ZoneInfo(APP_TIMEZONE)
    except Exception:
        _TZ = None

# zoneinfo 不可用时的兜底偏移（小时）
_FALLBACK_OFFSET_HOURS = int(os.getenv("APP_UTC_OFFSET", "8"))


def now_local() -> datetime:
    """当前本地时间（naive，直接写入数据库）"""
    if _TZ is not None:
        return datetime.now(_TZ).replace(tzinfo=None)
    return datetime.utcnow() + timedelta(hours=_FALLBACK_OFFSET_HOURS)


def utc_to_local(dt: datetime) -> datetime:
    """把历史上按 UTC 存储的时间转为本地时间"""
    if dt is None:
        return None
    if _TZ is not None:
        delta = datetime.now(_TZ).utcoffset() or timedelta(0)
        return dt + delta
    return dt + timedelta(hours=_FALLBACK_OFFSET_HOURS)


def local_now_str() -> str:
    return now_local().strftime("%Y-%m-%d %H:%M:%S")
