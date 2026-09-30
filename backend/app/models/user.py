from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base
from ..core.timeutil import now_local


class Role(Base):
    __tablename__ = "roles"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(String(200))
    created_at = Column(DateTime(timezone=True), default=now_local)
    
    users = relationship("User", back_populates="role")
    perms = relationship("Permission", secondary="role_permissions", backref="roles")


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    # 邮箱选填；留空存 NULL（不能用空串，否则多条空邮箱会撞唯一索引）
    email = Column(String(100), unique=True, nullable=True)
    password_hash = Column(String(200), nullable=False)
    full_name = Column(String(50))
    phone = Column(String(20))
    role_id = Column(Integer, ForeignKey("roles.id"))
    status = Column(Integer, default=1)  # 1: 启用, 0: 禁用
    created_at = Column(DateTime(timezone=True), default=now_local)
    updated_at = Column(DateTime(timezone=True), onupdate=now_local)
    
    role = relationship("Role", back_populates="users")
