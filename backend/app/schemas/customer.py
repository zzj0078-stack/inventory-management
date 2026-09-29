from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class CustomerCreate(BaseModel):
    name: str
    contact: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    credit_limit: Optional[int] = 0
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    tax_number: Optional[str] = None
    remark: Optional[str] = None


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    contact: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    credit_limit: Optional[int] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    tax_number: Optional[str] = None
    status: Optional[int] = None
    remark: Optional[str] = None


class CustomerResponse(BaseModel):
    id: int
    name: str
    contact: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    address: Optional[str]
    credit_limit: int
    bank_name: Optional[str]
    bank_account: Optional[str]
    tax_number: Optional[str]
    status: int
    remark: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]
    
    class Config:
        from_attributes = True
