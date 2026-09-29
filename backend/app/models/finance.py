from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base
from ..core.timeutil import now_local


class Payment(Base):
    """收款单/付款单（单据即凭证，层次2：自动凭证号 + 摘要）"""
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    payment_no = Column(String(50), unique=True, nullable=False, index=True)
    type = Column(Integer, nullable=False)  # 1:收款 2:付款
    related_type = Column(String(20))  # sales_order / purchase_order / sale_return / purchase_return
    related_id = Column(Integer)
    partner_type = Column(String(20))  # customer / supplier
    partner_id = Column(Integer, nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    payment_method = Column(String(50))  # 现金/银行转账/微信/支付宝

    # ---- 凭证（层次2）----
    voucher_no = Column(String(50), index=True)    # 自动生成：记-2026-09-0001
    voucher_date = Column(Date)                    # 凭证日期
    period = Column(String(7))                     # 会计期间 2026-09
    summary = Column(String(200))                  # 摘要（自动生成，可改）
    attachment_count = Column(Integer, default=1)  # 附单据数
    debit_account = Column(String(50))             # 借方科目（提示）
    credit_account = Column(String(50))            # 贷方科目（提示）

    remark = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=now_local)

    creator = relationship("User")


class StockLog(Base):
    """库存出入库明细"""
    __tablename__ = "stock_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"))
    type = Column(String(20), nullable=False)  # purchase_in/sale_out/purchase_return_out/sale_return_in/adjust_in/adjust_out/transfer_in/transfer_out
    quantity = Column(Integer, nullable=False)  # 正数入库 负数出库
    before_quantity = Column(Integer, default=0)
    after_quantity = Column(Integer, default=0)
    related_type = Column(String(20))  # purchase/sale/return/adjust/transfer
    related_id = Column(Integer)
    related_no = Column(String(50))
    remark = Column(Text)
    created_at = Column(DateTime(timezone=True), default=now_local)
    
    product = relationship("Product")
    warehouse = relationship("Warehouse")


class StockTransfer(Base):
    """库存调拨"""
    __tablename__ = "stock_transfers"
    
    id = Column(Integer, primary_key=True, index=True)
    transfer_no = Column(String(50), unique=True, nullable=False, index=True)
    from_warehouse_id = Column(Integer, ForeignKey("warehouses.id"))
    to_warehouse_id = Column(Integer, ForeignKey("warehouses.id"))
    status = Column(Integer, default=0)  # 0:待审核 1:已审核 2:已完成 3:已作废
    remark = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=now_local)
    updated_at = Column(DateTime(timezone=True), onupdate=now_local)
    
    from_warehouse = relationship("Warehouse", foreign_keys=[from_warehouse_id])
    to_warehouse = relationship("Warehouse", foreign_keys=[to_warehouse_id])
    items = relationship("StockTransferItem", back_populates="transfer", cascade="all, delete-orphan")


class StockTransferItem(Base):
    __tablename__ = "stock_transfer_items"
    
    id = Column(Integer, primary_key=True, index=True)
    transfer_id = Column(Integer, ForeignKey("stock_transfers.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    quantity = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_local)
    
    transfer = relationship("StockTransfer", back_populates="items")
    product = relationship("Product")


class OperationLog(Base):
    """操作日志"""
    __tablename__ = "operation_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    username = Column(String(50))
    module = Column(String(50))
    action = Column(String(50))
    target = Column(String(100))
    detail = Column(Text)
    ip = Column(String(50))
    created_at = Column(DateTime(timezone=True), default=now_local)
    
    user = relationship("User")


class StockCheck(Base):
    """库存盘点单"""
    __tablename__ = "stock_checks"
    
    id = Column(Integer, primary_key=True, index=True)
    check_no = Column(String(50), unique=True, nullable=False, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"))
    status = Column(Integer, default=0)  # 0:待审核 1:已审核(已调账) 2:已作废
    remark = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=now_local)
    updated_at = Column(DateTime(timezone=True), onupdate=now_local)
    
    warehouse = relationship("Warehouse")
    items = relationship("StockCheckItem", back_populates="check", cascade="all, delete-orphan")


class StockCheckItem(Base):
    __tablename__ = "stock_check_items"
    
    id = Column(Integer, primary_key=True, index=True)
    check_id = Column(Integer, ForeignKey("stock_checks.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    system_quantity = Column(Integer, default=0)   # 账面数
    actual_quantity = Column(Integer, default=0)   # 实盘数
    diff = Column(Integer, default=0)              # 差异
    created_at = Column(DateTime(timezone=True), default=now_local)
    
    check = relationship("StockCheck", back_populates="items")
    product = relationship("Product")
