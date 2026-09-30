from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class UserCreate(BaseModel):
    username: str
    # 邮箱选填
    email: Optional[str] = None
    password: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role_id: Optional[int] = None


class UserUpdate(BaseModel):
    """编辑用户：全部可选，password 为空表示不改密码"""
    username: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role_id: Optional[int] = None
    status: Optional[int] = None


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    # 邮箱选填
    email: Optional[str] = None
    full_name: Optional[str]
    phone: Optional[str]
    role_id: Optional[int]
    status: int
    created_at: datetime

    # 关联信息（接口填充）
    role_name: Optional[str] = None
    role_label: Optional[str] = None
    permission_count: Optional[int] = None
    is_admin: Optional[bool] = None

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
