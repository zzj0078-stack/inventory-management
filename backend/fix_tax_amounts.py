"""按「价内税」口径重算历史单据的税额与整单合计。

背景：早期算法是价外税
    税额     = Σ(数量 × 单价 × 税率%)
    整单合计 = Σ(数量 × 单价) + 税额 + 运费

现改为价内税（单价已含税）
    金额小计 = 数量 × 单价（含税）
    内含税额 = Σ(小计 − 小计 / (1 + 税率/100))
    整单合计 = Σ小计 + 运费

本脚本把已存在的采购单 / 销售单按新口径重算。

用法：
    python fix_tax_amounts.py            # 预览
    python fix_tax_amounts.py --apply    # 执行（只允许一次）
    python fix_tax_amounts.py --apply --force
"""
import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app.models import *          # noqa: F401,F403
from app.models.purchase import PurchaseOrder
from app.models.sales import SalesOrder

MARKER = Path(__file__).resolve().parent / ".tax_fixed"


def calc(items, freight):
    """返回 (明细含税合计, 内含税额, 整单合计)"""
    goods = 0.0
    tax = 0.0
    for it in items:
        q = float(it.quantity or 0)
        p = float(it.price or 0)
        r = float(it.tax_rate or 0)
        gross = q * p
        goods += gross
        if r > -100:
            tax += gross - gross / (1 + r / 100)
    freight = float(freight or 0)
    return round(goods, 2), round(tax, 2), round(goods + freight, 2)


def run(apply: bool, force: bool):
    if MARKER.exists() and apply and not force:
        print(f"检测到已完成标记：{MARKER}")
        print("如确需再次执行，请加 --force")
        return

    db = SessionLocal()
    try:
        total_changed = 0

        for model, label in ((PurchaseOrder, "采购单"), (SalesOrder, "销售单")):
            orders = db.query(model).all()
            changed = 0
            for o in orders:
                goods, tax, total = calc(o.items, o.freight)

                old_tax = float(o.tax_amount or 0)
                old_total = float(o.total_amount or 0)

                if abs(old_tax - tax) < 0.005 and abs(old_total - total) < 0.005:
                    continue

                if apply:
                    o.tax_amount = tax
                    o.total_amount = total
                changed += 1

            total_changed += changed
            print(f"  {label:<8} 共 {len(orders):>4} 单，需修正 {changed} 单")

        if apply:
            db.commit()
            MARKER.write_text("tax recomputed as 价内税\n", encoding="utf-8")
            print(f"\n已完成，共修正 {total_changed} 单")
        else:
            print(f"\n预览：共 {total_changed} 单待修正。确认后加 --apply 执行。")
    except Exception as e:
        db.rollback()
        print(f"失败：{type(e).__name__}: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run("--apply" in sys.argv, "--force" in sys.argv)
