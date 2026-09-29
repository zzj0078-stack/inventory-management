from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal


class PurchaseItemCreate(BaseModel):
    product_id: int
    quantity: int
    price: Decimal
    tax_rate: Optional[Decimal] = 0      # 增值税率（%）
    remark: Optional[str] = None         # 行备注


class PurchaseOrderCreate(BaseModel):
    supplier_id: int
    items: List[PurchaseItemCreate]

    # 单据基础信息
    purchase_date: Optional[date] = None      # 采购日期（不传则取当天）
    warehouse_id: Optional[int] = None        # 收货仓库（不传则用默认仓库）
    buyer: Optional[str] = None               # 采购员
    expected_date: Optional[date] = None      # 要求到货日

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

    @field_validator("purchase_date", "expected_date", mode="before")
    @classmethod
    def _blank_date_to_none(cls, v):
        """日期选择器清空后前端会传空字符串，需归一为 None"""
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return v

    @field_validator("currency", "payment_method", "payment_terms", "buyer",
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


class PurchaseReceiveItem(BaseModel):
    item_id: int
    quantity: int


class PurchaseReceiveRequest(BaseModel):
    """分批收货：只传本次实际到货的数量"""
    items: List[PurchaseReceiveItem]
    warehouse_id: Optional[int] = None
    remark: Optional[str] = None


class PurchaseItemResponse(BaseModel):
    id: int
    product_id: int
    quantity: int
    price: Decimal
    tax_rate: Optional[Decimal] = None
    amount: Decimal
    received_quantity: int
    remark: Optional[str] = None
    created_at: datetime

    # 商品信息（由接口填充）
    product_name: Optional[str] = None
    product_spec: Optional[str] = None
    product_unit: Optional[str] = None
    product_sku: Optional[str] = None
    pending_quantity: Optional[int] = None    # 待收数量 = quantity - received_quantity

    class Config:
        from_attributes = True


class PurchaseOrderResponse(BaseModel):
    id: int
    order_no: str
    supplier_id: int

    purchase_date: Optional[date] = None
    warehouse_id: Optional[int] = None
    buyer: Optional[str] = None
    expected_date: Optional[date] = None

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
    items: List[PurchaseItemResponse] = []

    # 关联信息
    supplier_name: Optional[str] = None
    supplier_contact: Optional[str] = None
    supplier_phone: Optional[str] = None
    warehouse_name: Optional[str] = None
    creator_name: Optional[str] = None
    status_text: Optional[str] = None

    # 列表页展示用
    product_summary: Optional[str] = None    # 明细商品名称摘要
    spec_summary: Optional[str] = None       # 明细规格型号摘要
    item_count: Optional[int] = None

    class Config:
        from_attributes = True
