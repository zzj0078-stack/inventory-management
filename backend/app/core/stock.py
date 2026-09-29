"""库存变动公共逻辑"""
from fastapi import HTTPException
from ..models.inventory import Inventory, Warehouse
from ..models.finance import StockLog


def default_warehouse_id(db) -> int:
    """取启用的第一个仓库；无则创建默认仓库。"""
    wh = db.query(Warehouse).filter(Warehouse.status == 1).order_by(Warehouse.id).first()
    if not wh:
        wh = db.query(Warehouse).order_by(Warehouse.id).first()
    if not wh:
        wh = Warehouse(name="默认仓库", address="总部", status=1)
        db.add(wh)
        db.flush()
    return wh.id


def apply_stock(db, product_id, warehouse_id, delta, type_,
                related_type="", related_id=None, related_no="", remark=""):
    """增减库存并写流水。delta 正入负出。返回变动后数量。"""
    if not warehouse_id:
        warehouse_id = default_warehouse_id(db)
    inv = db.query(Inventory).filter(
        Inventory.product_id == product_id,
        Inventory.warehouse_id == warehouse_id
    ).first()
    before = inv.quantity if inv else 0
    after = before + delta
    if after < 0:
        raise HTTPException(400, f"商品#{product_id} 库存不足（现有 {before}）")
    if inv:
        inv.quantity = after
    else:
        db.add(Inventory(product_id=product_id, warehouse_id=warehouse_id, quantity=after))
    db.add(StockLog(
        product_id=product_id, warehouse_id=warehouse_id, type=type_,
        quantity=delta, before_quantity=before, after_quantity=after,
        related_type=related_type, related_id=related_id,
        related_no=related_no, remark=remark
    ))
    return after
