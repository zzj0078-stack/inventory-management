"""按当前退货情况重算销售单 / 采购单的退货状态（幂等，可反复执行）。

规则：
    无退货     -> 3 已发货 / 3 已收货      （未发出的退回 2 部分发货/收货）
    部分退回   -> 5 部分退货
    全部退回   -> 6 已退货

用法：
    python fix_return_status.py            # 预览
    python fix_return_status.py --apply    # 执行
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app.models import *          # noqa: F401,F403
from app.models.purchase import PurchaseOrder
from app.models.sales import SalesOrder
from app.models.returns import SaleReturn, PurchaseReturn

STATUS_TEXT = {
    0: "草稿", 1: "已审核", 2: "部分发货/收货", 3: "已发货/已收货",
    4: "已关闭", 5: "部分退货", 6: "已退货", 7: "部分发货", 8: "部分收货",
}


def _label(kind, st):
    if st == 2:
        return "部分发货" if kind == "sale" else "部分收货"
    if st == 3:
        return "已发货" if kind == "sale" else "已收货"
    return STATUS_TEXT.get(st, str(st))


def calc_target(order, ret_map, attr):
    """返回目标状态值"""
    total_ret = 0
    total_out = 0
    all_fully = True
    for it in order.items:
        base = getattr(it, attr, 0) or 0
        got = ret_map.get(it.product_id, 0)
        total_ret += got
        total_out += base
        if got < base:
            all_fully = False

    if total_ret == 0:
        return (3 if total_out > 0 else 2)
    if all_fully and total_out > 0:
        return 6
    return 5


def run(apply: bool):
    db = SessionLocal()
    try:
        grand = 0
        for kind, order_model, ret_model, fk, attr in (
            ("sale", SalesOrder, SaleReturn, "sales_order_id", "shipped_quantity"),
            ("purchase", PurchaseOrder, PurchaseReturn, "purchase_order_id", "received_quantity"),
        ):
            print(f"\n{'=' * 68}")
            print(f"{'销售' if kind == 'sale' else '采购'}单状态重算")
            print("=" * 68)

            orders = db.query(order_model).filter(order_model.status.in_([2, 3, 5, 6])).all()

            # 组装退货数量：order_id -> {product_id: qty}，排除已作废退货
            ret_map_all = {}
            for r in db.query(ret_model).filter(ret_model.status != 3).all():
                oid = getattr(r, fk)
                if not oid:
                    continue
                m = ret_map_all.setdefault(oid, {})
                for it in r.items:
                    m[it.product_id] = m.get(it.product_id, 0) + (it.quantity or 0)

            changed = 0
            for o in orders:
                target = calc_target(o, ret_map_all.get(o.id, {}), attr)
                if target == o.status:
                    continue
                changed += 1
                print(f"  {o.order_no}  {_label(kind, o.status)} -> {_label(kind, target)}")
                if apply:
                    o.status = target

            if apply and changed:
                db.commit()

            print(f"  共 {len(orders)} 单，需修正 {changed} 单")
            grand += changed

        if apply:
            print(f"\n已完成，共修正 {grand} 单")
        else:
            print(f"\n预览：共 {grand} 单待修正。确认后加 --apply 执行。")
    except Exception as e:
        db.rollback()
        print(f"失败：{type(e).__name__}: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run("--apply" in sys.argv)
