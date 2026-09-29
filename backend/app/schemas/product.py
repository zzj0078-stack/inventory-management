from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from decimal import Decimal


class CategoryCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    sort_order: Optional[int] = 0


class CategoryResponse(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    sort_order: int
    status: int
    created_at: datetime
    
    class Config:
        from_attributes = True


class ProductCreate(BaseModel):
    name: str
    category_id: Optional[int] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    unit: str
    sub_unit: Optional[str] = None
    sub_unit_ratio: Optional[Decimal] = 1
    spec: Optional[str] = None
    color: Optional[str] = None
    size: Optional[str] = None
    weight: Optional[str] = None
    purchase_price: Optional[Decimal] = 0
    sale_price: Optional[Decimal] = 0
    min_stock: Optional[int] = 0
    image_url: Optional[str] = None
    remark: Optional[str] = None


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[int] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    unit: Optional[str] = None
    sub_unit: Optional[str] = None
    sub_unit_ratio: Optional[Decimal] = None
    spec: Optional[str] = None
    color: Optional[str] = None
    size: Optional[str] = None
    weight: Optional[str] = None
    purchase_price: Optional[Decimal] = None
    sale_price: Optional[Decimal] = None
    min_stock: Optional[int] = None
    image_url: Optional[str] = None
    status: Optional[int] = None
    remark: Optional[str] = None


class ProductResponse(BaseModel):
    id: int
    name: str
    category_id: Optional[int]
    sku: Optional[str]
    barcode: Optional[str]
    unit: str
    sub_unit: Optional[str] = None
    sub_unit_ratio: Optional[Decimal] = None
    spec: Optional[str]
    color: Optional[str] = None
    size: Optional[str] = None
    weight: Optional[str] = None
    purchase_price: Decimal
    sale_price: Decimal
    min_stock: int
    image_url: Optional[str] = None
    status: int
    remark: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]
    category_name: Optional[str] = None
    
    class Config:
        from_attributes = True
