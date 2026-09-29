from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from ..database import get_db
from ..models.inventory import Inventory, Warehouse
from ..models.product import Product
from ..models.user import User
from ..schemas.inventory import InventoryResponse, WarehouseCreate, WarehouseResponse
from ..schemas.common import ResponseModel, PaginatedResponse
from ..api.deps import get_current_user
from ..core.oplog import log_op

router = APIRouter()


# ==================== 仓库 ====================

@router.get("/warehouses", response_model=list[WarehouseResponse])
async def get_warehouses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ws = db.query(Warehouse).filter(Warehouse.status == 1).order_by(Warehouse.id).all()
    return [WarehouseResponse.from_orm(w) for w in ws]


@router.post("/warehouses", response_model=WarehouseResponse)
async def create_warehouse(
    warehouse_data: WarehouseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if db.query(Warehouse).filter(Warehouse.name == warehouse_data.name).first():
        raise HTTPException(status_code=400, detail="仓库名称已存在")
    warehouse = Warehouse(**warehouse_data.dict())
    db.add(warehouse)
    log_op(db, current_user, "库存管理", "新增仓库", warehouse_data.name)
    db.commit()
    db.refresh(warehouse)
    return WarehouseResponse.from_orm(warehouse)


@router.put("/warehouses/{wid}", response_model=WarehouseResponse)
async def update_warehouse(
    wid: int,
    warehouse_data: WarehouseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    warehouse = db.query(Warehouse).filter(Warehouse.id == wid).first()
    if not warehouse:
        raise HTTPException(status_code=404, detail="仓库不存在")

    dup = db.query(Warehouse).filter(Warehouse.name == warehouse_data.name, Warehouse.id != wid).first()
    if dup:
        raise HTTPException(status_code=400, detail="仓库名称已存在")

    for k, v in warehouse_data.dict(exclude_unset=True).items():
        setattr(warehouse, k, v)

    log_op(db, current_user, "库存管理", "编辑仓库", warehouse.name)
    db.commit()
    db.refresh(warehouse)
    return WarehouseResponse.from_orm(warehouse)


@router.delete("/warehouses/{wid}")
async def delete_warehouse(
    wid: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    warehouse = db.query(Warehouse).filter(Warehouse.id == wid).first()
    if not warehouse:
        raise HTTPException(status_code=404, detail="仓库不存在")

    total = db.query(Warehouse).count()
    if total <= 1:
        raise HTTPException(status_code=400, detail="至少保留一个仓库，否则无法入库/出库")

    used = db.query(Inventory).filter(
        Inventory.warehouse_id == wid, Inventory.quantity != 0
    ).count()
    if used > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该仓库仍有 {used} 个商品存在库存，请先调拨或清零后再删除"
        )

    name = warehouse.name
    db.query(Inventory).filter(Inventory.warehouse_id == wid).delete()
    db.delete(warehouse)
    log_op(db, current_user, "库存管理", "删除仓库", name)
    db.commit()
    return ResponseModel(message="删除成功")


# ==================== 库存 ====================

@router.get("", response_model=PaginatedResponse)
async def get_inventory(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=1000),
    keyword: Optional[str] = None,
    warehouse_id: Optional[int] = None,
    low_stock: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Inventory).join(Product)

    if keyword:
        query = query.filter(
            (Product.name.contains(keyword)) |
            (Product.sku.contains(keyword))
        )
    if warehouse_id:
        query = query.filter(Inventory.warehouse_id == warehouse_id)
    if low_stock:
        query = query.filter(Inventory.quantity <= Product.min_stock)

    total = query.count()
    items = query.order_by(Inventory.id).offset((page - 1) * page_size).limit(page_size).all()

    result = []
    for item in items:
        result.append(InventoryResponse(
            id=item.id,
            product_id=item.product_id,
            warehouse_id=item.warehouse_id,
            quantity=item.quantity,
            updated_at=item.updated_at,
            product_name=item.product.name,
            product_sku=item.product.sku,
            warehouse_name=item.warehouse.name,
            min_stock=item.product.min_stock
        ))

    return PaginatedResponse(total=total, page=page, page_size=page_size, items=result)


@router.get("/stock-check")
async def stock_check(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """库存预警：现有库存 <= 最低库存"""
    from sqlalchemy import and_
    rows = db.query(Inventory, Product, Warehouse).join(
        Product, Inventory.product_id == Product.id
    ).join(
        Warehouse, Inventory.warehouse_id == Warehouse.id
    ).filter(
        and_(Product.status == 1, Inventory.quantity <= Product.min_stock)
    ).all()

    data = [{
        "product_id": p.id,
        "product_name": p.name,
        "product_sku": p.sku,
        "warehouse_id": w.id,
        "warehouse_name": w.name,
        "current_stock": inv.quantity,
        "min_stock": p.min_stock,
        "deficit": p.min_stock - inv.quantity,
    } for inv, p, w in rows]

    return ResponseModel(data=data)
