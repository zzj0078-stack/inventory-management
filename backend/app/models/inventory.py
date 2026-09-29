from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base
from ..core.timeutil import now_local


class Warehouse(Base):
    __tablename__ = "warehouses"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    address = Column(String(200))
    manager = Column(String(50))
    phone = Column(String(20))
    status = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), default=now_local)
    
    inventories = relationship("Inventory", back_populates="warehouse")


class Inventory(Base):
    __tablename__ = "inventory"
    
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"))
    quantity = Column(Integer, default=0)
    updated_at = Column(DateTime(timezone=True), onupdate=now_local)
    
    product = relationship("Product")
    warehouse = relationship("Warehouse", back_populates="inventories")
    
    __table_args__ = (
        UniqueConstraint('product_id', 'warehouse_id', name='uq_product_warehouse'),
    )
