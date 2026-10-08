from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from ..database import Base
from ..core.timeutil import now_local


# 销售单状态
# 0 草稿        建档未提交
# 1 已审核      可发货
# 2 部分发货    有出库但未发齐
# 3 已发货      全部发齐
# 4 已关闭      作废/终止
# 5 部分退货    已发货，部分商品退回
# 6 已退货      已发货，商品全部退回
STATUS_DRAFT = 0
STATUS_APPROVED = 1
STATUS_PARTIAL = 2
STATUS_SHIPPED = 3
STATUS_CLOSED = 4
STATUS_PARTIAL_RETURNED = 5
STATUS_RETURNED = 6

STATUS_TEXT = {
    STATUS_DRAFT: "草稿",
    STATUS_APPROVED: "已审核",
    STATUS_PARTIAL: "部分发货",
    STATUS_SHIPPED: "已发货",
    STATUS_CLOSED: "已关闭",
    STATUS_PARTIAL_RETURNED: "部分退货",
    STATUS_RETURNED: "已退货",
}

# 计入销售额统计的状态：含退货状态，退货金额单独冲减，否则净额会算错
STATUS_ACTIVE = [STATUS_APPROVED, STATUS_PARTIAL, STATUS_SHIPPED,
                 STATUS_PARTIAL_RETURNED, STATUS_RETURNED]


class SalesOrder(Base):
    __tablename__ = "sales_orders"

    id = Column(Integer, primary_key=True, index=True)
    order_no = Column(String(50), unique=True, nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"))

    # 单据基础信息
    sale_date = Column(Date)                                        # 销售日期
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"))     # 发货仓库
    seller = Column(String(50))                                     # 销售员
    delivery_date = Column(Date)                                    # 交货/发货日期

    # 结算信息
    payment_method = Column(String(30))                             # 现结 / 赊销 / 月结
    payment_terms = Column(String(50))                              # 账期
    currency = Column(String(10), default="CNY")
    exchange_rate = Column(Numeric(12, 4), default=1)

    # 金额
    tax_amount = Column(Numeric(12, 2), default=0)
    freight = Column(Numeric(12, 2), default=0)
    total_amount = Column(Numeric(12, 2), default=0)                # 价税运费合计

    status = Column(Integer, default=STATUS_DRAFT)
    approve_by = Column(Integer, ForeignKey("users.id"))
    approve_at = Column(DateTime(timezone=True))
    remark = Column(Text)
    delivery_address = Column(String(500))
    receiver_name = Column(String(50))    # 接收人姓名
    receiver_phone = Column(String(30))   # 接收人电话
    invoice_no = Column(String(50))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=now_local)
    updated_at = Column(DateTime(timezone=True), onupdate=now_local)

    customer = relationship("Customer")
    creator = relationship("User", foreign_keys=[created_by])
    items = relationship("SalesItem", back_populates="order", cascade="all, delete-orphan")


class SalesItem(Base):
    __tablename__ = "sales_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("sales_orders.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    quantity = Column(Integer, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    tax_rate = Column(Numeric(5, 2), default=0)     # 增值税率，13 表示 13%
    amount = Column(Numeric(12, 2), nullable=False)  # 金额小计 = 数量 × 单价
    shipped_quantity = Column(Integer, default=0)    # 累计出库数量（支持分批发货）
    remark = Column(String(200))                     # 行备注
    created_at = Column(DateTime(timezone=True), default=now_local)

    order = relationship("SalesOrder", back_populates="items")
    product = relationship("Product")
