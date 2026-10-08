"""Alembic 迁移环境配置 —— 进销存管理系统

要点：
  1. 数据库 URL 直接取 app.config.settings.DATABASE_URL，
     与后端运行时**完全同一个库**，不在 alembic.ini 里重复写一份。
  2. target_metadata 用 app.database.Base.metadata，
     并 import app.models 触发所有模型注册，autogenerate 才能看到全部表。
  3. SQLite 打开 render_as_batch=True：
     SQLite 原生只支持 ADD COLUMN，改类型/删列/改约束需要「重建表」，
     batch 模式会自动生成 建新表→拷数据→换名 的迁移脚本。
"""
from logging.config import fileConfig
import sys
from pathlib import Path

from sqlalchemy import engine_from_config, pool
from alembic import context

# ---- 让 backend/ 进入 sys.path，保证 `import app` 可用 ----
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# ---- 项目自身的配置与模型 ----
from app.config import settings           # noqa: E402
from app.database import Base             # noqa: E402
import app.models                          # noqa: E402,F401  —— 必须导入，否则元数据是空的

config = context.config

# 用应用的 DATABASE_URL 覆盖 alembic.ini（避免两处配置漂移）
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """离线模式：只生成 SQL，不连库。"""
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=settings.DATABASE_URL.startswith("sqlite"),
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """在线模式：连库执行迁移。"""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=settings.DATABASE_URL.startswith("sqlite"),
            compare_type=True,          # 类型变化也纳入 autogenerate 对比
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
