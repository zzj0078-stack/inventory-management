from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class WarehouseCreate(BaseModel):
    name: str
    address: Optional[str] = None
    manager: Optional[str] = None
    phone: Optional[str] = None


class WarehouseResponse(BaseModel):
    id: int
    name: str
    address: Optional[str]
    manager: Optional[str]
    phone: Optional[str]
    status: int
    created_at: datetime
    
    class Config:
        from_attributes = True


class InventoryResponse(BaseModel):
    id: int
    product_id: int
    warehouse_id: int
    quantity: int
    updated_at: Optional[datetime]
    
    # 关联信息
    product_name: Optional[str] = None
    product_sku: Optional[str] = None
    warehouse_name: Optional[str] = None
    min_stock: Optional[int] = 0
    
    class Config:
        from_attributes = True
