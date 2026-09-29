from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional
from datetime import datetime, date
from ..database import get_db
from ..models.purchase import (
    PurchaseOrder, PurchaseItem,
    STATUS_DRAFT, STATUS_APPROVED, STATUS_PARTIAL, STATUS_RECEIVED, STATUS_CLOSED,
    STATUS_TEXT as STATUS_MAP,
)
from ..models.inventory import Warehouse
from ..models.supplier import Supplier
from ..models.product import Product
from ..models.user import User
from ..schemas.purchase import (
    PurchaseOrderCreate, PurchaseOrderResponse, PurchaseReceiveRequest,
)
from ..schemas.common import ResponseModel, PaginatedResponse
from ..api.deps import get_current_user
from ..core.oplog import log_op
from ..core.stock import apply_stock, default_warehouse_id

router = APIRouter()

STATUS_TEXT = [STATUS_MAP[i] for i in sorted(STATUS_MAP)]   # [草稿, 已审核, 部分收货, 已收货, 已关闭]


def calc_amounts(items, freight=0):
    """价内税口径：单价已含税

        金额小计   = 数量 × 单价（含税）
        内含税额   = Σ(小计 − 小计 / (1 + 税率/100))
        整单合计   = Σ小计 + 运费

    items 需含 quantity / price / tax_rate 属性或键
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
    prefix = f"PO{today}"
    last = db.query(PurchaseOrder).filter(
        PurchaseOrder.order_no.like(f"{prefix}%")
    ).order_by(PurchaseOrder.id.desc()).first()
    seq = int(last.order_no[-4:]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


def _decorate(db, order):
    d = PurchaseOrderResponse.from_orm(order)
    d.status_text = STATUS_MAP.get(order.status, "")

    # 供应商
    if order.supplier_id:
        sup = db.query(Supplier).filter(Supplier.id == order.supplier_id).first()
        if sup:
            d.supplier_name = sup.name
            d.supplier_contact = sup.contact
            d.supplier_phone = sup.phone
        else:
            d.supplier_name = f"⚠ 供应商#{order.supplier_id} 已不存在"
    else:
        d.supplier_name = "（未指定供应商）"

    # 收货仓库
    if order.warehouse_id:
        wh = db.query(Warehouse).filter(Warehouse.id == order.warehouse_id).first()
        d.warehouse_name = wh.name if wh else f"⚠ 仓库#{order.warehouse_id} 已删除"
    else:
        d.warehouse_name = ""

    # 采购员（取 creator 姓名兜底 buyer 手填值）
    if order.buyer:
        d.creator_name = order.buyer
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
            item.pending_quantity = max((item.quantity or 0) - (item.received_quantity or 0), 0)

    return d


@router.get("", response_model=PaginatedResponse)
async def get_purchase_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: Optional[str] = Query(None, description="单号/供应商/联系人/电话/备注/地址/发票号"),
    supplier_name: Optional[str] = None,
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
    # 供应商可能已被删除，用 outerjoin 保留单据
    query = db.query(PurchaseOrder).outerjoin(
        Supplier, PurchaseOrder.supplier_id == Supplier.id
    )

    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(
            PurchaseOrder.order_no.like(like),
            PurchaseOrder.remark.like(like),
            PurchaseOrder.delivery_address.like(like),
            PurchaseOrder.invoice_no.like(like),
            Supplier.name.like(like),
            Supplier.contact.like(like),
            Supplier.phone.like(like),
            Supplier.address.like(like),
        ))

    if supplier_name:
        query = query.filter(Supplier.name.like(f"%{supplier_name}%"))
    if contact:
        query = query.filter(Supplier.contact.like(f"%{contact}%"))
    if phone:
        query = query.filter(Supplier.phone.like(f"%{phone}%"))
    if address:
        query = query.filter(or_(
            PurchaseOrder.delivery_address.like(f"%{address}%"),
            Supplier.address.like(f"%{address}%"),
        ))
    if remark:
        query = query.filter(PurchaseOrder.remark.like(f"%{remark}%"))

    if status is not None:
        query = query.filter(PurchaseOrder.status == status)
    if start_date:
        query = query.filter(PurchaseOrder.created_at >= start_date)
    if end_date:
        query = query.filter(PurchaseOrder.created_at <= end_date)

    total = query.count()
    orders = query.order_by(PurchaseOrder.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    decorated = [_decorate(db, o) for o in orders]
    _attach_spec_summary(db, orders, decorated)
    return PaginatedResponse(total=total, page=page, page_size=page_size, items=decorated)


@router.post("", response_model=PurchaseOrderResponse)
async def create_purchase_order(
    order_data: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not order_data.items:
        raise HTTPException(400, "采购明细不能为空")

    order_no = generate_order_no(db)

    # 价内税：单价已含税，税额从明细中拆出，整单合计 = 明细 + 运费
    goods_amount, tax, total_amount = calc_amounts(order_data.items, order_data.freight)

    # 仓库：未指定则用默认仓库
    wid = order_data.warehouse_id or default_warehouse_id(db)
    if not db.query(Warehouse).filter(Warehouse.id == wid).first():
        raise HTTPException(400, f"仓库不存在：{wid}")

    order = PurchaseOrder(
        order_no=order_no,
        supplier_id=order_data.supplier_id,
        purchase_date=order_data.purchase_date or date.today(),
        warehouse_id=wid,
        buyer=order_data.buyer,
        expected_date=order_data.expected_date,
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
        db.add(PurchaseItem(
            order_id=order.id,
            product_id=item_data.product_id,
            quantity=item_data.quantity,
            price=item_data.price,
            tax_rate=item_data.tax_rate or 0,
            amount=item_data.quantity * item_data.price,
            remark=item_data.remark,
        ))

    log_op(db, current_user, "采购管理", "新增采购单", order_no,
           f"金额:{total_amount} 仓库#{wid}")
    db.commit()
    db.refresh(order)
    return _decorate(db, order)


def _attach_spec_summary(db, orders, decorated):
    """给列表行填充明细的商品名称 / 规格型号摘要（一次查询，避免 N+1）"""
    if not orders:
        return

    oids = [o.id for o in orders]
    items = db.query(PurchaseItem).filter(PurchaseItem.order_id.in_(oids)).all()

    pids = {i.product_id for i in items if i.product_id}
    specs = {}
    names = {}
    if pids:
        for pid, name, spec in db.query(Product.id, Product.name, Product.spec).filter(Product.id.in_(pids)).all():
            names[pid] = name
            specs[pid] = spec

    # order_id -> [商品名称], order_id -> [规格]
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


@router.get("/{order_id}", response_model=PurchaseOrderResponse)
async def get_purchase_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    return _decorate(db, order)


@router.put("/{order_id}/approve")
async def approve_purchase_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    if order.status != 0:
        raise HTTPException(status_code=400, detail="订单状态不正确")

    order.status = STATUS_APPROVED
    order.approve_by = current_user.id
    order.approve_at = datetime.now()
    log_op(db, current_user, "采购管理", "审核采购单", order.order_no)

    db.commit()
    return ResponseModel(message="审核成功")


@router.put("/{order_id}/receive")
async def receive_purchase_order(
    order_id: int,
    payload: PurchaseReceiveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """分批收货：按明细行累加 received_quantity，未收齐为「部分收货」"""
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    if order.status not in (STATUS_APPROVED, STATUS_PARTIAL):
        raise HTTPException(status_code=400, detail="仅「已审核」或「部分收货」的单据可以收货")
    if not payload.items:
        raise HTTPException(status_code=400, detail="请填写本次收货数量")

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

        pending = (item.quantity or 0) - (item.received_quantity or 0)
        if pending <= 0:
            raise HTTPException(status_code=400,
                                detail=f"该明细已收货完毕，无法继续入库（商品#{item.product_id}）")
        if req.quantity > pending:
            raise HTTPException(
                status_code=400,
                detail=f"本次收货 {req.quantity} 超过待收数量 {pending}（商品#{item.product_id}）"
            )

        apply_stock(db, item.product_id, wid, req.quantity, "purchase_in",
                    "purchase", order.id, order.order_no,
                    f"分批收货 {item.received_quantity + req.quantity}/{item.quantity}")
        item.received_quantity = (item.received_quantity or 0) + req.quantity
        total_now += req.quantity

    if total_now == 0:
        raise HTTPException(status_code=400, detail="本次收货数量为 0，无需入库")

    # 全部收齐 -> 已收货，否则 -> 部分收货
    all_done = all((i.received_quantity or 0) >= (i.quantity or 0) for i in order.items)
    order.status = STATUS_RECEIVED if all_done else STATUS_PARTIAL

    log_op(db, current_user, "采购管理",
           "采购收货" if not all_done else "采购收货完成",
           order.order_no, f"本次入库 {total_now}，状态 {STATUS_MAP[order.status]}")

    db.commit()
    return ResponseModel(
        message=f"本次入库 {total_now}，当前状态：{STATUS_MAP[order.status]}"
    )


@router.put("/{order_id}/cancel")
async def cancel_purchase_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    if order.status not in (STATUS_DRAFT, STATUS_APPROVED):
        raise HTTPException(status_code=400, detail="已收货或已关闭的采购单不能作废")

    order.status = STATUS_CLOSED
    log_op(db, current_user, "采购管理", "作废采购单", order.order_no)

    db.commit()
    return ResponseModel(message="作废成功")


@router.put("/{order_id}", response_model=PurchaseOrderResponse)
async def update_purchase_order(
    order_id: int,
    order_data: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """编辑采购单：仅草稿状态可改，明细整体替换"""
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    if order.status != STATUS_DRAFT:
        raise HTTPException(status_code=400, detail="仅「草稿」状态的采购单可以编辑")
    if not order_data.items:
        raise HTTPException(status_code=400, detail="采购明细不能为空")

    # 校验商品存在
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

    order.supplier_id = order_data.supplier_id
    order.purchase_date = order_data.purchase_date or order.purchase_date or date.today()
    order.buyer = order_data.buyer
    order.expected_date = order_data.expected_date
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

    # 明细整体替换
    db.query(PurchaseItem).filter(PurchaseItem.order_id == order.id).delete()
    for item_data in order_data.items:
        if item_data.quantity <= 0:
            raise HTTPException(status_code=400, detail="数量必须大于 0")
        db.add(PurchaseItem(
            order_id=order.id,
            product_id=item_data.product_id,
            quantity=item_data.quantity,
            price=item_data.price,
            tax_rate=item_data.tax_rate or 0,
            amount=item_data.quantity * item_data.price,
            remark=item_data.remark,
        ))

    log_op(db, current_user, "采购管理", "编辑采购单", order.order_no)
    db.commit()
    db.refresh(order)
    return _decorate(db, order)


@router.delete("/{order_id}")
async def delete_purchase_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除采购单：仅草稿或已关闭可删；已审核/收货中的单据请先作废"""
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="采购单不存在")
    if order.status not in (STATUS_DRAFT, STATUS_CLOSED):
        raise HTTPException(
            status_code=400,
            detail="已审核或已收货的采购单不能删除，请先作废"
        )

    no = order.order_no
    db.query(PurchaseItem).filter(PurchaseItem.order_id == order.id).delete()
    db.delete(order)
    log_op(db, current_user, "采购管理", "删除采购单", no)
    db.commit()
    return ResponseModel(message="删除成功")
