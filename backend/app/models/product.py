from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base
from ..core.timeutil import now_local


class Category(Base):
    __tablename__ = "categories"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    parent_id = Column(Integer, ForeignKey("categories.id"))
    sort_order = Column(Integer, default=0)
    status = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), default=now_local)
    
    parent = relationship("Category", remote_side=[id], backref="children")
    products = relationship("Product", back_populates="category")


class Product(Base):
    __tablename__ = "products"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"))
    sku = Column(String(50), unique=True, index=True)
    barcode = Column(String(50))
    unit = Column(String(20), nullable=False)  # 基本单位
    sub_unit = Column(String(20))  # 辅助单位
    sub_unit_ratio = Column(Numeric(10, 2), default=1)  # 换算比例 1箱=12个
    spec = Column(String(200))  # 规格
    color = Column(String(50))  # 颜色
    size = Column(String(50))  # 尺码
    weight = Column(String(50))  # 重量
    purchase_price = Column(Numeric(10, 2), default=0)
    sale_price = Column(Numeric(10, 2), default=0)
    min_stock = Column(Integer, default=0)
    image_url = Column(String(500))  # 商品图片
    status = Column(Integer, default=1)
    remark = Column(String(500))
    created_at = Column(DateTime(timezone=True), default=now_local)
    updated_at = Column(DateTime(timezone=True), onupdate=now_local)
    
    category = relationship("Category", back_populates="products")
