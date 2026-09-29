from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional
from datetime import datetime, date
from ..database import get_db
from ..models.sales import (
    SalesOrder, SalesItem,
    STATUS_DRAFT, STATUS_APPROVED, STATUS_PARTIAL, STATUS_SHIPPED, STATUS_CLOSED,
    STATUS_TEXT as STATUS_MAP,
)
from ..models.inventory import Warehouse
from ..models.customer import Customer
from ..models.product import Product
from ..models.user import User
from ..schemas.sales import (
    SalesOrderCreate, SalesOrderResponse, SalesShipRequest,
)
from ..schemas.common import ResponseModel, PaginatedResponse
from ..api.deps import get_current_user
from ..core.oplog import log_op
from ..core.stock import apply_stock, default_warehouse_id

router = APIRouter()

STATUS_TEXT = [STATUS_MAP[i] for i in sorted(STATUS_MAP)]   # [草稿, 已审核, 部分发货, 已发货, 已关闭]


def calc_amounts(items, freight=0):
    """价内税口径：单价已含税

        金额小计   = 数量 × 单价（含税）
        内含税额   = Σ(小计 − 小计 / (1 + 税率/100))
        整单合计   = Σ小计 + 运费
    """
    def _get(it, key, default=0):
        v = it.get(key, default) if isinstance(it, dict) else getattr(it, key, default)
        return v if v is not None else default

    goods = 0.0
    tax = 0.0
    for it in items:
        q = float(_get(it, "quantity") or 0)
        p = float(_get(it, "price") or 0)
        r = float(_get(it, "tax_rate") or 0)
        gross = q * p
        goods += gross
        if r > -100:
            tax += gross - gross / (1 + r / 100)
    freight = float(freight or 0)
    return round(goods, 2), round(tax, 2), round(goods + freight, 2)


def generate_order_no(db: Session) -> str:
    today = datetime.now().strftime("%Y%m%d")
    prefix = f"SO{today}"
    last = db.query(SalesOrder).filter(
        SalesOrder.order_no.like(f"{prefix}%")
    ).order_by(SalesOrder.id.desc()).first()
    seq = int(last.order_no[-4:]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


def _decorate(db, order):
    d = SalesOrderResponse.from_orm(order)
    d.status_text = STATUS_MAP.get(order.status, "")

    if order.customer_id:
        cust = db.query(Customer).filter(Customer.id == order.customer_id).first()
        if cust:
            d.customer_name = cust.name
            d.customer_contact = cust.contact
            d.customer_phone = cust.phone
        else:
            d.customer_name = f"⚠ 客户#{order.customer_id} 已不存在"
    else:
        d.customer_name = "（未指定客户）"

    # 发货仓库
    if order.warehouse_id:
        wh = db.query(Warehouse).filter(Warehouse.id == order.warehouse_id).first()
        d.warehouse_name = wh.name if wh else f"⚠ 仓库#{order.warehouse_id} 已删除"
    else:
        d.warehouse_name = ""

    # 销售员：手填优先，否则取创建人
    if order.seller:
        d.creator_name = order.seller
    elif order.created_by:
        u = db.query(User).filter(User.id == order.created_by).first()
        d.creator_name = (u.full_name or u.username) if u else ""
    else:
        d.creator_name = ""

    # 明细商品信息（一次查询，避免 N+1）
    pids = [i.product_id for i in order.items if i.product_id]
    if pids:
        prods = {p.id: p for p in db.query(Product).filter(Product.id.in_(pids)).all()}
        for item in d.items:
            p = prods.get(item.product_id)
            if p:
                item.product_name = p.name
                item.product_spec = p.spec
                item.product_unit = p.unit
                item.product_sku = p.sku
            else:
                item.product_name = f"⚠ 商品#{item.product_id} 已删除"
            item.pending_quantity = max((item.quantity or 0) - (item.shipped_quantity or 0), 0)

    return d


@router.get("", response_model=PaginatedResponse)
async def get_sales_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: Optional[str] = Query(None, description="单号/客户/联系人/电话/备注/地址/发票号"),
    customer_name: Optional[str] = None,
    contact: Optional[str] = None,
    phone: Optional[str] = None,
    address: Optional[str] = None,
    remark: Optional[str] = None,
    status: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 客户可能已被删除，用 outerjoin 保留单据
    query = db.query(SalesOrder).outerjoin(
        Customer, SalesOrder.customer_id == Customer.id
    )

    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(
            SalesOrder.order_no.like(like),
            SalesOrder.remark.like(like),
            SalesOrder.delivery_address.like(like),
            SalesOrder.invoice_no.like(like),
            Customer.name.like(like),
            Customer.contact.like(like),
            Customer.phone.like(like),
            Customer.address.like(like),
        ))

    if customer_name:
        query = query.filter(Customer.name.like(f"%{customer_name}%"))
    if contact:
        query = query.filter(Customer.contact.like(f"%{contact}%"))
    if phone:
        query = query.filter(Customer.phone.like(f"%{phone}%"))
    if address:
        query = query.filter(or_(
            SalesOrder.delivery_address.like(f"%{address}%"),
            Customer.address.like(f"%{address}%"),
        ))
    if remark:
        query = query.filter(SalesOrder.remark.like(f"%{remark}%"))

    if status is not None:
        query = query.filter(SalesOrder.status == status)
    if status is not None:
        query = query.filter(SalesOrder.status == status)
    if start_date:
        query = query.filter(SalesOrder.created_at >= start_date)
    if end_date:
        query = query.filter(SalesOrder.created_at <= end_date)

    total = query.count()
    orders = query.order_by(SalesOrder.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    decorated = [_decorate(db, o) for o in orders]
    _attach_spec_summary(db, orders, decorated)
    return PaginatedResponse(total=total, page=page, page_size=page_size, items=decorated)


@router.post("", response_model=SalesOrderResponse)
async def create_sales_order(
    order_data: SalesOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not order_data.items:
        raise HTTPException(400, "销售明细不能为空")

    order_no = generate_order_no(db)

    # 价内税：单价已含税，税额从明细中拆出，整单合计 = 明细 + 运费
    goods_amount, tax, total_amount = calc_amounts(order_data.items, order_data.freight)

    # 仓库：未指定则用默认仓库
    wid = order_data.warehouse_id or default_warehouse_id(db)
    if not db.query(Warehouse).filter(Warehouse.id == wid).first():
        raise HTTPException(400, f"仓库不存在：{wid}")

    order = SalesOrder(
        order_no=order_no,
        customer_id=order_data.customer_id,
        sale_date=order_data.sale_date or date.today(),
        warehouse_id=wid,
        seller=order_data.seller,
        delivery_date=order_data.delivery_date,
        payment_method=order_data.payment_method,
        payment_terms=order_data.payment_terms,
        currency=order_data.currency or "CNY",
        exchange_rate=order_data.exchange_rate or 1,
        tax_amount=tax,
        freight=order_data.freight or 0,
        total_amount=total_amount,
        status=STATUS_DRAFT,
        created_by=current_user.id,
        remark=order_data.remark,
        delivery_address=order_data.delivery_address,
        invoice_no=order_data.invoice_no,
    )
    db.add(order)
    db.flush()

    for item_data in order_data.items:
        if item_data.quantity <= 0:
            raise HTTPException(400, "数量必须大于 0")
        db.add(SalesItem(
            order_id=order.id,
            product_id=item_data.product_id,
            quantity=item_data.quantity,
            price=item_data.price,
            tax_rate=item_data.tax_rate or 0,
            amount=item_data.quantity * item_data.price,
            remark=item_data.remark,
        ))

    log_op(db, current_user, "销售管理", "新增销售单", order_no,
           f"金额:{total_amount} 仓库#{wid}")
    db.commit()
    db.refresh(order)
    return _decorate(db, order)


def _attach_spec_summary(db, orders, decorated):
    """给列表行填充明细的商品名称 / 规格型号摘要（一次查询，避免 N+1）"""
    if not orders:
        return

    oids = [o.id for o in orders]
    items = db.query(SalesItem).filter(SalesItem.order_id.in_(oids)).all()

    pids = {i.product_id for i in items if i.product_id}
    specs = {}
    names = {}
    if pids:
        for pid, name, spec in db.query(Product.id, Product.name, Product.spec).filter(Product.id.in_(pids)).all():
            names[pid] = name
            specs[pid] = spec

    name_by_order = {}
    spec_by_order = {}
    for it in items:
        nm = names.get(it.product_id)
        if nm:
            name_by_order.setdefault(it.order_id, []).append(nm)
        sp = specs.get(it.product_id)
        if sp:
            spec_by_order.setdefault(it.order_id, []).append(sp)

    def summarize(labels):
        if not labels:
            return ""
        if len(labels) == 1:
            return labels[0]
        return f"{labels[0]} 等{len(labels)}项"

    for order, d in zip(orders, decorated):
        names_list = name_by_order.get(order.id, [])
        d.item_count = len(names_list)
        d.product_summary = summarize(names_list)
        d.spec_summary = summarize(spec_by_order.get(order.id, []))


@router.get("/{order_id}", response_model=SalesOrderResponse)
async def get_sales_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="销售单不存在")
    return _decorate(db, order)


@router.put("/{order_id}/approve")
async def approve_sales_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="销售单不存在")
    if order.status != STATUS_DRAFT:
        raise HTTPException(status_code=400, detail="仅「草稿」状态的销售单可以审核")

    order.status = STATUS_APPROVED
    order.approve_by = current_user.id
    order.approve_at = datetime.now()
    log_op(db, current_user, "销售管理", "审核销售单", order.order_no)

    db.commit()
    return ResponseModel(message="审核成功")


@router.put("/{order_id}/ship")
async def ship_sales_order(
    order_id: int,
    payload: SalesShipRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """分批发货：按明细行累加 shipped_quantity，未发齐为「部分发货」"""
    order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="销售单不存在")
    if order.status not in (STATUS_APPROVED, STATUS_PARTIAL):
        raise HTTPException(status_code=400, detail="仅「已审核」或「部分发货」的单据可以发货")
    if not payload.items:
        raise HTTPException(status_code=400, detail="请填写本次发货数量")

    wid = payload.warehouse_id or order.warehouse_id or default_warehouse_id(db)
    if not db.query(Warehouse).filter(Warehouse.id == wid).first():
        raise HTTPException(status_code=400, detail=f"仓库不存在：{wid}")

    by_id = {i.id: i for i in order.items}
    total_now = 0

    for req in payload.items:
        if req.quantity <= 0:
            continue
        item = by_id.get(req.item_id)
        if not item:
            raise HTTPException(status_code=400, detail=f"明细行不存在：#{req.item_id}")

        pending = (item.quantity or 0) - (item.shipped_quantity or 0)
        if pending <= 0:
            raise HTTPException(status_code=400,
                                detail=f"该明细已发货完毕（商品#{item.product_id}）")
        if req.quantity > pending:
            raise HTTPException(
                status_code=400,
                detail=f"本次发货 {req.quantity} 超过待发数量 {pending}（商品#{item.product_id}）"
            )

        # 库存不足时 apply_stock 会抛 400
        apply_stock(db, item.product_id, wid, -req.quantity, "sale_out",
                    "sale", order.id, order.order_no,
                    f"分批发货 {item.shipped_quantity + req.quantity}/{item.quantity}")
        item.shipped_quantity = (item.shipped_quantity or 0) + req.quantity
        total_now += req.quantity

    if total_now == 0:
        raise HTTPException(status_code=400, detail="本次发货数量为 0，无需出库")

    all_done = all((i.shipped_quantity or 0) >= (i.quantity or 0) for i in order.items)
    order.status = STATUS_SHIPPED if all_done else STATUS_PARTIAL

    log_op(db, current_user, "销售管理",
           "销售发货完成" if all_done else "销售发货",
           order.order_no, f"本次出库 {total_now}，状态 {STATUS_MAP[order.status]}")

    db.commit()
    return ResponseModel(
        message=f"本次出库 {total_now}，当前状态：{STATUS_MAP[order.status]}"
    )


@router.put("/{order_id}/cancel")
async def cancel_sales_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="销售单不存在")
    if order.status not in (STATUS_DRAFT, STATUS_APPROVED):
        raise HTTPException(status_code=400, detail="已发货或已关闭的销售单不能作废")

    order.status = STATUS_CLOSED
    log_op(db, current_user, "销售管理", "作废销售单", order.order_no)

    db.commit()
    return ResponseModel(message="作废成功")


@router.put("/{order_id}", response_model=SalesOrderResponse)
async def update_sales_order(
    order_id: int,
    order_data: SalesOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """编辑销售单：仅草稿状态可改，明细整体替换"""
    order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="销售单不存在")
    if order.status != STATUS_DRAFT:
        raise HTTPException(status_code=400, detail="仅「草稿」状态的销售单可以编辑")
    if not order_data.items:
        raise HTTPException(status_code=400, detail="销售明细不能为空")

    pids = [i.product_id for i in order_data.items]
    found = {p.id for p in db.query(Product.id).filter(Product.id.in_(pids)).all()}
    missing = [p for p in pids if p not in found]
    if missing:
        raise HTTPException(status_code=400, detail=f"商品不存在：{missing}")

    if order_data.warehouse_id:
        if not db.query(Warehouse).filter(Warehouse.id == order_data.warehouse_id).first():
            raise HTTPException(status_code=400, detail=f"仓库不存在：{order_data.warehouse_id}")
        order.warehouse_id = order_data.warehouse_id

    # 价内税口径
    goods_amount, tax, total_amount = calc_amounts(order_data.items, order_data.freight)

    order.customer_id = order_data.customer_id
    order.sale_date = order_data.sale_date or order.sale_date or date.today()
    order.seller = order_data.seller
    order.delivery_date = order_data.delivery_date
    order.payment_method = order_data.payment_method
    order.payment_terms = order_data.payment_terms
    order.currency = order_data.currency or "CNY"
    order.exchange_rate = order_data.exchange_rate or 1
    order.tax_amount = tax
    order.freight = order_data.freight or 0
    order.total_amount = total_amount
    order.remark = order_data.remark
    order.delivery_address = order_data.delivery_address
    order.invoice_no = order_data.invoice_no

    db.query(SalesItem).filter(SalesItem.order_id == order.id).delete()
    for item_data in order_data.items:
        if item_data.quantity <= 0:
            raise HTTPException(status_code=400, detail="数量必须大于 0")
        db.add(SalesItem(
            order_id=order.id,
            product_id=item_data.product_id,
            quantity=item_data.quantity,
            price=item_data.price,
            tax_rate=item_data.tax_rate or 0,
            amount=item_data.quantity * item_data.price,
            remark=item_data.remark,
        ))

    log_op(db, current_user, "销售管理", "编辑销售单", order.order_no)
    db.commit()
    db.refresh(order)
    return _decorate(db, order)


@router.delete("/{order_id}")
async def delete_sales_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除销售单：仅草稿或已关闭可删；已审核/发货中的单据请先作废"""
    order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="销售单不存在")
    if order.status not in (STATUS_DRAFT, STATUS_CLOSED):
        raise HTTPException(
            status_code=400,
            detail="已审核或已发货的销售单不能删除，请先作废"
        )

    no = order.order_no
    db.query(SalesItem).filter(SalesItem.order_id == order.id).delete()
    db.delete(order)
    log_op(db, current_user, "销售管理", "删除销售单", no)
    db.commit()
    return ResponseModel(message="删除成功")
