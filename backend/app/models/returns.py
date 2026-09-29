from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base
from ..core.timeutil import now_local


class SaleReturn(Base):
    __tablename__ = "sale_returns"
    
    id = Column(Integer, primary_key=True, index=True)
    return_no = Column(String(50), unique=True, nullable=False, index=True)
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id"))
    customer_id = Column(Integer, ForeignKey("customers.id"))
    total_amount = Column(Numeric(12, 2), default=0)
    status = Column(Integer, default=0)  # 0:待审核 1:已审核 2:已入库 3:已作废
    reason = Column(Text)
    remark = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=now_local)
    updated_at = Column(DateTime(timezone=True), onupdate=now_local)
    
    sales_order = relationship("SalesOrder")
    customer = relationship("Customer")
    items = relationship("SaleReturnItem", back_populates="return_order", cascade="all, delete-orphan")


class SaleReturnItem(Base):
    __tablename__ = "sale_return_items"
    
    id = Column(Integer, primary_key=True, index=True)
    return_id = Column(Integer, ForeignKey("sale_returns.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    quantity = Column(Integer, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_local)
    
    return_order = relationship("SaleReturn", back_populates="items")
    product = relationship("Product")


class PurchaseReturn(Base):
    __tablename__ = "purchase_returns"
    
    id = Column(Integer, primary_key=True, index=True)
    return_no = Column(String(50), unique=True, nullable=False, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"))
    supplier_id = Column(Integer, ForeignKey("suppliers.id"))
    total_amount = Column(Numeric(12, 2), default=0)
    status = Column(Integer, default=0)  # 0:待审核 1:已审核 2:已出库 3:已作废
    reason = Column(Text)
    remark = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=now_local)
    updated_at = Column(DateTime(timezone=True), onupdate=now_local)
    
    purchase_order = relationship("PurchaseOrder")
    supplier = relationship("Supplier")
    items = relationship("PurchaseReturnItem", back_populates="return_order", cascade="all, delete-orphan")


class PurchaseReturnItem(Base):
    __tablename__ = "purchase_return_items"
    
    id = Column(Integer, primary_key=True, index=True)
    return_id = Column(Integer, ForeignKey("purchase_returns.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    quantity = Column(Integer, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_local)
    
    return_order = relationship("PurchaseReturn", back_populates="items")
    product = relationship("Product")
