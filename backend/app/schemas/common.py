from pydantic import BaseModel
from typing import Optional, Any, List
from datetime import datetime


class ResponseModel(BaseModel):
    code: int = 200
    message: str = "success"
    data: Optional[Any] = None


class PaginationParams(BaseModel):
    page: int = 1
    page_size: int = 20
    keyword: Optional[str] = None


class PaginatedResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[Any]
    # 可选汇总，调用方按需填充（如退货列表的金额合计）
    summary: Optional[Any] = None
