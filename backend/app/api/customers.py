from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func
from typing import Optional
from ..database import get_db
from ..models.customer import Customer
from ..models.user import User
from ..models.sales import SalesOrder
from ..models.returns import SaleReturn
from ..models.finance import Payment
from ..schemas.customer import CustomerCreate, CustomerUpdate, CustomerResponse
from ..schemas.common import ResponseModel, PaginatedResponse
from ..api.deps import get_current_user
from ..core.oplog import log_op

router = APIRouter()


def calc_outstanding(db, customer_id: int):
    """客户应收 = 已审核/已发货销售 − 收客户货款 − 退款给客户 − 已审核退货"""
    total = db.query(sql_func.coalesce(sql_func.sum(SalesOrder.total_amount), 0)).filter(
        SalesOrder.customer_id == customer_id,
        SalesOrder.status.in_([1, 2, 3, 5, 6])
    ).scalar()

    # 收款（客户付给我们）
    received = db.query(sql_func.coalesce(sql_func.sum(Payment.amount), 0)).filter(
        Payment.type == 1,
        Payment.partner_type == "customer",
        Payment.partner_id == customer_id
    ).scalar()

    # 退款给客户（我们付给客户）
    refunded = db.query(sql_func.coalesce(sql_func.sum(Payment.amount), 0)).filter(
        Payment.type == 2,
        Payment.partner_type == "customer",
        Payment.partner_id == customer_id
    ).scalar()

    returned = db.query(sql_func.coalesce(sql_func.sum(SaleReturn.total_amount), 0)).filter(
        SaleReturn.customer_id == customer_id,
        SaleReturn.status.in_([1, 2])          # 已审核 / 已入库，不含作废
    ).scalar()

    order_count = db.query(SalesOrder).filter(
        SalesOrder.customer_id == customer_id,
        SalesOrder.status.in_([1, 2, 3, 5, 6])
    ).count()

    # 符号：客户付款减少应收；我们退款给客户则让应收回升（把多收的钱还回去）
    return float(total) - float(received) + float(refunded) - float(returned), order_count


@router.get("", response_model=PaginatedResponse)
async def get_customers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=1000),
    keyword: Optional[str] = None,
    status: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Customer)

    if keyword:
        query = query.filter(
            (Customer.name.contains(keyword)) |
            (Customer.contact.contains(keyword)) |
            (Customer.phone.contains(keyword))
        )
    if status is not None:
        query = query.filter(Customer.status == status)

    total = query.count()
    items = query.order_by(Customer.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return PaginatedResponse(
        total=total, page=page, page_size=page_size,
        items=[CustomerResponse.from_orm(i) for i in items]
    )


@router.get("/{customer_id}/outstanding")
async def get_customer_outstanding(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """查询客户欠款情况，删除前校验用"""
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="客户不存在")
    amount, order_count = calc_outstanding(db, customer_id)
    return {
        "customer_id": customer_id,
        "customer_name": customer.name,
        "amount": round(amount, 2),          # 通用字段：正=欠款，负=预收/应退
        "receivable": round(amount, 2),
        "order_count": order_count,
        "has_debt": amount > 0,
        "is_prepaid": amount < 0,
    }


@router.post("", response_model=CustomerResponse)
async def create_customer(
    customer_data: CustomerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if db.query(Customer).filter(Customer.name == customer_data.name).first():
        raise HTTPException(status_code=400, detail="客户名称已存在")

    customer = Customer(**customer_data.dict())
    db.add(customer)
    log_op(db, current_user, "客户管理", "新增客户", customer_data.name)
    db.commit()
    db.refresh(customer)
    return CustomerResponse.from_orm(customer)


@router.get("/{customer_id}", response_model=CustomerResponse)
async def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="客户不存在")
    return CustomerResponse.from_orm(customer)


@router.put("/{customer_id}", response_model=CustomerResponse)
async def update_customer(
    customer_id: int,
    customer_data: CustomerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="客户不存在")

    update_data = customer_data.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(customer, key, value)

    log_op(db, current_user, "客户管理", "编辑客户", customer.name)
    db.commit()
    db.refresh(customer)
    return CustomerResponse.from_orm(customer)


@router.delete("/{customer_id}")
async def delete_customer(
    customer_id: int,
    force: bool = Query(False, description="跳过欠款校验（仅管理员使用）"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="客户不存在")

    amount, order_count = calc_outstanding(db, customer_id)
    if amount > 0 and not force:
        raise HTTPException(
            status_code=400,
            detail=f"该客户存在未结清应收款 ¥{amount:.2f}（关联 {order_count} 张销售单），"
                   f"请先完成收款或作废相关单据后再删除"
        )

    # 引用检查：任何销售单/销售退货单都不允许留下孤儿
    total_orders = db.query(SalesOrder).filter(SalesOrder.customer_id == customer_id).count()
    if total_orders > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该客户已被 {total_orders} 张销售单引用，删除会导致历史单据失去往来单位。"
                   f"请改用「禁用」状态。"
        )

    from ..models.returns import SaleReturn
    total_returns = db.query(SaleReturn).filter(SaleReturn.customer_id == customer_id).count()
    if total_returns > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该客户已被 {total_returns} 张销售退货单引用，无法删除。请改用「禁用」状态。"
        )

    name = customer.name
    db.delete(customer)
    log_op(db, current_user, "客户管理", "删除客户", name,
           f"应收款:¥{amount:.2f}" + ("(强制删除)" if force else ""))
    db.commit()
    return ResponseModel(message="删除成功")
