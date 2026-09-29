from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func
from typing import Optional
from ..database import get_db
from ..models.supplier import Supplier
from ..models.user import User
from ..models.purchase import PurchaseOrder
from ..models.returns import PurchaseReturn
from ..models.finance import Payment
from ..schemas.supplier import SupplierCreate, SupplierUpdate, SupplierResponse
from ..schemas.common import ResponseModel, PaginatedResponse
from ..api.deps import get_current_user
from ..core.oplog import log_op

router = APIRouter()


def calc_outstanding(db, supplier_id: int):
    """供应商应付 = 已审核/已收货采购 − 付供应商货款 − 收供应商退款 − 已审核退货"""
    total = db.query(sql_func.coalesce(sql_func.sum(PurchaseOrder.total_amount), 0)).filter(
        PurchaseOrder.supplier_id == supplier_id,
        PurchaseOrder.status.in_([1, 2, 3, 5, 6])
    ).scalar()

    # 付款（我们付给供应商）
    paid = db.query(sql_func.coalesce(sql_func.sum(Payment.amount), 0)).filter(
        Payment.type == 2,
        Payment.partner_type == "supplier",
        Payment.partner_id == supplier_id
    ).scalar()

    # 供应商退款给我们
    refunded = db.query(sql_func.coalesce(sql_func.sum(Payment.amount), 0)).filter(
        Payment.type == 1,
        Payment.partner_type == "supplier",
        Payment.partner_id == supplier_id
    ).scalar()

    returned = db.query(sql_func.coalesce(sql_func.sum(PurchaseReturn.total_amount), 0)).filter(
        PurchaseReturn.supplier_id == supplier_id,
        PurchaseReturn.status.in_([1, 2])      # 已审核 / 已出库，不含作废
    ).scalar()

    order_count = db.query(PurchaseOrder).filter(
        PurchaseOrder.supplier_id == supplier_id,
        PurchaseOrder.status.in_([1, 2, 3, 5, 6])
    ).count()

    # 符号：我们付款减少应付；供应商退款给我们则让应付回升
    return float(total) - float(paid) + float(refunded) - float(returned), order_count


@router.get("", response_model=PaginatedResponse)
async def get_suppliers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=1000),
    keyword: Optional[str] = None,
    status: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Supplier)

    if keyword:
        query = query.filter(
            (Supplier.name.contains(keyword)) |
            (Supplier.contact.contains(keyword)) |
            (Supplier.phone.contains(keyword))
        )
    if status is not None:
        query = query.filter(Supplier.status == status)

    total = query.count()
    items = query.order_by(Supplier.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return PaginatedResponse(
        total=total, page=page, page_size=page_size,
        items=[SupplierResponse.from_orm(i) for i in items]
    )


@router.get("/{supplier_id}/outstanding")
async def get_supplier_outstanding(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """查询供应商欠款情况，删除前校验用"""
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")
    amount, order_count = calc_outstanding(db, supplier_id)
    return {
        "supplier_id": supplier_id,
        "supplier_name": supplier.name,
        "amount": round(amount, 2),          # 通用字段：正=欠款，负=预付/应收回
        "payable": round(amount, 2),
        "order_count": order_count,
        "has_debt": amount > 0,
        "is_prepaid": amount < 0,
    }


@router.post("", response_model=SupplierResponse)
async def create_supplier(
    supplier_data: SupplierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if db.query(Supplier).filter(Supplier.name == supplier_data.name).first():
        raise HTTPException(status_code=400, detail="供应商名称已存在")

    supplier = Supplier(**supplier_data.dict())
    db.add(supplier)
    log_op(db, current_user, "供应商管理", "新增供应商", supplier_data.name)
    db.commit()
    db.refresh(supplier)
    return SupplierResponse.from_orm(supplier)


@router.get("/{supplier_id}", response_model=SupplierResponse)
async def get_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")
    return SupplierResponse.from_orm(supplier)


@router.put("/{supplier_id}", response_model=SupplierResponse)
async def update_supplier(
    supplier_id: int,
    supplier_data: SupplierUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")

    update_data = supplier_data.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(supplier, key, value)

    log_op(db, current_user, "供应商管理", "编辑供应商", supplier.name)
    db.commit()
    db.refresh(supplier)
    return SupplierResponse.from_orm(supplier)


@router.delete("/{supplier_id}")
async def delete_supplier(
    supplier_id: int,
    force: bool = Query(False, description="跳过欠款校验（仅管理员使用）"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")

    amount, order_count = calc_outstanding(db, supplier_id)
    if amount > 0 and not force:
        raise HTTPException(
            status_code=400,
            detail=f"该供应商存在未结清应付款 ¥{amount:.2f}（关联 {order_count} 张采购单），"
                   f"请先完成付款或作废相关单据后再删除"
        )

    # 引用检查：不允许留下孤儿单据
    total_orders = db.query(PurchaseOrder).filter(PurchaseOrder.supplier_id == supplier_id).count()
    if total_orders > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该供应商已被 {total_orders} 张采购单引用，删除会导致历史单据失去往来单位。"
                   f"请改用「禁用」状态。"
        )

    from ..models.returns import PurchaseReturn
    total_returns = db.query(PurchaseReturn).filter(PurchaseReturn.supplier_id == supplier_id).count()
    if total_returns > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该供应商已被 {total_returns} 张采购退货单引用，无法删除。请改用「禁用」状态。"
        )

    name = supplier.name
    db.delete(supplier)
    log_op(db, current_user, "供应商管理", "删除供应商", name,
           f"应付款:¥{amount:.2f}" + ("(强制删除)" if force else ""))
    db.commit()
    return ResponseModel(message="删除成功")
