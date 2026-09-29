"""轻量自动迁移：为已存在的表补齐模型中新增的列。

SQLAlchemy 的 create_all 只建新表，不会给旧表加列。
SQLite 支持 ALTER TABLE ADD COLUMN，这里按模型定义补齐。
仅处理「新增可空列 / 有默认值列」，不会删列、改类型。
"""
from sqlalchemy import inspect, text
from sqlalchemy.schema import CreateColumn


def _column_ddl(column, dialect):
    """生成 ADD COLUMN 用的列定义片段（去掉 NOT NULL 约束避免旧行冲突）"""
    try:
        ddl = str(CreateColumn(column).compile(dialect=dialect)).strip()
    except Exception:
        return None
    # ALTER TABLE ADD COLUMN 不允许无默认值的 NOT NULL
    if "NOT NULL" in ddl.upper() and column.default is None and column.server_default is None:
        ddl = ddl.replace(" NOT NULL", "").replace(" not null", "")
    return ddl


def auto_migrate(engine, base):
    """对比模型与实际表结构，补齐缺失列。返回新增列表。"""
    dialect = engine.dialect
    if dialect.name != "sqlite":
        return []

    added = []
    inspector = inspect(engine)

    with engine.begin() as conn:
        for table in base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue  # create_all 已处理

            existing = {c["name"] for c in inspector.get_columns(table.name)}

            for column in table.columns:
                if column.name in existing:
                    continue

                ddl = _column_ddl(column, dialect)
                if not ddl:
                    print(f"[MIGRATE][SKIP] {table.name}.{column.name} 无法生成 DDL")
                    continue

                # 新增列必须允许 NULL 或有默认值
                if "NOT NULL" in ddl.upper() and column.default is None and column.server_default is None:
                    print(f"[MIGRATE][SKIP] {table.name}.{column.name} NOT NULL 且无默认值")
                    continue

                try:
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN {ddl}'))
                    added.append(f"{table.name}.{column.name}")
                except Exception as e:
                    print(f"[MIGRATE][FAIL] {table.name}.{column.name}: {e}")

    return added
