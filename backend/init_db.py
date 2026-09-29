"""初始化数据库和默认数据（幂等：可反复执行补齐权限与角色）"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import engine, SessionLocal, Base
from app.models import *
from app.models.purchase import PurchaseOrder
from app.models.sales import SalesOrder
from app.models.permission import Permission, role_permissions
from app.core.security import get_password_hash
from app.core.automigrate import auto_migrate
from app.core.permissions import all_permissions, ROLE_TEMPLATES, role_permission_codes
from app.config import BASE_DIR


def _sync_permissions(db):
    """补齐缺失权限（不删除已有）"""
    existing = {p.code: p for p in db.query(Permission).all()}
    added = 0
    for code, name, module in all_permissions():
        if code in existing:
            # 名称/模块可能调整，同步过去
            if existing[code].name != name or existing[code].module != module:
                existing[code].name = name
                existing[code].module = module
            continue
        db.add(Permission(code=code, name=name, module=module))
        added += 1
    db.flush()
    return added


def _sync_roles(db):
    """补齐预置角色（已存在则只补权限，不改用户自定义的删减）"""
    created = []
    for tpl in ROLE_TEMPLATES:
        role = db.query(Role).filter(Role.name == tpl["name"]).first()
        if not role:
            role = Role(name=tpl["name"], description=tpl["description"])
            db.add(role)
            db.flush()
            created.append(tpl["label"])

        if tpl["patterns"] == ["*"] or not role.perms:
            # 管理员始终全权限；其他角色仅在无权限时初始化
            codes = role_permission_codes(tpl)
            perms = db.query(Permission).filter(Permission.code.in_(codes)).all()
            role.perms = perms

        if not role.description:
            role.description = tpl["description"]

    return created


def init_database():
    Base.metadata.create_all(bind=engine)
    added_cols = auto_migrate(engine, Base)
    if added_cols:
        print("  补齐字段: " + ", ".join(added_cols))

    db = SessionLocal()
    try:
        n_perm = _sync_permissions(db)
        print(f"  权限点: 新增 {n_perm} 个，共 {db.query(Permission).count()} 个")

        new_roles = _sync_roles(db)
        if new_roles:
            print(f"  新增角色: {', '.join(new_roles)}")
        print(f"  角色总数: {db.query(Role).count()} 个")

        # 首次运行创建管理员与默认仓库
        if not db.query(User).filter(User.username == "admin").first():
            admin_role = db.query(Role).filter(Role.name == "admin").first()
            db.add(User(
                username="admin",
                email="admin@example.com",
                password_hash=get_password_hash("admin123"),
                full_name="系统管理员",
                role_id=admin_role.id if admin_role else None,
                status=1,
            ))
            print("  创建管理员: admin / admin123")

        if not db.query(Warehouse).first():
            db.add(Warehouse(name="默认仓库", address="总部", status=1))
            print("  创建默认仓库（库存操作必需）")

        db.commit()

        # 一次性清理：把可选唯一字段的空字符串改成 NULL。
        # 历史上 sku 存成 ''，第二条空 sku 会违反 UNIQUE 约束导致保存失败。
        fixed = 0
        for model, field in ((Product, "sku"), (Product, "barcode")):
            n = db.query(model).filter(getattr(model, field) == "").update(
                {field: None}, synchronize_session=False
            )
            fixed += n
        if fixed:
            db.commit()
            print(f"  清理空字符串唯一字段: {fixed} 条（sku/barcode 改为 NULL）")

        # 一次性迁移：采购单状态重排
        #   旧 0 待审核 -> 0 草稿          （值不变）
        #   旧 1 已审核 -> 1 已审核        （值不变）
        #   旧 2 已入库 -> 3 已收货
        #   旧 3 已作废 -> 4 已关闭
        # 新增 2 = 部分收货
        marker = BASE_DIR / ".status_migrated"
        if not marker.exists():
            n_received = db.query(PurchaseOrder).filter(
                PurchaseOrder.status == 2
            ).update({PurchaseOrder.status: 3}, synchronize_session=False)
            n_closed = db.query(PurchaseOrder).filter(
                PurchaseOrder.status == 3
            ).update({PurchaseOrder.status: 4}, synchronize_session=False)
            db.commit()
            marker.write_text("purchase status remapped: 2->3, 3->4\n", encoding="utf-8")
            print(f"  采购状态迁移: 已入库->已收货 {n_received} 条, 已作废->已关闭 {n_closed} 条")

        # 一次性迁移：销售单状态重排（同上）
        #   旧 2 已出库 -> 3 已发货
        #   旧 3 已作废 -> 4 已关闭
        # 新增 2 = 部分发货
        smarker = BASE_DIR / ".sales_status_migrated"
        if not smarker.exists():
            n_shipped = db.query(SalesOrder).filter(
                SalesOrder.status == 2
            ).update({SalesOrder.status: 3}, synchronize_session=False)
            n_sclosed = db.query(SalesOrder).filter(
                SalesOrder.status == 3
            ).update({SalesOrder.status: 4}, synchronize_session=False)
            db.commit()
            smarker.write_text("sales status remapped: 2->3, 3->4\n", encoding="utf-8")
            print(f"  销售状态迁移: 已出库->已发货 {n_shipped} 条, 已作废->已关闭 {n_sclosed} 条")

        # 按实际退货情况同步销售/采购单状态（幂等，每次执行都重算）
        #   无退货   -> 3 已发货/已收货（未发出则 2）
        #   部分退回 -> 5 部分退货
        #   全部退回 -> 6 已退货
        from app.models.returns import SaleReturn, PurchaseReturn
        n_partial = n_full = n_revert = 0
        for order_model, ret_model, fk, attr in (
            (SalesOrder, SaleReturn, "sales_order_id", "shipped_quantity"),
            (PurchaseOrder, PurchaseReturn, "purchase_order_id", "received_quantity"),
        ):
            ret_all = {}
            for r in db.query(ret_model).filter(ret_model.status != 3).all():
                oid = getattr(r, fk)
                if not oid:
                    continue
                m = ret_all.setdefault(oid, {})
                for it in r.items:
                    m[it.product_id] = m.get(it.product_id, 0) + (it.quantity or 0)

            for o in db.query(order_model).filter(order_model.status.in_([2, 3, 5, 6])).all():
                rmap = ret_all.get(o.id, {})
                total_ret = total_out = 0
                all_fully = True
                for it in o.items:
                    base = getattr(it, attr, 0) or 0
                    got = rmap.get(it.product_id, 0)
                    total_ret += got
                    total_out += base
                    if got < base:
                        all_fully = False

                if total_ret == 0:
                    target = 3 if total_out > 0 else 2
                    if o.status in (5, 6):
                        n_revert += 1
                elif all_fully and total_out > 0:
                    target = 6
                    if o.status != 6:
                        n_full += 1
                else:
                    target = 5
                    if o.status != 5:
                        n_partial += 1
                o.status = target

        db.commit()
        if n_partial or n_full or n_revert:
            print(f"  退货状态同步: 部分退货 {n_partial} 单, 已退货 {n_full} 单, 回退 {n_revert} 单")

        n_user = db.query(User).count()
        print("数据库初始化完成")
        print(f"  用户账号: {n_user} 个（admin / admin123，登录后请立即修改密码）")

    except Exception as e:
        db.rollback()
        print(f"初始化失败: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    init_database()
