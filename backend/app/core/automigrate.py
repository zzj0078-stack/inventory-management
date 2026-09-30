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


def rebuild_table_relaxing_not_null(engine, table, column_name: str):
    """把 table.column_name 的 NOT NULL 约束去掉（SQLite 无 DROP NOT NULL，需重建表）。

    用于把历史库的 users.email（原来 NOT NULL）改成可空。
    流程：建新表 → 灌数据 → 删旧表 → 改名 → 重建索引。
    期间关闭外键约束；因表名最终保持不变，其它表指向它的外键不受影响。

    返回 (是否执行, 说明)
    """
    if engine.dialect.name != "sqlite":
        return False, "仅支持 SQLite"

    table_name = table.name
    inspector = inspect(engine)

    if not inspector.has_table(table_name):
        return False, "表不存在"

    cols = {c["name"]: c for c in inspector.get_columns(table_name)}
    col = cols.get(column_name)
    if col is None:
        return False, f"列 {column_name} 不存在"
    if col.get("nullable", True):
        return False, f"{table_name}.{column_name} 已经是可空，无需处理"

    # 目标表结构：按模型定义生成（含唯一约束 / 外键 / 索引）
    tmp_name = f"__new_{table_name}"
    model_cols = [c.name for c in table.columns]
    data_cols = [c for c in model_cols if c in cols]

    from sqlalchemy.schema import CreateTable, CreateIndex

    original_ddl = str(CreateTable(table).compile(dialect=engine.dialect)).strip()
    ddl = original_ddl.replace(f"CREATE TABLE {table_name}", f"CREATE TABLE {tmp_name}", 1)
    if ddl == original_ddl:
        ddl = original_ddl.replace(
            f'CREATE TABLE "{table_name}"', f'CREATE TABLE "{tmp_name}"', 1
        )
    if ddl == original_ddl:
        return False, "无法改写 CREATE TABLE 语句，已跳过"

    # SQLite 细节：
    #  1) 子表（purchase_orders / sales_orders / payments ...）有指向 users.id 的外键，
    #     外键开启时 DROP TABLE users 会报 FOREIGN KEY constraint failed。
    #  2) PRAGMA foreign_keys 在事务内是 no-op，必须用 AUTOCOMMIT 连接单独执行。
    #  3) 新版 SQLite 的 ALTER TABLE ... RENAME 会去重写子表的 REFERENCES 子句，
    #     这里用 legacy_alter_table 关掉该行为（表名最终不变，无需重写）。
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as aconn:
        aconn.execute(text("PRAGMA foreign_keys=OFF"))
        aconn.execute(text("PRAGMA legacy_alter_table=ON"))

        aconn.execute(text(f'DROP TABLE IF EXISTS "{tmp_name}"'))
        aconn.execute(text(ddl))

        collist = ", ".join(f'"{c}"' for c in data_cols)
        aconn.execute(
            text(
                f'INSERT INTO "{tmp_name}" ({collist}) '
                f'SELECT {collist} FROM "{table_name}"'
            )
        )

        aconn.execute(text(f'DROP TABLE "{table_name}"'))
        aconn.execute(text(f'ALTER TABLE "{tmp_name}" RENAME TO "{table_name}"'))

        # 唯一约束 + 空串的经典坑：'' 归一为 NULL，
        # 否则第二条空邮箱会撞唯一索引（NULL 不参与唯一性判断）
        if column_name in data_cols:
            fixed = aconn.execute(
                text(
                    f"UPDATE \"{table_name}\" SET \"{column_name}\" = NULL "
                    f"WHERE \"{column_name}\" = ''"
                )
            ).rowcount
            if fixed:
                print(f"[MIGRATE] {table_name}.{column_name}: {fixed} 条空串已归一为 NULL")

        # 重建索引（唯一索引等）
        for idx in table.indexes:
            try:
                aconn.execute(CreateIndex(idx))
            except Exception as e:
                print(f"[MIGRATE][WARN] 重建索引 {idx.name} 失败: {e}")

        # 一致性检查
        aconn.execute(text("PRAGMA foreign_key_check"))

        aconn.execute(text("PRAGMA legacy_alter_table=OFF"))
        aconn.execute(text("PRAGMA foreign_keys=ON"))

    return True, f"已重建 {table_name}，{column_name} 改为可空"
