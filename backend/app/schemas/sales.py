from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal


class SalesItemCreate(BaseModel):
    product_id: int
    quantity: int
    price: Decimal
    tax_rate: Optional[Decimal] = 0      # 增值税率（%）
    remark: Optional[str] = None         # 行备注


class SalesOrderCreate(BaseModel):
    customer_id: int
    items: List[SalesItemCreate]

    # 单据基础信息
    sale_date: Optional[date] = None          # 销售日期（不传则取当天）
    warehouse_id: Optional[int] = None        # 发货仓库（不传则用默认仓库）
    seller: Optional[str] = None              # 销售员
    delivery_date: Optional[date] = None      # 交货/发货日期

    # 结算信息
    payment_method: Optional[str] = None
    payment_terms: Optional[str] = None
    currency: Optional[str] = "CNY"
    exchange_rate: Optional[Decimal] = 1

    # 金额
    tax_amount: Optional[Decimal] = 0
    freight: Optional[Decimal] = 0

    remark: Optional[str] = None
    delivery_address: Optional[str] = None
    invoice_no: Optional[str] = None

    @field_validator("sale_date", "delivery_date", mode="before")
    @classmethod
    def _blank_date_to_none(cls, v):
        """日期选择器清空后前端会传空字符串，需归一为 None"""
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return v

    @field_validator("currency", "payment_method", "payment_terms", "seller",
                     "remark", "delivery_address", "invoice_no", mode="before")
    @classmethod
    def _blank_str_to_none(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("exchange_rate", "tax_amount", "freight", mode="before")
    @classmethod
    def _blank_num(cls, v):
        if v is None or v == "":
            return None
        return v


class SalesShipItem(BaseModel):
    item_id: int
    quantity: int


class SalesShipRequest(BaseModel):
    """分批发货：只传本次实际出库的数量"""
    items: List[SalesShipItem]
    warehouse_id: Optional[int] = None
    remark: Optional[str] = None


class SalesItemResponse(BaseModel):
    id: int
    product_id: int
    quantity: int
    price: Decimal
    tax_rate: Optional[Decimal] = None
    amount: Decimal
    shipped_quantity: int
    remark: Optional[str] = None
    created_at: datetime

    # 商品信息（由接口填充）
    product_name: Optional[str] = None
    product_spec: Optional[str] = None
    product_unit: Optional[str] = None
    product_sku: Optional[str] = None
    pending_quantity: Optional[int] = None    # 待发数量

    class Config:
        from_attributes = True


class SalesOrderResponse(BaseModel):
    id: int
    order_no: str
    customer_id: int

    sale_date: Optional[date] = None
    warehouse_id: Optional[int] = None
    seller: Optional[str] = None
    delivery_date: Optional[date] = None

    payment_method: Optional[str] = None
    payment_terms: Optional[str] = None
    currency: Optional[str] = None
    exchange_rate: Optional[Decimal] = None

    tax_amount: Optional[Decimal] = None
    freight: Optional[Decimal] = None
    total_amount: Decimal

    status: int
    approve_by: Optional[int]
    approve_at: Optional[datetime]
    remark: Optional[str]
    delivery_address: Optional[str] = None
    invoice_no: Optional[str] = None
    created_by: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]
    items: List[SalesItemResponse] = []

    customer_name: Optional[str] = None
    customer_contact: Optional[str] = None
    customer_phone: Optional[str] = None
    warehouse_name: Optional[str] = None
    creator_name: Optional[str] = None
    status_text: Optional[str] = None

    # 列表页展示用
    product_summary: Optional[str] = None    # 明细商品名称摘要
    spec_summary: Optional[str] = None       # 明细规格型号摘要
    item_count: Optional[int] = None

    class Config:
        from_attributes = True
