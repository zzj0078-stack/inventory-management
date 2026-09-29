from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from ..database import Base
from ..core.timeutil import now_local


class Customer(Base):
    __tablename__ = "customers"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    contact = Column(String(50))
    phone = Column(String(20))
    email = Column(String(100))
    address = Column(Text)
    credit_limit = Column(Integer, default=0)  # 信用额度
    bank_name = Column(String(100))
    bank_account = Column(String(50))
    tax_number = Column(String(50))
    status = Column(Integer, default=1)  # 1: 启用, 0: 禁用
    remark = Column(Text)
    created_at = Column(DateTime(timezone=True), default=now_local)
    updated_at = Column(DateTime(timezone=True), onupdate=now_local)
