"""从本地 SQLite 生成 D1 种子数据 cf/seed.sql（一次性代码生成）

产出：
  - roles（7 个预设角色）
  - permissions（84 个权限点）
  - role_permissions（角色-权限关联）
  - admin 用户（admin / admin123，salt:sha256 哈希）
  - 默认仓库
"""
import os
import secrets
import sqlite3
import hashlib
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(os.path.dirname(HERE), "backend")
DB = os.path.join(BACKEND, "inventory.db")
OUT = os.path.join(HERE, "seed.sql")


def q(v):
    """SQL 字面量转义"""
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def hash_password(plain):
    """与 backend/app/core/security.py 的 get_password_hash 完全一致：salt:sha256(salt+password)"""
    salt = secrets.token_hex(16)
    return salt + ":" + hashlib.sha256((salt + plain).encode()).hexdigest()


def main():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    roles = [dict(r) for r in cur.execute(
        "SELECT id, name, description, created_at FROM roles ORDER BY id")]
    perms = [dict(r) for r in cur.execute(
        "SELECT id, code, name, module, created_at FROM permissions ORDER BY id")]
    rp = [dict(r) for r in cur.execute(
        "SELECT role_id, permission_id FROM role_permissions ORDER BY role_id, permission_id")]

    admin_role = next((r for r in roles if r["name"] == "admin"), roles[0] if roles else None)
    if admin_role is None:
        raise SystemExit("本地库没有任何角色，先跑 backend/init_db.py")

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")

    lines = []
    w = lines.append
    w("-- ============================================================")
    w("--  进销存系统 —— D1 种子数据（由 cf/gen_seed.py 生成，勿手改）")
    w("--")
    w("--  内容：角色 / 权限点 / 角色权限关联 / admin 账号 / 默认仓库")
    w("--  默认账号：admin / admin123   ← 首次登录后请立即修改")
    w("--")
    w("--  执行：wrangler d1 execute inventory --file=cf/seed.sql --remote")
    w("-- ============================================================")
    w("")
    w("-- 幂等：先清空再插入（只动权限相关表和 admin，不碰业务数据）")
    w("DELETE FROM role_permissions;")
    w("DELETE FROM permissions;")
    w("DELETE FROM roles;")
    w("")
    w("-- ---------- 角色 ----------")
    for r in roles:
        w("INSERT INTO roles (id, name, description, created_at) VALUES (%s, %s, %s, %s);" % (
            q(r["id"]), q(r["name"]), q(r["description"]), q(r["created_at"] or now)))
    w("")
    w("-- ---------- 权限点 ----------")
    for p in perms:
        w("INSERT INTO permissions (id, code, name, module, created_at) VALUES (%s, %s, %s, %s, %s);" % (
            q(p["id"]), q(p["code"]), q(p["name"]), q(p["module"]), q(p["created_at"] or now)))
    w("")
    w("-- ---------- 角色-权限关联 ----------")
    for x in rp:
        w("INSERT INTO role_permissions (role_id, permission_id) VALUES (%s, %s);" % (
            q(x["role_id"]), q(x["permission_id"])))
    w("")
    w("-- ---------- admin 账号 ----------")
    w("-- 只在不存在时插入，避免覆盖已改过的密码")
    w("INSERT INTO users (username, email, password_hash, full_name, phone, role_id, status, created_at, updated_at)")
    w("SELECT 'admin', 'admin@example.com', %s, '系统管理员', NULL, %s, 1, %s, %s" % (
        q(hash_password("admin123")), q(admin_role["id"]), q(now), q(now)))
    w("WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');")
    w("")
    w("-- ---------- 默认仓库 ----------")
    w("INSERT INTO warehouses (name, address, manager, phone, status, created_at)")
    w("SELECT '默认仓库', '总部', NULL, NULL, 1, %s" % q(now))
    w("WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = '默认仓库');")
    w("")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    con.close()
    print("已生成: cf/seed.sql")
    print("  角色: %d" % len(roles))
    print("  权限点: %d" % len(perms))
    print("  角色权限关联: %d" % len(rp))
    print("  admin 角色 id: %s" % admin_role["id"])


if __name__ == "__main__":
    main()
