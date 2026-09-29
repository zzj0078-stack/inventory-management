from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from ..database import Base
from ..core.timeutil import now_local


# 采购单状态
# 0 草稿        建档未提交
# 1 已审核      可入库
# 2 部分收货    有入库但未收齐
# 3 已收货      全部收齐
# 4 已关闭      作废/终止
# 5 部分退货    已收货，部分商品退回
# 6 已退货      已收货，商品全部退回
STATUS_DRAFT = 0
STATUS_APPROVED = 1
STATUS_PARTIAL = 2
STATUS_RECEIVED = 3
STATUS_CLOSED = 4
STATUS_PARTIAL_RETURNED = 5
STATUS_RETURNED = 6

STATUS_TEXT = {
    STATUS_DRAFT: "草稿",
    STATUS_APPROVED: "已审核",
    STATUS_PARTIAL: "部分收货",
    STATUS_RECEIVED: "已收货",
    STATUS_CLOSED: "已关闭",
    STATUS_PARTIAL_RETURNED: "部分退货",
    STATUS_RETURNED: "已退货",
}

# 计入采购额统计的状态：含退货状态，退货金额单独冲减
STATUS_ACTIVE = [STATUS_APPROVED, STATUS_PARTIAL, STATUS_RECEIVED,
                 STATUS_PARTIAL_RETURNED, STATUS_RETURNED]


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True, index=True)
    order_no = Column(String(50), unique=True, nullable=False, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"))

    # 单据基础信息
    purchase_date = Column(Date)                                   # 采购日期
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"))    # 收货仓库
    buyer = Column(String(50))                                     # 采购员
    expected_date = Column(Date)                                   # 要求到货日

    # 结算信息
    payment_method = Column(String(30))                            # 现款 / 月结 / 货到付款
    payment_terms = Column(String(50))                             # 账期，如 "30天"
    currency = Column(String(10), default="CNY")                   # 币种
    exchange_rate = Column(Numeric(12, 4), default=1)              # 汇率

    # 金额
    tax_amount = Column(Numeric(12, 2), default=0)                 # 税额
    freight = Column(Numeric(12, 2), default=0)                    # 运费
    total_amount = Column(Numeric(12, 2), default=0)               # 价税运费合计

    status = Column(Integer, default=STATUS_DRAFT)
    approve_by = Column(Integer, ForeignKey("users.id"))
    approve_at = Column(DateTime(timezone=True))
    delivery_address = Column(String(500))                         # 交货地址
    invoice_no = Column(String(50))                                # 发票号
    remark = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=now_local)
    updated_at = Column(DateTime(timezone=True), onupdate=now_local)

    supplier = relationship("Supplier")
    creator = relationship("User", foreign_keys=[created_by])
    items = relationship("PurchaseItem", back_populates="order", cascade="all, delete-orphan")


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("purchase_orders.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    quantity = Column(Integer, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    tax_rate = Column(Numeric(5, 2), default=0)     # 增值税率，13 表示 13%
    amount = Column(Numeric(12, 2), nullable=False)  # 金额小计 = 数量 × 单价
    received_quantity = Column(Integer, default=0)   # 累计入库数量（支持分批）
    remark = Column(String(200))                     # 行备注
    created_at = Column(DateTime(timezone=True), default=now_local)

    order = relationship("PurchaseOrder", back_populates="items")
    product = relationship("Product")
