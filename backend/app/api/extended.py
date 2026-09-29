"""扩展功能API：仪表盘/退货/收付款/库存明细/调拨/盘点/报表/日志/导出"""
import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func, and_
from typing import Optional
from datetime import datetime

from ..database import get_db
from ..models.user import User
from ..models.supplier import Supplier
from ..models.customer import Customer
from ..models.product import Product, Category
from ..models.purchase import PurchaseOrder, PurchaseItem
from ..models.sales import SalesOrder, SalesItem
from ..models.inventory import Inventory, Warehouse
from ..models.returns import SaleReturn, SaleReturnItem, PurchaseReturn, PurchaseReturnItem
from ..models.finance import (Payment, StockLog, StockTransfer, StockTransferItem,
                              OperationLog, StockCheck, StockCheckItem)
from ..schemas.common import ResponseModel, PaginatedResponse
from ..api.deps import get_current_user
from ..core.oplog import log_op
from ..core.stock import apply_stock, default_warehouse_id

router = APIRouter()


# ==================== 工具 ====================

def gen_no(db, prefix):
    today = datetime.now().strftime("%Y%m%d")
    p = f"{prefix}{today}"
    seq = 1
    try:
        model, field = {
            "PAY": (Payment, "payment_no"),
            "SR": (SaleReturn, "return_no"),
            "PR": (PurchaseReturn, "return_no"),
            "TF": (StockTransfer, "transfer_no"),
            "SC": (StockCheck, "check_no"),
        }[prefix]
        col = getattr(model, field)
        last = db.query(model).filter(col.like(f"{p}%")).order_by(model.id.desc()).first()
        if last:
            seq = int(getattr(last, field)[-4:]) + 1
    except Exception:
        pass
    return f"{p}{seq:04d}"


def add_stock_log(db, product_id, warehouse_id, type_, qty, before,
                  related_type, related_id, related_no, remark=""):
    db.add(StockLog(
        product_id=product_id, warehouse_id=warehouse_id, type=type_,
        quantity=qty, before_quantity=before, after_quantity=before + qty,
        related_type=related_type, related_id=related_id,
        related_no=related_no, remark=remark
    ))


# ==================== 仪表盘 ====================

@router.get("/dashboard")
async def get_dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = datetime.now().strftime("%Y-%m-%d")

    today_sales = db.query(sql_func.coalesce(sql_func.sum(SalesOrder.total_amount), 0)).filter(
        sql_func.date(SalesOrder.created_at) == today, SalesOrder.status.in_([1, 2, 3, 5, 6])).scalar()
    today_sales_count = db.query(SalesOrder).filter(
        sql_func.date(SalesOrder.created_at) == today, SalesOrder.status.in_([1, 2, 3, 5, 6])).count()
    today_purchase = db.query(sql_func.coalesce(sql_func.sum(PurchaseOrder.total_amount), 0)).filter(
        sql_func.date(PurchaseOrder.created_at) == today, PurchaseOrder.status.in_([1, 2, 3, 5, 6])).scalar()
    today_purchase_count = db.query(PurchaseOrder).filter(
        sql_func.date(PurchaseOrder.created_at) == today, PurchaseOrder.status.in_([1, 2, 3, 5, 6])).count()

    pending_purchase_in = db.query(PurchaseOrder).filter(PurchaseOrder.status == 1).count()
    pending_sales_out = db.query(SalesOrder).filter(SalesOrder.status == 1).count()

    sales_total = float(db.query(sql_func.coalesce(sql_func.sum(SalesOrder.total_amount), 0)).filter(SalesOrder.status.in_([1, 2, 3, 5, 6])).scalar())
    purchase_total = float(db.query(sql_func.coalesce(sql_func.sum(PurchaseOrder.total_amount), 0)).filter(PurchaseOrder.status.in_([1, 2, 3, 5, 6])).scalar())

    # 收付款按对象类型区分（退款给客户影响应收，收供应商退款影响应付）
    def pay_sum(type_, partner_type):
        return float(db.query(sql_func.coalesce(sql_func.sum(Payment.amount), 0)).filter(
            Payment.type == type_, Payment.partner_type == partner_type).scalar())

    recv_cust = pay_sum(1, "customer")
    refund_cust = pay_sum(2, "customer")
    paid_supp = pay_sum(2, "supplier")
    refund_supp = pay_sum(1, "supplier")

    # 退货冲减
    sale_ret = float(db.query(sql_func.coalesce(sql_func.sum(SaleReturn.total_amount), 0)).filter(SaleReturn.status.in_([1, 2])).scalar())
    purch_ret = float(db.query(sql_func.coalesce(sql_func.sum(PurchaseReturn.total_amount), 0)).filter(PurchaseReturn.status.in_([1, 2])).scalar())

    low_stock_count = db.query(Inventory).join(Product).filter(
        and_(Product.status == 1, Inventory.quantity <= Product.min_stock)).count()
    inventory_total = db.query(sql_func.coalesce(sql_func.sum(Inventory.quantity), 0)).scalar()

    return {
        "today_sales": float(today_sales),
        "today_sales_count": today_sales_count,
        "today_purchase": float(today_purchase),
        "today_purchase_count": today_purchase_count,
        "pending_purchase_in": pending_purchase_in,
        "pending_sales_out": pending_sales_out,
        "receivable": sales_total - recv_cust + refund_cust - sale_ret,
        "payable": purchase_total - paid_supp + refund_supp - purch_ret,
        "low_stock_count": low_stock_count,
        "inventory_total": int(inventory_total),
    }


@router.get("/sales-daily")
async def get_sales_daily(
    days: int = Query(30, ge=1, le=365, description="统计最近多少天"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """按日期合计销售额与笔数（含已审核/部分发货/已发货），返回最近 N 天，缺日补 0"""
    from datetime import timedelta

    end = datetime.now().date()
    start = end - timedelta(days=days - 1)

    rows = db.query(
        sql_func.date(SalesOrder.created_at).label("d"),
        sql_func.coalesce(sql_func.sum(SalesOrder.total_amount), 0).label("amt"),
        sql_func.count(SalesOrder.id).label("cnt"),
    ).filter(
        SalesOrder.status.in_([1, 2, 3, 5, 6]),
        sql_func.date(SalesOrder.created_at) >= str(start),
        sql_func.date(SalesOrder.created_at) <= str(end),
    ).group_by(sql_func.date(SalesOrder.created_at)).all()

    by_date = {str(r.d): (float(r.amt), int(r.cnt)) for r in rows}

    # 采购额同样一次分组查出，避免逐日查询
    prows = db.query(
        sql_func.date(PurchaseOrder.created_at).label("d"),
        sql_func.coalesce(sql_func.sum(PurchaseOrder.total_amount), 0).label("amt"),
    ).filter(
        PurchaseOrder.status.in_([1, 2, 3, 5, 6]),
        sql_func.date(PurchaseOrder.created_at) >= str(start),
        sql_func.date(PurchaseOrder.created_at) <= str(end),
    ).group_by(sql_func.date(PurchaseOrder.created_at)).all()

    pby = {str(r.d): float(r.amt) for r in prows}

    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        key = d.strftime("%Y-%m-%d")
        amt, cnt = by_date.get(key, (0.0, 0))
        out.append({
            "date": key,
            "amount": amt,
            "count": cnt,
            "purchase_amount": pby.get(key, 0.0),
        })

    total_amt = sum(x["amount"] for x in out)
    total_cnt = sum(x["count"] for x in out)

    return {
        "days": days,
        "start": str(start),
        "end": str(end),
        "total_amount": total_amt,
        "total_count": total_cnt,
        "avg_amount": round(total_amt / days, 2) if days else 0,
        "items": out,
    }


# ==================== 销售退货 ====================

def _sale_return_out(db, r):
    cust = db.query(Customer).filter(Customer.id == r.customer_id).first() if r.customer_id else None
    src_no = ""
    if r.sales_order_id:
        o = db.query(SalesOrder).filter(SalesOrder.id == r.sales_order_id).first()
        src_no = o.order_no if o else f"⚠ 销售单#{r.sales_order_id} 已删除"
    return {
        "id": r.id, "return_no": r.return_no, "total_amount": float(r.total_amount),
        "status": r.status, "reason": r.reason, "remark": r.remark,
        "created_at": r.created_at,
        "sales_order_id": r.sales_order_id,
        "source_order_no": src_no,
        "customer_id": r.customer_id,
        "customer_name": cust.name if cust else "",
        "customer_contact": cust.contact if cust else "",
        "customer_phone": cust.phone if cust else "",
        "items": [{"product_id": i.product_id, "quantity": i.quantity,
                   "price": float(i.price), "amount": float(i.amount)} for i in r.items],
    }


def _purchase_return_out(db, r):
    sup = db.query(Supplier).filter(Supplier.id == r.supplier_id).first() if r.supplier_id else None
    src_no = ""
    if r.purchase_order_id:
        o = db.query(PurchaseOrder).filter(PurchaseOrder.id == r.purchase_order_id).first()
        src_no = o.order_no if o else f"⚠ 采购单#{r.purchase_order_id} 已删除"
    return {
        "id": r.id, "return_no": r.return_no, "total_amount": float(r.total_amount),
        "status": r.status, "reason": r.reason, "remark": r.remark,
        "created_at": r.created_at,
        "purchase_order_id": r.purchase_order_id,
        "source_order_no": src_no,
        "supplier_id": r.supplier_id,
        "supplier_name": sup.name if sup else "",
        "supplier_contact": sup.contact if sup else "",
        "supplier_phone": sup.phone if sup else "",
        "items": [{"product_id": i.product_id, "quantity": i.quantity,
                   "price": float(i.price), "amount": float(i.amount)} for i in r.items],
    }


@router.get("/sale-returns")
async def get_sale_returns(page: int = 1, page_size: int = 20, keyword: Optional[str] = None,
                           status: Optional[int] = None,
                           db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(SaleReturn)
    if keyword: q = q.filter(SaleReturn.return_no.contains(keyword))
    if status is not None: q = q.filter(SaleReturn.status == status)
    total = q.count()
    items = q.order_by(SaleReturn.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # 金额汇总（不受分页影响），active 口径与财务管理一致
    def _sum(states):
        return float(db.query(sql_func.coalesce(sql_func.sum(SaleReturn.total_amount), 0))
                     .filter(SaleReturn.status.in_(states)).scalar())

    summary = {
        "all": _sum([0, 1, 2, 3]),
        "active": _sum([1, 2]),
        "draft": _sum([0]),
        "void": _sum([3]),
        "count": db.query(SaleReturn).count(),
    }

    return PaginatedResponse(total=total, page=page, page_size=page_size,
                             items=[_sale_return_out(db, r) for r in items],
                             summary=summary)


def _returned_qty_map(db, model, fk_field, order_id):
    """某单据已退数量（按商品汇总），排除已作废的退货单"""
    out = {}
    q = db.query(model).filter(fk_field == order_id, model.status != 3)
    for r in q.all():
        for it in r.items:
            out[it.product_id] = out.get(it.product_id, 0) + (it.quantity or 0)
    return out


def _sync_return_status(db, order_model, ret_model, fk_field, order_id, qty_attr,
                        shipped_status=3, partial_status=2):
    """根据退货情况同步原单状态

    无退货     -> 回到 已发货(3) / 部分发货(2)
    部分退回   -> 5 部分退货
    全部退回   -> 6 已退货

    qty_attr: 明细上的发出/收到数量字段（shipped_quantity / received_quantity）
    """
    order = db.query(order_model).filter(order_model.id == order_id).first()
    if not order or order.status in (0, 1, 4):      # 草稿/已审核/已关闭 不参与
        return

    returned = _returned_qty_map(db, ret_model, fk_field, order_id)

    total_ret = 0
    total_out = 0
    all_fully = True
    for it in order.items:
        base = getattr(it, qty_attr, 0) or 0
        got = returned.get(it.product_id, 0)
        total_ret += got
        total_out += base
        if got < base:
            all_fully = False

    old = order.status

    if total_ret == 0:
        # 退货被作废或本就没有退货 —— 回到发货状态
        order.status = shipped_status if total_out > 0 else partial_status
    elif all_fully and total_out > 0:
        order.status = 6                            # 已退货
    else:
        order.status = 5                            # 部分退货

    if old != order.status:
        log_op(db, None, "系统", "状态流转", order.order_no, f"{old} -> {order.status}")


def _returnable_orders(db, order_model, item_fk, ret_model, ret_fk, keyword, page, page_size, kind):
    """已发货/已收货且仍有可退余量的单据列表"""
    q = order_model.status.in_([2, 3, 5, 6])
    query = db.query(order_model).filter(q)
    if keyword:
        query = query.filter(order_model.order_no.contains(keyword))

    total = query.count()
    orders = query.order_by(order_model.id.desc()) \
                  .offset((page - 1) * page_size).limit(page_size).all()

    out = []
    for o in orders:
        returned = _returned_qty_map(db, ret_model, ret_fk, o.id)
        # 整单剩余可退件数
        remain = 0
        for it in o.items:
            shipped = (it.shipped_quantity if kind == "sale" else it.received_quantity) or 0
            remain += max(shipped - returned.get(it.product_id, 0), 0)

        if kind == "sale":
            partner = db.query(Customer).filter(Customer.id == o.customer_id).first()
            partner_name = partner.name if partner else ""
            date_val = o.sale_date
        else:
            partner = db.query(Supplier).filter(Supplier.id == o.supplier_id).first()
            partner_name = partner.name if partner else ""
            date_val = o.purchase_date

        out.append({
            "id": o.id, "order_no": o.order_no, "date": date_val,
            "partner_name": partner_name,
            "total_amount": float(o.total_amount),
            "status": o.status,
            "returnable_quantity": remain,
        })

    return PaginatedResponse(total=total, page=page, page_size=page_size, items=out)


@router.get("/sale-returns/returnable")
async def sale_return_returnable(keyword: Optional[str] = None, page: int = 1, page_size: int = 20,
                                 db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _returnable_orders(db, SalesOrder, SalesItem, SaleReturn, SaleReturn.sales_order_id,
                              keyword, page, page_size, "sale")


@router.get("/purchase-returns/returnable")
async def purchase_return_returnable(keyword: Optional[str] = None, page: int = 1, page_size: int = 20,
                                     db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _returnable_orders(db, PurchaseOrder, PurchaseItem, PurchaseReturn,
                              PurchaseReturn.purchase_order_id,
                              keyword, page, page_size, "purchase")


@router.get("/sale-returns/available/{order_id}")
async def sale_return_available(order_id: int, db: Session = Depends(get_db),
                                current_user: User = Depends(get_current_user)):
    """按销售单生成可退明细：带出原成交价、已发数量、可退数量"""
    order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "销售单不存在")
    if order.status not in (2, 3, 5, 6):
        raise HTTPException(400, "仅已发货或部分发货的销售单可以退货")

    returned = _returned_qty_map(db, SaleReturn, SaleReturn.sales_order_id, order_id)

    pids = [i.product_id for i in order.items]
    prods = {p.id: p for p in db.query(Product).filter(Product.id.in_(pids)).all()} if pids else {}

    items = []
    for it in order.items:
        p = prods.get(it.product_id)
        shipped = it.shipped_quantity or 0
        already = returned.get(it.product_id, 0)
        items.append({
            "product_id": it.product_id,
            "product_name": p.name if p else f"商品#{it.product_id}",
            "product_spec": p.spec if p else "",
            "product_unit": p.unit if p else "",
            "sold_quantity": it.quantity,
            "shipped_quantity": shipped,
            "returned_quantity": already,
            "available_quantity": max(shipped - already, 0),
            "price": float(it.price),      # 原成交价（含税）
            "tax_rate": float(it.tax_rate or 0),
        })

    cust = db.query(Customer).filter(Customer.id == order.customer_id).first()
    return {
        "sales_order_id": order.id,
        "order_no": order.order_no,
        "sale_date": order.sale_date,
        "customer_id": order.customer_id,
        "customer_name": cust.name if cust else "",
        "customer_contact": cust.contact if cust else "",
        "customer_phone": cust.phone if cust else "",
        "warehouse_id": order.warehouse_id,
        "items": items,
    }


@router.post("/sale-returns")
async def create_sale_return(data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not data.get("items"):
        raise HTTPException(400, "退货明细不能为空")

    order_id = data.get("sales_order_id")

    # 退货必须关联原销售单，数量严格校验
    if not order_id:
        raise HTTPException(400, "请先选择来源销售单，退货必须关联原单")

    order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
    if not order:
        raise HTTPException(400, f"销售单不存在：{order_id}")
    if order.status not in (2, 3, 5, 6):
        raise HTTPException(400, "仅已发货或部分发货的销售单可以退货")

    shipped = {i.product_id: (i.shipped_quantity or 0) for i in order.items}
    already = _returned_qty_map(db, SaleReturn, SaleReturn.sales_order_id, order_id)

    for item in data["items"]:
        pid = item["product_id"]
        qty = int(item.get("quantity") or 0)
        if qty <= 0:
            raise HTTPException(400, "退货数量必须大于 0")
        avail = shipped.get(pid, 0) - already.get(pid, 0)
        if qty > avail:
            p = db.query(Product).filter(Product.id == pid).first()
            raise HTTPException(
                400,
                f"「{p.name if p else pid}」可退数量仅 {avail}，本次退货 {qty} 超出"
            )
        already[pid] = already.get(pid, 0) + qty

    return_no = gen_no(db, "SR")
    total = sum(i["quantity"] * i["price"] for i in data["items"])
    sr = SaleReturn(return_no=return_no, customer_id=data["customer_id"], total_amount=total,
                    sales_order_id=order_id,
                    reason=data.get("reason"), remark=data.get("remark"),
                    created_by=current_user.id, status=0)
    db.add(sr); db.flush()
    for item in data["items"]:
        db.add(SaleReturnItem(return_id=sr.id, product_id=item["product_id"],
                              quantity=item["quantity"], price=item["price"],
                              amount=item["quantity"] * item["price"]))
    log_op(db, current_user, "销售退货", "新增", return_no, f"金额:{total}")
    db.commit(); db.refresh(sr)
    return {"id": sr.id, "return_no": sr.return_no}


@router.put("/sale-returns/{rid}/approve")
async def approve_sale_return(rid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sr = db.query(SaleReturn).filter(SaleReturn.id == rid).first()
    if not sr or sr.status != 0: raise HTTPException(400, "状态错误")
    sr.status = 1
    log_op(db, current_user, "销售退货", "审核", sr.return_no)
    db.commit()
    return ResponseModel(message="审核成功")


@router.put("/sale-returns/{rid}/receive")
async def receive_sale_return(rid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sr = db.query(SaleReturn).filter(SaleReturn.id == rid).first()
    if not sr or sr.status != 1: raise HTTPException(400, "状态错误")
    wid = default_warehouse_id(db)
    for item in sr.items:
        apply_stock(db, item.product_id, wid, item.quantity, "sale_return_in",
                    "sale_return", sr.id, sr.return_no)
    sr.status = 2
    log_op(db, current_user, "销售退货", "入库", sr.return_no)

    # 同步原销售单状态（部分退货/已退货/无退货回退）
    if sr.sales_order_id:
        _sync_return_status(db, SalesOrder, SaleReturn, SaleReturn.sales_order_id,
                            sr.sales_order_id, qty_attr="shipped_quantity")

    db.commit()
    return ResponseModel(message="入库成功")


@router.put("/sale-returns/{rid}/cancel")
async def cancel_sale_return(rid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sr = db.query(SaleReturn).filter(SaleReturn.id == rid).first()
    if not sr or sr.status > 1: raise HTTPException(400, "状态错误")
    sr.status = 3
    log_op(db, current_user, "销售退货", "作废", sr.return_no)

    # 退货作废后重新判定原单状态（可能从「部分退货/已退货」回到「已发货」）
    if sr.sales_order_id:
        _sync_return_status(db, SalesOrder, SaleReturn, SaleReturn.sales_order_id,
                            sr.sales_order_id, qty_attr="shipped_quantity")

    db.commit()
    return ResponseModel(message="作废成功")


# ==================== 采购退货 ====================

@router.get("/purchase-returns")
async def get_purchase_returns(page: int = 1, page_size: int = 20, keyword: Optional[str] = None,
                               status: Optional[int] = None,
                               db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(PurchaseReturn)
    if keyword: q = q.filter(PurchaseReturn.return_no.contains(keyword))
    if status is not None: q = q.filter(PurchaseReturn.status == status)
    total = q.count()
    items = q.order_by(PurchaseReturn.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    def _psum(states):
        return float(db.query(sql_func.coalesce(sql_func.sum(PurchaseReturn.total_amount), 0))
                     .filter(PurchaseReturn.status.in_(states)).scalar())

    summary = {
        "all": _psum([0, 1, 2, 3]),
        "active": _psum([1, 2]),
        "draft": _psum([0]),
        "void": _psum([3]),
        "count": db.query(PurchaseReturn).count(),
    }

    return PaginatedResponse(total=total, page=page, page_size=page_size,
                             items=[_purchase_return_out(db, r) for r in items],
                             summary=summary)


@router.get("/purchase-returns/available/{order_id}")
async def purchase_return_available(order_id: int, db: Session = Depends(get_db),
                                    current_user: User = Depends(get_current_user)):
    """按采购单生成可退明细：带出原成交价、已收数量、可退数量"""
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "采购单不存在")
    if order.status not in (2, 3, 5, 6):
        raise HTTPException(400, "仅已收货或部分收货的采购单可以退货")

    returned = _returned_qty_map(db, PurchaseReturn, PurchaseReturn.purchase_order_id, order_id)

    pids = [i.product_id for i in order.items]
    prods = {p.id: p for p in db.query(Product).filter(Product.id.in_(pids)).all()} if pids else {}

    items = []
    for it in order.items:
        p = prods.get(it.product_id)
        received = it.received_quantity or 0
        already = returned.get(it.product_id, 0)
        items.append({
            "product_id": it.product_id,
            "product_name": p.name if p else f"商品#{it.product_id}",
            "product_spec": p.spec if p else "",
            "product_unit": p.unit if p else "",
            "sold_quantity": it.quantity,
            "received_quantity": received,
            "returned_quantity": already,
            "available_quantity": max(received - already, 0),
            "price": float(it.price),
            "tax_rate": float(it.tax_rate or 0),
        })

    sup = db.query(Supplier).filter(Supplier.id == order.supplier_id).first()
    return {
        "purchase_order_id": order.id,
        "order_no": order.order_no,
        "purchase_date": order.purchase_date,
        "supplier_id": order.supplier_id,
        "supplier_name": sup.name if sup else "",
        "supplier_contact": sup.contact if sup else "",
        "supplier_phone": sup.phone if sup else "",
        "warehouse_id": order.warehouse_id,
        "items": items,
    }


@router.post("/purchase-returns")
async def create_purchase_return(data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not data.get("items"):
        raise HTTPException(400, "退货明细不能为空")

    order_id = data.get("purchase_order_id")

    # 退货必须关联原采购单，数量严格校验
    if not order_id:
        raise HTTPException(400, "请先选择来源采购单，退货必须关联原单")

    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(400, f"采购单不存在：{order_id}")
    if order.status not in (2, 3, 5, 6):
        raise HTTPException(400, "仅已收货或部分收货的采购单可以退货")

    received = {i.product_id: (i.received_quantity or 0) for i in order.items}
    already = _returned_qty_map(db, PurchaseReturn, PurchaseReturn.purchase_order_id, order_id)

    for item in data["items"]:
        pid = item["product_id"]
        qty = int(item.get("quantity") or 0)
        if qty <= 0:
            raise HTTPException(400, "退货数量必须大于 0")
        avail = received.get(pid, 0) - already.get(pid, 0)
        if qty > avail:
            p = db.query(Product).filter(Product.id == pid).first()
            raise HTTPException(
                400,
                f"「{p.name if p else pid}」可退数量仅 {avail}，本次退货 {qty} 超出"
            )
        already[pid] = already.get(pid, 0) + qty

    return_no = gen_no(db, "PR")
    total = sum(i["quantity"] * i["price"] for i in data["items"])
    pr = PurchaseReturn(return_no=return_no, supplier_id=data["supplier_id"], total_amount=total,
                        purchase_order_id=order_id,
                        reason=data.get("reason"), remark=data.get("remark"),
                        created_by=current_user.id, status=0)
    db.add(pr); db.flush()
    for item in data["items"]:
        db.add(PurchaseReturnItem(return_id=pr.id, product_id=item["product_id"],
                                  quantity=item["quantity"], price=item["price"],
                                  amount=item["quantity"] * item["price"]))
    log_op(db, current_user, "采购退货", "新增", return_no, f"金额:{total}")
    db.commit(); db.refresh(pr)
    return {"id": pr.id, "return_no": pr.return_no}


@router.put("/purchase-returns/{rid}/approve")
async def approve_purchase_return(rid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    pr = db.query(PurchaseReturn).filter(PurchaseReturn.id == rid).first()
    if not pr or pr.status != 0: raise HTTPException(400, "状态错误")
    pr.status = 1
    log_op(db, current_user, "采购退货", "审核", pr.return_no)
    db.commit()
    return ResponseModel(message="审核成功")


@router.put("/purchase-returns/{rid}/ship")
async def ship_purchase_return(rid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    pr = db.query(PurchaseReturn).filter(PurchaseReturn.id == rid).first()
    if not pr or pr.status != 1: raise HTTPException(400, "状态错误")
    wid = default_warehouse_id(db)
    for item in pr.items:
        apply_stock(db, item.product_id, wid, -item.quantity, "purchase_return_out",
                    "purchase_return", pr.id, pr.return_no)
    pr.status = 2
    log_op(db, current_user, "采购退货", "出库", pr.return_no)

    # 同步原采购单状态
    if pr.purchase_order_id:
        _sync_return_status(db, PurchaseOrder, PurchaseReturn, PurchaseReturn.purchase_order_id,
                            pr.purchase_order_id, qty_attr="received_quantity")

    db.commit()
    return ResponseModel(message="出库成功")


@router.put("/purchase-returns/{rid}/cancel")
async def cancel_purchase_return(rid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    pr = db.query(PurchaseReturn).filter(PurchaseReturn.id == rid).first()
    if not pr or pr.status > 1: raise HTTPException(400, "状态错误")
    pr.status = 3
    log_op(db, current_user, "采购退货", "作废", pr.return_no)

    # 退货作废后重新判定原单状态
    if pr.purchase_order_id:
        _sync_return_status(db, PurchaseOrder, PurchaseReturn, PurchaseReturn.purchase_order_id,
                            pr.purchase_order_id, qty_attr="received_quantity")

    db.commit()
    return ResponseModel(message="作废成功")


# ==================== 收付款 ====================

def _payment_out(db, p):
    name = ""
    if p.partner_type == "customer":
        o = db.query(Customer).filter(Customer.id == p.partner_id).first()
    else:
        o = db.query(Supplier).filter(Supplier.id == p.partner_id).first()
    if o: name = o.name
    return {
        "id": p.id, "payment_no": p.payment_no, "type": p.type,
        "partner_type": p.partner_type, "partner_id": p.partner_id, "partner_name": name,
        "amount": float(p.amount), "payment_method": p.payment_method,
        "voucher_no": p.voucher_no, "remark": p.remark, "created_at": p.created_at,
        "related_type": p.related_type, "related_id": p.related_id,
        # 凭证（层次2）
        "voucher_date": p.voucher_date, "period": p.period,
        "summary": p.summary, "attachment_count": p.attachment_count,
        "debit_account": p.debit_account, "credit_account": p.credit_account,
    }


@router.get("/payments")
async def get_payments(page: int = 1, page_size: int = 20, type: Optional[int] = None,
                       db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Payment)
    if type is not None: q = q.filter(Payment.type == type)
    total = q.count()
    items = q.order_by(Payment.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(total=total, page=page, page_size=page_size,
                             items=[_payment_out(db, p) for p in items])


def gen_voucher_no(db, dt=None):
    """凭证号：记-2026-09-0001（按会计期间流水）"""
    dt = dt or datetime.now()
    period = dt.strftime("%Y-%m")
    prefix = f"记-{period}-"
    last = db.query(Payment).filter(Payment.voucher_no.like(f"{prefix}%")) \
             .order_by(Payment.id.desc()).first()
    seq = 1
    if last and last.voucher_no:
        try:
            seq = int(last.voucher_no.split("-")[-1]) + 1
        except ValueError:
            seq = 1
    return f"{prefix}{seq:04d}"


# 借方科目：按收付款方式判断
DEBIT_BY_METHOD = {
    "现金": "库存现金",
    "银行转账": "银行存款",
    "微信": "银行存款",
    "支付宝": "银行存款",
    "银行承兑": "应收票据",
}


def build_voucher(type_, partner_name, amount, payment_method,
                  related_no="", related_type="", partner_type="customer"):
    """生成摘要与借贷科目提示（层次2：不做真实分录）

    按「类型 × 对象类型」四象限确定科目：
        收款 · 客户     借 银行存款 / 贷 应收账款
        收款 · 供应商   借 银行存款 / 贷 应付账款      （供应商退款给我们）
        付款 · 供应商   借 应付账款 / 贷 银行存款
        付款 · 客户     借 应收账款 / 贷 银行存款      （退款给客户）
    """
    is_receive = (type_ == 1)
    is_customer = (partner_type == "customer")

    cash = DEBIT_BY_METHOD.get(payment_method or "", "银行存款")

    # 摘要
    if is_receive and is_customer:
        verb, kind = "收", "货款"
    elif is_receive and not is_customer:
        verb, kind = "收", "退款"          # 供应商退款
    elif not is_receive and not is_customer:
        verb, kind = "付", "货款"
    else:
        verb, kind = "付", "退款"          # 退款给客户

    if related_type == "sale_return":
        kind = "退货款"
    elif related_type == "purchase_return":
        kind = "退货款"

    summary = f"{verb}{partner_name or ''}{kind}"
    if related_no:
        summary += f"（{related_no}）"

    # 借贷
    if is_receive and is_customer:
        debit, credit = cash, "应收账款"
    elif is_receive and not is_customer:
        debit, credit = cash, "应付账款"
    elif not is_receive and not is_customer:
        debit, credit = "应付账款", cash
    else:
        debit, credit = "应收账款", cash

    return summary, debit, credit


@router.post("/payments")
async def create_payment(data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    pno = gen_no(db, "PAY")

    vdate = None
    raw_date = data.get("voucher_date")
    if raw_date:
        try:
            vdate = datetime.strptime(str(raw_date)[:10], "%Y-%m-%d").date()
        except ValueError:
            vdate = None
    vdate = vdate or datetime.now().date()

    auto_summary, debit, credit = _resolve_payment_context(db, data)

    p = Payment(
        payment_no=pno, type=data["type"],
        related_type=data.get("related_type"), related_id=data.get("related_id"),
        partner_type=data["partner_type"], partner_id=data["partner_id"],
        amount=data["amount"],
        payment_method=data.get("payment_method", "现金"),
        voucher_no=data.get("voucher_no") or gen_voucher_no(db, vdate),
        voucher_date=vdate,
        period=vdate.strftime("%Y-%m"),
        summary=data.get("summary") or auto_summary,
        attachment_count=data.get("attachment_count") or 1,
        debit_account=data.get("debit_account") or debit,
        credit_account=data.get("credit_account") or credit,
        remark=data.get("remark"),
        created_by=current_user.id
    )
    db.add(p)
    log_op(db, current_user, "收付款", "新增", pno,
           f"{p.voucher_no} {p.summary} 金额:{data['amount']}")
    db.commit(); db.refresh(p)
    return {
        "id": p.id, "payment_no": p.payment_no,
        "voucher_no": p.voucher_no, "summary": p.summary,
        "debit_account": p.debit_account, "credit_account": p.credit_account,
    }


def _resolve_payment_context(db, data):
    """解析往来单位名称、关联单据号，并生成摘要与借贷科目"""
    partner_name = ""
    if data.get("partner_type") == "customer":
        c = db.query(Customer).filter(Customer.id == data.get("partner_id")).first()
        partner_name = c.name if c else ""
    else:
        s = db.query(Supplier).filter(Supplier.id == data.get("partner_id")).first()
        partner_name = s.name if s else ""

    related_no = ""
    rid = data.get("related_id")
    if rid:
        if data.get("related_type") == "sales_order":
            o = db.query(SalesOrder).filter(SalesOrder.id == rid).first()
            related_no = o.order_no if o else ""
        elif data.get("related_type") == "purchase_order":
            o = db.query(PurchaseOrder).filter(PurchaseOrder.id == rid).first()
            related_no = o.order_no if o else ""

    summary, debit, credit = build_voucher(
        data["type"], partner_name, data["amount"],
        data.get("payment_method"), related_no, data.get("related_type"),
        data.get("partner_type") or "customer"
    )
    return summary, debit, credit


@router.put("/payments/{payment_id}")
async def update_payment(
    payment_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """编辑收付款：凭证号与期间保持不变，摘要/借贷按新内容重算"""
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="收付款记录不存在")

    vdate = p.voucher_date
    raw = data.get("voucher_date")
    if raw:
        try:
            vdate = datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
        except ValueError:
            pass

    merged = {
        "type": data.get("type", p.type),
        "partner_type": data.get("partner_type", p.partner_type),
        "partner_id": data.get("partner_id", p.partner_id),
        "amount": data.get("amount", float(p.amount)),
        "payment_method": data.get("payment_method", p.payment_method),
        "related_type": data.get("related_type", p.related_type),
        "related_id": data.get("related_id", p.related_id),
    }
    auto_summary, debit, credit = _resolve_payment_context(db, merged)

    before = f"{p.amount}"
    p.type = merged["type"]
    p.partner_type = merged["partner_type"]
    p.partner_id = merged["partner_id"]
    p.amount = merged["amount"]
    p.payment_method = merged["payment_method"]
    p.related_type = merged["related_type"]
    p.related_id = merged["related_id"]
    p.voucher_date = vdate
    p.period = vdate.strftime("%Y-%m") if vdate else p.period
    p.summary = data.get("summary") or auto_summary
    p.debit_account = data.get("debit_account") or debit
    p.credit_account = data.get("credit_account") or credit
    if data.get("attachment_count"):
        p.attachment_count = data["attachment_count"]
    # 只有传了非空 voucher_no 才覆盖，否则保留原凭证号
    if data.get("voucher_no"):
        p.voucher_no = data["voucher_no"]
    p.remark = data.get("remark", p.remark)

    log_op(db, current_user, "收付款", "编辑", p.payment_no,
           f"{p.voucher_no} 金额 {before} -> {p.amount}")
    db.commit(); db.refresh(p)
    return {
        "id": p.id, "payment_no": p.payment_no,
        "voucher_no": p.voucher_no, "summary": p.summary,
    }


@router.delete("/payments/{payment_id}")
async def delete_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除收付款：应收应付会随之回退"""
    p = db.query(Payment).filter(Payment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="收付款记录不存在")

    info = f"{p.payment_no} {p.voucher_no or ''} 金额:{p.amount}"
    db.delete(p)
    log_op(db, current_user, "收付款", "删除", p.payment_no, info)
    db.commit()
    return ResponseModel(message="删除成功")


@router.get("/receivables")
async def get_receivables(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sales_total = db.query(sql_func.coalesce(sql_func.sum(SalesOrder.total_amount), 0)).filter(SalesOrder.status.in_([1, 2, 3, 5, 6])).scalar()
    purchase_total = db.query(sql_func.coalesce(sql_func.sum(PurchaseOrder.total_amount), 0)).filter(PurchaseOrder.status.in_([1, 2, 3, 5, 6])).scalar()

    # 收付款必须按「对象类型」区分：
    #   收客户货款 / 退款给客户    -> 影响应收
    #   付供应商货款 / 收供应商退款 -> 影响应付
    def pay_sum(type_, partner_type):
        return float(db.query(sql_func.coalesce(sql_func.sum(Payment.amount), 0)).filter(
            Payment.type == type_, Payment.partner_type == partner_type).scalar())

    recv_from_customer = pay_sum(1, "customer")     # 收客户货款
    refund_to_customer = pay_sum(2, "customer")     # 退款给客户
    paid_to_supplier = pay_sum(2, "supplier")       # 付供应商货款
    refund_from_supplier = pay_sum(1, "supplier")   # 收供应商退款

    # 已审核/已入库的退货也要冲减
    sale_returned = db.query(sql_func.coalesce(sql_func.sum(SaleReturn.total_amount), 0)).filter(
        SaleReturn.status.in_([1, 2])).scalar()
    purchase_returned = db.query(sql_func.coalesce(sql_func.sum(PurchaseReturn.total_amount), 0)).filter(
        PurchaseReturn.status.in_([1, 2])).scalar()

    # 符号说明：
    #   收客户货款 -> 应收减少
    #   退款给客户 -> 应收回升（把多收的钱还回去）
    #   付供应商货款 -> 应付减少
    #   收供应商退款 -> 应付回升
    receivable = float(sales_total) - recv_from_customer + refund_to_customer - float(sale_returned)
    payable = float(purchase_total) - paid_to_supplier + refund_from_supplier - float(purchase_returned)

    return {
        "receivable": receivable,
        "payable": payable,
        "sales_total": float(sales_total),
        "purchase_total": float(purchase_total),
        # 兼容旧前端字段
        "received": recv_from_customer,
        "paid": paid_to_supplier,
        # 明细口径，便于前端展示
        "recv_from_customer": recv_from_customer,
        "refund_to_customer": refund_to_customer,
        "paid_to_supplier": paid_to_supplier,
        "refund_from_supplier": refund_from_supplier,
        "sale_returned": float(sale_returned),
        "purchase_returned": float(purchase_returned),
    }


# ==================== 库存明细 ====================

@router.get("/stock-logs")
async def get_stock_logs(page: int = 1, page_size: int = 20, product_id: Optional[int] = None,
                         warehouse_id: Optional[int] = None, type: Optional[str] = None,
                         db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(StockLog)
    if product_id: q = q.filter(StockLog.product_id == product_id)
    if warehouse_id: q = q.filter(StockLog.warehouse_id == warehouse_id)
    if type: q = q.filter(StockLog.type == type)
    total = q.count()
    items = q.order_by(StockLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    out = []
    for s in items:
        prod = db.query(Product).filter(Product.id == s.product_id).first()
        wh = db.query(Warehouse).filter(Warehouse.id == s.warehouse_id).first()
        out.append({
            "id": s.id, "product_id": s.product_id,
            "product_name": prod.name if prod else "",
            "warehouse_id": s.warehouse_id,
            "warehouse_name": wh.name if wh else "",
            "type": s.type, "quantity": s.quantity,
            "before_quantity": s.before_quantity, "after_quantity": s.after_quantity,
            "related_no": s.related_no, "remark": s.remark, "created_at": s.created_at,
        })
    return PaginatedResponse(total=total, page=page, page_size=page_size, items=out)


@router.get("/stock-logs/stat")
async def stock_log_stat(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """流水与库存概况，用于判断是否需要生成期初流水"""
    log_count = db.query(StockLog).count()
    inv_count = db.query(Inventory).count()
    return {
        "log_count": log_count,
        "inventory_count": inv_count,
        "need_init": log_count == 0 and inv_count > 0,
    }


@router.post("/stock-logs/init")
async def init_stock_logs(
    overwrite: bool = Query(False, description="清空已有流水后重建"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """按当前库存生成期初流水。用于历史数据补齐。"""
    existing = db.query(StockLog).count()
    if existing and not overwrite:
        raise HTTPException(
            400,
            f"已有 {existing} 条库存流水。如需按当前库存重建，请勾选「清空后重建」"
        )

    if overwrite:
        db.query(StockLog).delete()
        db.flush()

    rows = db.query(Inventory, Product, Warehouse).join(
        Product, Inventory.product_id == Product.id
    ).join(
        Warehouse, Inventory.warehouse_id == Warehouse.id
    ).all()

    created = 0
    for inv, prod, wh in rows:
        if inv.quantity == 0:
            continue
        db.add(StockLog(
            product_id=prod.id, warehouse_id=wh.id, type="init",
            quantity=inv.quantity, before_quantity=0, after_quantity=inv.quantity,
            related_type="init", related_id=None, related_no="",
            remark="期初库存"
        ))
        created += 1

    log_op(db, current_user, "库存管理", "生成期初流水", f"{created} 条")
    db.commit()
    return {"created": created, "message": f"已生成 {created} 条期初库存流水"}


# ==================== 库存调拨 ====================

def _transfer_out(db, t):
    fw = db.query(Warehouse).filter(Warehouse.id == t.from_warehouse_id).first()
    tw = db.query(Warehouse).filter(Warehouse.id == t.to_warehouse_id).first()
    items = []
    for i in t.items:
        prod = db.query(Product).filter(Product.id == i.product_id).first()
        items.append({"product_id": i.product_id,
                      "product_name": prod.name if prod else "",
                      "spec": prod.spec if prod else "",
                      "unit": prod.unit if prod else "",
                      "quantity": i.quantity})
    return {
        "id": t.id, "transfer_no": t.transfer_no, "status": t.status,
        "from_warehouse_id": t.from_warehouse_id,
        "from_warehouse_name": fw.name if fw else "",
        "to_warehouse_id": t.to_warehouse_id,
        "to_warehouse_name": tw.name if tw else "",
        "remark": t.remark, "created_at": t.created_at, "items": items,
    }


@router.get("/stock-transfers")
async def get_stock_transfers(page: int = 1, page_size: int = 20,
                              db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = db.query(StockTransfer).count()
    items = db.query(StockTransfer).order_by(StockTransfer.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(total=total, page=page, page_size=page_size,
                             items=[_transfer_out(db, t) for t in items])


@router.get("/stock-transfers/{tid}")
async def get_stock_transfer(tid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(StockTransfer).filter(StockTransfer.id == tid).first()
    if not t: raise HTTPException(404, "调拨单不存在")
    return _transfer_out(db, t)


@router.post("/stock-transfers")
async def create_stock_transfer(data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    src = data.get("from_warehouse_id")
    dst = data.get("to_warehouse_id")
    items = data.get("items") or []

    if not src or not dst:
        raise HTTPException(400, "请选择源仓库和目标仓库")
    if src == dst:
        raise HTTPException(400, "源仓库与目标仓库不能相同")
    if not db.query(Warehouse).filter(Warehouse.id == src).first():
        raise HTTPException(400, f"源仓库 #{src} 不存在")
    if not db.query(Warehouse).filter(Warehouse.id == dst).first():
        raise HTTPException(400, f"目标仓库 #{dst} 不存在")

    valid = [i for i in items if i.get("product_id") and int(i.get("quantity") or 0) > 0]
    if not valid:
        raise HTTPException(400, "调拨明细不能为空（需选择商品且数量大于 0）")

    for i in valid:
        if not db.query(Product).filter(Product.id == i["product_id"]).first():
            raise HTTPException(400, f"商品 #{i['product_id']} 不存在")

    tno = gen_no(db, "TF")
    t = StockTransfer(transfer_no=tno, from_warehouse_id=src, to_warehouse_id=dst,
                      remark=data.get("remark"), created_by=current_user.id, status=0)
    db.add(t); db.flush()
    for i in valid:
        db.add(StockTransferItem(transfer_id=t.id, product_id=i["product_id"],
                                 quantity=int(i["quantity"])))
    log_op(db, current_user, "库存调拨", "新增", tno)
    db.commit(); db.refresh(t)
    return {"id": t.id, "transfer_no": t.transfer_no}


@router.put("/stock-transfers/{tid}/approve")
async def approve_stock_transfer(tid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(StockTransfer).filter(StockTransfer.id == tid).first()
    if not t or t.status != 0: raise HTTPException(400, "状态错误")
    for item in t.items:
        apply_stock(db, item.product_id, t.from_warehouse_id, -item.quantity,
                    "transfer_out", "transfer", t.id, t.transfer_no)
        apply_stock(db, item.product_id, t.to_warehouse_id, item.quantity,
                    "transfer_in", "transfer", t.id, t.transfer_no)
    t.status = 2
    log_op(db, current_user, "库存调拨", "审核完成", t.transfer_no)
    db.commit()
    return ResponseModel(message="调拨完成")


@router.put("/stock-transfers/{tid}/cancel")
async def cancel_stock_transfer(tid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(StockTransfer).filter(StockTransfer.id == tid).first()
    if not t or t.status != 0: raise HTTPException(400, "状态错误")
    t.status = 3
    log_op(db, current_user, "库存调拨", "作废", t.transfer_no)
    db.commit()
    return ResponseModel(message="作废成功")


# ==================== 库存盘点 ====================

def _check_out(db, c):
    wh = db.query(Warehouse).filter(Warehouse.id == c.warehouse_id).first()
    items = []
    for i in c.items:
        prod = db.query(Product).filter(Product.id == i.product_id).first()
        items.append({"product_id": i.product_id,
                      "product_name": prod.name if prod else "",
                      "spec": prod.spec if prod else "",
                      "unit": prod.unit if prod else "",
                      "system_quantity": i.system_quantity,
                      "actual_quantity": i.actual_quantity,
                      "diff": i.diff})
    return {"id": c.id, "check_no": c.check_no, "status": c.status,
            "warehouse_id": c.warehouse_id,
            "warehouse_name": wh.name if wh else "",
            "remark": c.remark, "created_at": c.created_at, "items": items}


@router.get("/stock-checks")
async def get_stock_checks(page: int = 1, page_size: int = 20,
                           db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = db.query(StockCheck).count()
    items = db.query(StockCheck).order_by(StockCheck.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(total=total, page=page, page_size=page_size,
                             items=[_check_out(db, c) for c in items])


@router.get("/stock-checks/preview")
async def preview_stock_check(warehouse_id: int = 1, db: Session = Depends(get_db),
                              current_user: User = Depends(get_current_user)):
    """生成盘点底稿：当前仓库全部商品+账面数量"""
    rows = db.query(Product, Inventory).outerjoin(
        Inventory, and_(Inventory.product_id == Product.id,
                        Inventory.warehouse_id == warehouse_id)
    ).filter(Product.status == 1).all()
    return {
        "warehouse_id": warehouse_id,
        "items": [{
            "product_id": p.id, "product_name": p.name, "spec": p.spec or "",
            "unit": p.unit or "", "system_quantity": (inv.quantity if inv else 0),
            "actual_quantity": (inv.quantity if inv else 0),
            "diff": 0,
        } for p, inv in rows]
    }


@router.get("/stock-checks/{cid}")
async def get_stock_check(cid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(StockCheck).filter(StockCheck.id == cid).first()
    if not c: raise HTTPException(404, "盘点单不存在")
    return _check_out(db, c)


@router.post("/stock-checks")
async def create_stock_check(data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not data.get("items"):
        raise HTTPException(400, "盘点明细不能为空")
    cno = gen_no(db, "SC")
    c = StockCheck(check_no=cno, warehouse_id=data["warehouse_id"],
                   remark=data.get("remark"), created_by=current_user.id, status=0)
    db.add(c); db.flush()
    for item in data["items"]:
        sys_qty = int(item.get("system_quantity", 0))
        act_qty = int(item.get("actual_quantity", sys_qty))
        db.add(StockCheckItem(check_id=c.id, product_id=item["product_id"],
                              system_quantity=sys_qty, actual_quantity=act_qty,
                              diff=act_qty - sys_qty))
    log_op(db, current_user, "库存盘点", "新增", cno)
    db.commit(); db.refresh(c)
    return {"id": c.id, "check_no": c.check_no}


@router.put("/stock-checks/{cid}/approve")
async def approve_stock_check(cid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(StockCheck).filter(StockCheck.id == cid).first()
    if not c or c.status != 0: raise HTTPException(400, "状态错误")
    for item in c.items:
        if item.diff == 0:
            continue
        apply_stock(db, item.product_id, c.warehouse_id, item.diff,
                    "adjust_in" if item.diff > 0 else "adjust_out",
                    "stock_check", c.id, c.check_no,
                    remark=f"盘{'盈' if item.diff > 0 else '亏'}")
    c.status = 1
    log_op(db, current_user, "库存盘点", "审核调账", c.check_no)
    db.commit()
    return ResponseModel(message="盘点完成，库存已调整")


@router.put("/stock-checks/{cid}/cancel")
async def cancel_stock_check(cid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(StockCheck).filter(StockCheck.id == cid).first()
    if not c or c.status != 0: raise HTTPException(400, "状态错误")
    c.status = 2
    log_op(db, current_user, "库存盘点", "作废", c.check_no)
    db.commit()
    return ResponseModel(message="作废成功")


# ==================== 报表 ====================

@router.get("/reports/sales")
async def sales_report(start_date: Optional[str] = None, end_date: Optional[str] = None,
                       db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(SalesOrder).filter(SalesOrder.status.in_([1, 2, 3, 5, 6]))
    if start_date: q = q.filter(SalesOrder.created_at >= start_date)
    if end_date: q = q.filter(SalesOrder.created_at <= end_date)
    total_amount = float(q.with_entities(sql_func.coalesce(sql_func.sum(SalesOrder.total_amount), 0)).scalar())
    order_count = q.count()

    bc = db.query(Customer.name, sql_func.sum(SalesOrder.total_amount)).join(
        SalesOrder, SalesOrder.customer_id == Customer.id).filter(SalesOrder.status.in_([1, 2, 3, 5, 6]))
    if start_date: bc = bc.filter(SalesOrder.created_at >= start_date)
    if end_date: bc = bc.filter(SalesOrder.created_at <= end_date)
    by_customer = bc.group_by(Customer.name).all()

    bp = db.query(Product.name, sql_func.sum(SalesItem.quantity), sql_func.sum(SalesItem.amount)).join(
        SalesItem, SalesItem.product_id == Product.id).join(
        SalesOrder, SalesItem.order_id == SalesOrder.id).filter(SalesOrder.status.in_([1, 2, 3, 5, 6]))
    if start_date: bp = bp.filter(SalesOrder.created_at >= start_date)
    if end_date: bp = bp.filter(SalesOrder.created_at <= end_date)
    by_product = bp.group_by(Product.name).all()

    return {
        "total_amount": total_amount, "order_count": order_count,
        "by_customer": [{"name": n, "amount": float(a)} for n, a in by_customer],
        "by_product": [{"name": n, "qty": int(qt or 0), "amount": float(a or 0)} for n, qt, a in by_product],
    }


@router.get("/reports/purchase")
async def purchase_report(start_date: Optional[str] = None, end_date: Optional[str] = None,
                          db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(PurchaseOrder).filter(PurchaseOrder.status.in_([1, 2, 3, 5, 6]))
    if start_date: q = q.filter(PurchaseOrder.created_at >= start_date)
    if end_date: q = q.filter(PurchaseOrder.created_at <= end_date)
    total_amount = float(q.with_entities(sql_func.coalesce(sql_func.sum(PurchaseOrder.total_amount), 0)).scalar())
    order_count = q.count()

    bs = db.query(Supplier.name, sql_func.sum(PurchaseOrder.total_amount)).join(
        PurchaseOrder, PurchaseOrder.supplier_id == Supplier.id).filter(PurchaseOrder.status.in_([1, 2, 3, 5, 6]))
    if start_date: bs = bs.filter(PurchaseOrder.created_at >= start_date)
    if end_date: bs = bs.filter(PurchaseOrder.created_at <= end_date)
    by_supplier = bs.group_by(Supplier.name).all()

    bp = db.query(Product.name, sql_func.sum(PurchaseItem.quantity), sql_func.sum(PurchaseItem.amount)).join(
        PurchaseItem, PurchaseItem.product_id == Product.id).join(
        PurchaseOrder, PurchaseItem.order_id == PurchaseOrder.id).filter(PurchaseOrder.status.in_([1, 2, 3, 5, 6]))
    if start_date: bp = bp.filter(PurchaseOrder.created_at >= start_date)
    if end_date: bp = bp.filter(PurchaseOrder.created_at <= end_date)
    by_product = bp.group_by(Product.name).all()

    return {
        "total_amount": total_amount, "order_count": order_count,
        "by_supplier": [{"name": n, "amount": float(a)} for n, a in by_supplier],
        "by_product": [{"name": n, "qty": int(qt or 0), "amount": float(a or 0)} for n, qt, a in by_product],
    }


@router.get("/reports/profit")
async def profit_report(start_date: Optional[str] = None, end_date: Optional[str] = None,
                        db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    si = db.query(
        SalesItem.product_id,
        sql_func.sum(SalesItem.quantity).label("total_qty"),
        sql_func.sum(SalesItem.amount).label("total_sale_amount"),
    ).join(SalesOrder, SalesItem.order_id == SalesOrder.id).filter(SalesOrder.status.in_([1, 2, 3, 5, 6]))
    if start_date: si = si.filter(SalesOrder.created_at >= start_date)
    if end_date: si = si.filter(SalesOrder.created_at <= end_date)
    rows = si.group_by(SalesItem.product_id).all()

    total_sale = 0.0; total_cost = 0.0
    detail = []
    for r in rows:
        prod = db.query(Product).filter(Product.id == r.product_id).first()
        if not prod: continue
        sale = float(r.total_sale_amount or 0)
        cost = float(r.total_qty or 0) * float(prod.purchase_price or 0)
        total_sale += sale; total_cost += cost
        detail.append({"name": prod.name, "qty": int(r.total_qty or 0),
                       "sale": sale, "cost": cost, "profit": sale - cost})
    detail.sort(key=lambda x: x["profit"], reverse=True)

    return {
        "total_sale": total_sale, "total_cost": total_cost,
        "profit": total_sale - total_cost,
        "profit_rate": round((total_sale - total_cost) / total_sale * 100, 2) if total_sale > 0 else 0,
        "detail": detail,
    }


@router.get("/reports/inventory")
async def inventory_report(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Inventory, Product, Warehouse).join(
        Product, Inventory.product_id == Product.id).join(
        Warehouse, Inventory.warehouse_id == Warehouse.id).all()
    total_qty = 0; total_value = 0.0; items = []
    for inv, prod, wh in rows:
        value = float(inv.quantity) * float(prod.purchase_price or 0)
        total_qty += inv.quantity; total_value += value
        items.append({"product_name": prod.name, "sku": prod.sku or "",
                      "warehouse_name": wh.name, "quantity": inv.quantity,
                      "cost_price": float(prod.purchase_price or 0), "value": value,
                      "min_stock": prod.min_stock, "low": inv.quantity <= prod.min_stock})
    return {"total_qty": total_qty, "total_value": total_value, "items": items}


# ==================== 数据自检 ====================

def _collect_issues(db):
    """收集全部数据问题。每条带 fixable 标记与 fix_action。"""
    issues = []

    sup_ids = {s.id for s in db.query(Supplier).all()}
    cus_ids = {c.id for c in db.query(Customer).all()}
    prod_ids = {p.id for p in db.query(Product).all()}
    wh_ids = {w.id for w in db.query(Warehouse).all()}

    def check(table, rows, field, valid, label, fixable=False, action=None):
        groups = {}
        for r in rows:
            v = getattr(r, field)
            if v and v not in valid:
                groups.setdefault(v, []).append(r.id)
        for oid, ids in sorted(groups.items()):
            issues.append({
                "level": "error",
                "table": table,
                "field": field,
                "ref_id": oid,
                "row_ids": ids,
                "message": f"{label} #{oid} 已不存在，{len(ids)} 条记录引用它（ID: {', '.join(map(str, ids[:8]))}{'...' if len(ids) > 8 else ''}）",
                "fix": ("删除这些孤儿记录" if fixable
                        else f"该{table}记录的{field}需重新指定，或恢复对应主数据"),
                "fixable": fixable,
                "fix_action": action,
            })

    # 单据引用已删除的往来单位 —— 不能自动删，涉及业务数据
    check("purchase_orders", db.query(PurchaseOrder).all(), "supplier_id", sup_ids, "供应商")
    check("sales_orders", db.query(SalesOrder).all(), "customer_id", cus_ids, "客户")
    check("sale_returns", db.query(SaleReturn).all(), "customer_id", cus_ids, "客户")
    check("purchase_returns", db.query(PurchaseReturn).all(), "supplier_id", sup_ids, "供应商")

    # 库存指向已删除的商品/仓库 —— 可自动清理
    check("inventory", db.query(Inventory).all(), "product_id", prod_ids, "商品",
          fixable=True, action="delete_orphan_inventory")
    check("inventory", db.query(Inventory).all(), "warehouse_id", wh_ids, "仓库",
          fixable=True, action="delete_orphan_inventory")

    # 库存流水是历史留痕，不自动删
    check("stock_logs", db.query(StockLog).all(), "product_id", prod_ids, "商品")
    check("stock_logs", db.query(StockLog).all(), "warehouse_id", wh_ids, "仓库")

    # 负库存
    neg_rows = db.query(Inventory).filter(Inventory.quantity < 0).all()
    if neg_rows:
        issues.append({
            "level": "error", "table": "inventory",
            "message": f"{len(neg_rows)} 条库存记录为负数（ID: {', '.join(str(r.id) for r in neg_rows[:8])}）",
            "fix": "执行库存盘点调整",
            "fixable": False, "fix_action": None,
        })

    # 单据金额与明细合计不符 —— 可自动重算
    for po in db.query(PurchaseOrder).all():
        s = sum(float(i.amount or 0) for i in po.items)
        if po.items and abs(s - float(po.total_amount or 0)) > 0.01:
            issues.append({
                "level": "warn", "table": "purchase_orders",
                "message": f"采购单 {po.order_no} 明细合计 {s:.2f} ≠ 单据金额 {float(po.total_amount or 0):.2f}",
                "fix": f"按明细重算为 {s:.2f}",
                "fixable": True, "fix_action": "recalc_order_amount",
                "row_ids": [po.id],
            })
    for so in db.query(SalesOrder).all():
        s = sum(float(i.amount or 0) for i in so.items)
        if so.items and abs(s - float(so.total_amount or 0)) > 0.01:
            issues.append({
                "level": "warn", "table": "sales_orders",
                "message": f"销售单 {so.order_no} 明细合计 {s:.2f} ≠ 单据金额 {float(so.total_amount or 0):.2f}",
                "fix": f"按明细重算为 {s:.2f}",
                "fixable": True, "fix_action": "recalc_order_amount",
                "row_ids": [so.id],
            })

    # 无仓库
    if not wh_ids:
        issues.append({
            "level": "error", "table": "warehouses",
            "message": "系统无仓库记录，入库/出库将失败",
            "fix": "新增至少一个仓库", "fixable": False, "fix_action": None,
        })

    return issues


@router.get("/health-check")
async def health_check(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """检查孤儿外键与异常数据"""
    issues = _collect_issues(db)
    return {
        "ok": len([i for i in issues if i["level"] == "error"]) == 0,
        "error_count": len([i for i in issues if i["level"] == "error"]),
        "warn_count": len([i for i in issues if i["level"] == "warn"]),
        "fixable_count": len([i for i in issues if i.get("fixable")]),
        "issues": issues,
    }


@router.post("/health-check/fix")
async def health_check_fix(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """修复可自动处理的问题。不可自动修复的（孤儿单据）保持原样并列出。"""
    issues = _collect_issues(db)
    fixed = []

    for it in issues:
        if not it.get("fixable"):
            continue

        action = it.get("fix_action")

        if action == "delete_orphan_inventory":
            rows = db.query(Inventory).filter(Inventory.id.in_(it["row_ids"])).all()
            for r in rows:
                db.delete(r)
            fixed.append(f"删除孤儿库存 {len(rows)} 条（{it['message'].split('，')[0]}）")

        elif action == "recalc_order_amount":
            oid = it["row_ids"][0]
            if it["table"] == "purchase_orders":
                o = db.query(PurchaseOrder).filter(PurchaseOrder.id == oid).first()
                if o:
                    total = sum(float(i.amount or 0) for i in o.items)
                    o.total_amount = total
                    fixed.append(f"采购单 {o.order_no} 金额重算为 {total:.2f}")
            elif it["table"] == "sales_orders":
                o = db.query(SalesOrder).filter(SalesOrder.id == oid).first()
                if o:
                    total = sum(float(i.amount or 0) for i in o.items)
                    o.total_amount = total
                    fixed.append(f"销售单 {o.order_no} 金额重算为 {total:.2f}")

    if fixed:
        log_op(db, current_user, "数据自检", "自动修复", f"{len(fixed)} 项",
               "；".join(fixed)[:500])
        db.commit()

    remaining = _collect_issues(db)
    manual = [i for i in remaining if not i.get("fixable")]

    return {
        "fixed_count": len(fixed),
        "fixed": fixed,
        "manual_count": len(manual),
        "manual": [i["message"] for i in manual],
        "ok": len([i for i in remaining if i["level"] == "error"]) == 0,
    }


# ==================== 操作日志 ====================

@router.get("/logs")
async def get_logs(page: int = 1, page_size: int = 20, module: Optional[str] = None,
                   keyword: Optional[str] = None,
                   db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(OperationLog)
    if module:
        q = q.filter(OperationLog.module == module)
    if keyword:
        q = q.filter(
            OperationLog.target.contains(keyword) |
            OperationLog.action.contains(keyword) |
            OperationLog.username.contains(keyword)
        )
    total = q.count()
    rows = q.order_by(OperationLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    items = [{
        "id": r.id,
        "user_id": r.user_id,
        "username": r.username or "anonymous",
        "module": r.module,
        "action": r.action,
        "target": r.target or "",
        "detail": r.detail or "",
        "ip": r.ip or "",
        "created_at": r.created_at,
    } for r in rows]

    return PaginatedResponse(total=total, page=page, page_size=page_size, items=items)


# ==================== 导出 CSV ====================

def _csv_response(filename, header, rows):
    buf = io.StringIO()
    buf.write("\ufeff")  # BOM，Excel 中文不乱码
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow(r)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/{kind}")
async def export_csv(kind: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    stamp = datetime.now().strftime("%Y%m%d%H%M")

    if kind == "inventory":
        rows = db.query(Inventory, Product, Warehouse).join(
            Product, Inventory.product_id == Product.id).join(
            Warehouse, Inventory.warehouse_id == Warehouse.id).all()
        return _csv_response(f"inventory_{stamp}.csv",
                             ["商品", "商品编码", "仓库", "数量", "成本价", "金额", "最低库存"],
                             [[p.name, p.sku or "", w.name, i.quantity,
                               float(p.purchase_price or 0),
                               float(i.quantity) * float(p.purchase_price or 0),
                               p.min_stock] for i, p, w in rows])

    if kind == "sales":
        rows = db.query(SalesOrder).order_by(SalesOrder.id.desc()).all()
        out = []
        for o in rows:
            c = db.query(Customer).filter(Customer.id == o.customer_id).first()
            out.append([o.order_no, c.name if c else "", float(o.total_amount),
                        ["待审核", "已审核", "已出库", "已作废"][o.status],
                        o.invoice_no or "", o.delivery_address or "",
                        o.created_at.strftime("%Y-%m-%d %H:%M") if o.created_at else ""])
        return _csv_response(f"sales_{stamp}.csv",
                             ["销售单号", "客户", "金额", "状态", "发票号", "送货地址", "创建时间"], out)

    if kind == "purchase":
        rows = db.query(PurchaseOrder).order_by(PurchaseOrder.id.desc()).all()
        out = []
        for o in rows:
            s = db.query(Supplier).filter(Supplier.id == o.supplier_id).first()
            out.append([o.order_no, s.name if s else "", float(o.total_amount),
                        ["待审核", "已审核", "已入库", "已作废"][o.status],
                        o.invoice_no or "", o.created_at.strftime("%Y-%m-%d %H:%M") if o.created_at else ""])
        return _csv_response(f"purchase_{stamp}.csv",
                             ["采购单号", "供应商", "金额", "状态", "发票号", "创建时间"], out)

    if kind == "stocklog":
        rows = db.query(StockLog).order_by(StockLog.id.desc()).limit(5000).all()
        out = []
        for s in rows:
            p = db.query(Product).filter(Product.id == s.product_id).first()
            w = db.query(Warehouse).filter(Warehouse.id == s.warehouse_id).first()
            out.append([s.id, p.name if p else "", w.name if w else "", s.type,
                        s.quantity, s.before_quantity, s.after_quantity,
                        s.related_no or "", s.created_at.strftime("%Y-%m-%d %H:%M") if s.created_at else ""])
        return _csv_response(f"stocklog_{stamp}.csv",
                             ["ID", "商品", "仓库", "类型", "数量", "变动前", "变动后", "关联单号", "时间"], out)

    if kind == "payments":
        rows = db.query(Payment).order_by(Payment.id.desc()).limit(5000).all()
        out = []
        for p in rows:
            if p.partner_type == "customer":
                o = db.query(Customer).filter(Customer.id == p.partner_id).first()
            else:
                o = db.query(Supplier).filter(Supplier.id == p.partner_id).first()
            out.append([
                p.payment_no,
                "收款" if p.type == 1 else "付款",
                "客户" if p.partner_type == "customer" else "供应商",
                o.name if o else f"#{p.partner_id}",
                float(p.amount),
                p.payment_method or "",
                p.voucher_no or "",
                p.remark or "",
                p.created_at.strftime("%Y-%m-%d %H:%M") if p.created_at else "",
            ])
        return _csv_response(
            f"payments_{stamp}.csv",
            ["单号", "类型", "对象类型", "往来单位", "金额", "支付方式", "凭证号", "备注", "时间"],
            out)

    if kind == "logs":
        rows = db.query(OperationLog).order_by(OperationLog.id.desc()).limit(5000).all()
        return _csv_response(f"logs_{stamp}.csv",
                             ["ID", "用户", "模块", "动作", "对象", "详情", "时间"],
                             [[l.id, l.username, l.module, l.action, l.target,
                               l.detail or "", l.created_at.strftime("%Y-%m-%d %H:%M") if l.created_at else ""]
                              for l in rows])

    raise HTTPException(404, "不支持的导出类型")
