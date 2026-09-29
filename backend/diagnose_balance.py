"""应收/应付数据自检：逐单核对销售/采购与退货的金额与数量。

用于定位「退货金额超过销售金额」「应收为负」等异常。

用法：
    python diagnose_balance.py
    python diagnose_balance.py --fix-cancel   # 自动作废超退的退货单
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app.models import *          # noqa: F401,F403
from app.models.sales import SalesOrder
from app.models.purchase import PurchaseOrder
from app.models.returns import SaleReturn, PurchaseReturn
from app.models.finance import Payment


def check(db, kind):
    """kind: sale / purchase"""
    if kind == "sale":
        order_model, ret_model, fk = SalesOrder, SaleReturn, "sales_order_id"
        label, partner_label = "销售", "客户"
    else:
        order_model, ret_model, fk = PurchaseOrder, PurchaseReturn, "purchase_order_id"
        label, partner_label = "采购", "供应商"

    print(f"\n{'=' * 72}")
    print(f"{label}单 / 退货 核对")
    print(f"{'=' * 72}")

    orders = db.query(order_model).filter(order_model.status.in_([1, 2, 3])).all()
    order_total = sum(float(o.total_amount or 0) for o in orders)

    # 退货统计：只算已审核/已入库，排除作废
    rets = db.query(ret_model).filter(ret_model.status.in_([1, 2])).all()
    ret_total = sum(float(r.total_amount or 0) for r in rets)
    orphan = [r for r in rets if not getattr(r, fk)]

    print(f"  {label}单（已审核/收货发货）: {len(orders)} 张，合计 {order_total:.2f}")
    print(f"  退货单（已审核/入库出库）: {len(rets)} 张，合计 {ret_total:.2f}")
    if orphan:
        print(f"  ⚠ 未关联原单的退货: {len(orphan)} 张，合计 "
              f"{sum(float(r.total_amount or 0) for r in orphan):.2f}")

    over_returns = []

    # 按商品核对数量
    print(f"\n  {'单据':<20}{'商品':>6}{'已发/收':>10}{'已退':>8}{'超退':>8}")
    bad = 0
    for o in orders:
        rets_of = [r for r in rets if getattr(r, fk) == o.id]
        for it in o.items:
            base = (it.shipped_quantity if kind == "sale" else it.received_quantity) or 0
            used = sum(i.quantity or 0 for r in rets_of for i in r.items
                       if i.product_id == it.product_id)
            if used > base:
                bad += 1
                print(f"  {o.order_no:<20}{it.product_id:>6}{base:>10}{used:>8}{used - base:>8}   <<< 超退")
                for r in rets_of:
                    if any(i.product_id == it.product_id for i in r.items):
                        over_returns.append(r)

    if bad == 0:
        print("  （无超退）")
    else:
        print(f"\n  共 {bad} 行超退")

    # 汇总
    net = order_total - ret_total
    print(f"\n  {label}总额 {order_total:.2f} − 退货 {ret_total:.2f} = 净额 {net:.2f}")
    if net < 0:
        print(f"  ⚠⚠ 净额为负：退货金额超过{label}金额，说明存在无来源/超量的退货数据")

    return over_returns


def main():
    apply = "--fix-cancel" in sys.argv
    db = SessionLocal()
    try:
        over_sale = check(db, "sale")
        over_purchase = check(db, "purchase")

        # 收付款与净额
        print(f"\n{'=' * 72}")
        print("资金汇总")
        print("=" * 72)
        sales = sum(float(o.total_amount or 0) for o in
                    db.query(SalesOrder).filter(SalesOrder.status.in_([1, 2, 3])).all())
        sr = sum(float(r.total_amount or 0) for r in
                 db.query(SaleReturn).filter(SaleReturn.status.in_([1, 2])).all())
        recv = sum(float(p.amount or 0) for p in db.query(Payment).filter(Payment.type == 1).all())
        purch = sum(float(o.total_amount or 0) for o in
                    db.query(PurchaseOrder).filter(PurchaseOrder.status.in_([1, 2, 3])).all())
        pr = sum(float(r.total_amount or 0) for r in
                 db.query(PurchaseReturn).filter(PurchaseReturn.status.in_([1, 2])).all())
        paid = sum(float(p.amount or 0) for p in db.query(Payment).filter(Payment.type == 2).all())

        print(f"  应收 = {sales:.2f} − 收款 {recv:.2f} − 退货 {sr:.2f} = {sales - recv - sr:.2f}")
        print(f"  应付 = {purch:.2f} − 付款 {paid:.2f} − 退货 {pr:.2f} = {purch - paid - pr:.2f}")

        # 处理超退
        uniq = {r.id: r for r in (over_sale + over_purchase)}
        if uniq and apply:
            print(f"\n作废 {len(uniq)} 张超退的退货单 ...")
            for r in uniq.values():
                r.status = 3
                print(f"  作废 {r.return_no}  {float(r.total_amount):.2f}")
            db.commit()
            print("完成，请重新查看应收/应付")
        elif uniq:
            print(f"\n发现 {len(uniq)} 张超退的退货单。")
            print("处理后端：加 --fix-cancel 自动作废它们；")
            print("或在前端「销售退货/采购退货」中手动作废对应的单据。")

    finally:
        db.close()


if __name__ == "__main__":
    main()
