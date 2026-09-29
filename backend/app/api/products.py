import mimetypes
import os
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import Optional
from ..config import settings
from ..database import get_db
from ..models.product import Product, Category
from ..models.user import User
from ..schemas.product import (ProductCreate, ProductUpdate, ProductResponse,
                               CategoryCreate, CategoryResponse)
from ..schemas.common import ResponseModel, PaginatedResponse
from ..api.deps import get_current_user
from ..core.oplog import log_op

router = APIRouter()

# 这些字段允许为空，空字符串要转成 NULL：
# sku 有唯一索引，多条空字符串会违反 UNIQUE 约束（SQLite 允许多个 NULL）
NULLABLE_IF_BLANK = {
    "sku", "barcode", "spec", "color", "size", "weight",
    "image_url", "remark", "sub_unit",
}


def _clean(data: dict) -> dict:
    """把可选字符串字段的空串/空白转为 None"""
    out = {}
    for k, v in data.items():
        if k in NULLABLE_IF_BLANK and isinstance(v, str):
            v = v.strip() or None
        out[k] = v
    return out


def _integrity_msg(exc: Exception) -> str:
    """把数据库完整性错误翻译成可读提示"""
    text = str(getattr(exc, "orig", exc))
    low = text.lower()
    if "unique" in low or "duplicate" in low:
        if "sku" in low:
            return "商品编码已存在，请更换"
        if "username" in low:
            return "用户名已存在"
        if "email" in low:
            return "邮箱已被使用"
        return "存在重复数据，请检查唯一字段"
    if "foreign key" in low:
        return "关联的分类不存在"
    if "not null" in low:
        return "必填字段不能为空"
    return f"数据保存失败：{text}"


# ==================== 分类 ====================

@router.get("/categories", response_model=list[CategoryResponse])
async def get_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    cats = db.query(Category).filter(Category.status == 1).order_by(Category.sort_order, Category.id).all()
    return [CategoryResponse.from_orm(c) for c in cats]


@router.post("/categories", response_model=CategoryResponse)
async def create_category(
    category_data: CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if db.query(Category).filter(Category.name == category_data.name).first():
        raise HTTPException(status_code=400, detail="分类名称已存在")
    category = Category(**category_data.dict())
    db.add(category)
    log_op(db, current_user, "分类管理", "新增分类", category_data.name)
    db.commit()
    db.refresh(category)
    return CategoryResponse.from_orm(category)


@router.put("/categories/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int,
    category_data: CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="分类不存在")

    dup = db.query(Category).filter(
        Category.name == category_data.name, Category.id != category_id
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="分类名称已存在")

    category.name = category_data.name
    category.sort_order = category_data.sort_order
    log_op(db, current_user, "分类管理", "编辑分类", category_data.name)
    db.commit()
    db.refresh(category)
    return CategoryResponse.from_orm(category)


@router.delete("/categories/{category_id}")
async def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="分类不存在")

    product_count = db.query(Product).filter(Product.category_id == category_id).count()
    if product_count > 0:
        raise HTTPException(status_code=400, detail=f"该分类下有 {product_count} 个商品，无法删除")

    name = category.name
    db.delete(category)
    log_op(db, current_user, "分类管理", "删除分类", name)
    db.commit()
    return ResponseModel(message="删除成功")


# ==================== 商品 ====================

@router.get("", response_model=PaginatedResponse)
async def get_products(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=1000),
    keyword: Optional[str] = None,
    category_id: Optional[int] = None,
    status: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Product)

    if keyword:
        query = query.filter(
            (Product.name.contains(keyword)) |
            (Product.sku.contains(keyword)) |
            (Product.barcode.contains(keyword))
        )
    if category_id:
        query = query.filter(Product.category_id == category_id)
    if status is not None:
        query = query.filter(Product.status == status)

    total = query.count()
    items = query.order_by(Product.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    result = []
    for item in items:
        d = ProductResponse.from_orm(item)
        if item.category_id:
            cat = db.query(Category).filter(Category.id == item.category_id).first()
            d.category_name = cat.name if cat else None
        result.append(d)

    return PaginatedResponse(total=total, page=page, page_size=page_size, items=result)


@router.post("", response_model=ProductResponse)
async def create_product(
    product_data: ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    data = _clean(product_data.dict())

    if data.get("sku") and db.query(Product).filter(Product.sku == data["sku"]).first():
        raise HTTPException(status_code=400, detail="商品编码已存在")

    product = Product(**data)
    db.add(product)
    try:
        log_op(db, current_user, "商品管理", "新增商品", data.get("name") or "")
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=_integrity_msg(e))
    db.refresh(product)
    return ProductResponse.from_orm(product)


@router.post("/upload-image")
async def upload_product_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """上传商品图片，返回可访问的相对 URL"""
    ALLOWED = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"}
    MAX_BYTES = 5 * 1024 * 1024      # 5 MB

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的图片格式：{content_type or '未知'}，仅支持 JPG / PNG / GIF / WEBP / BMP"
        )

    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"图片不能超过 5 MB（当前 {len(data)/1024/1024:.1f} MB）")
    if not data:
        raise HTTPException(status_code=400, detail="文件内容为空")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}:
        ext = mimetypes.guess_extension(content_type) or ".jpg"

    name = f"{datetime.now().strftime('%Y%m%d')}_{uuid.uuid4().hex[:12]}{ext}"
    dest_dir = settings.UPLOAD_DIR / "products"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / name

    with open(dest, "wb") as f:
        f.write(data)

    url = f"/uploads/products/{name}"
    log_op(db, current_user, "商品管理", "上传图片", name, f"{len(data)} bytes")
    db.commit()

    return {"url": url, "name": name, "size": len(data)}


@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    return ProductResponse.from_orm(product)


@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    product_data: ProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")

    data = _clean(product_data.dict(exclude_unset=True))

    if data.get("sku") and data["sku"] != product.sku:
        if db.query(Product).filter(Product.sku == data["sku"]).first():
            raise HTTPException(status_code=400, detail="商品编码已存在")

    for key, value in data.items():
        setattr(product, key, value)

    try:
        log_op(db, current_user, "商品管理", "编辑商品", product.name or "")
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=_integrity_msg(e))
    db.refresh(product)
    return ProductResponse.from_orm(product)


@router.delete("/{product_id}")
async def delete_product(
    product_id: int,
    force: bool = Query(False, description="连同库存记录一并删除（历史单据仍会保留）"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")

    # ---- 引用检查：防止产生孤儿数据 ----
    from ..models.purchase import PurchaseItem
    from ..models.sales import SalesItem
    from ..models.inventory import Inventory
    from ..models.returns import SaleReturnItem, PurchaseReturnItem

    refs = []
    n = db.query(PurchaseItem).filter(PurchaseItem.product_id == product_id).count()
    if n: refs.append(f"{n} 条采购明细")
    n = db.query(SalesItem).filter(SalesItem.product_id == product_id).count()
    if n: refs.append(f"{n} 条销售明细")
    n = db.query(SaleReturnItem).filter(SaleReturnItem.product_id == product_id).count()
    if n: refs.append(f"{n} 条销售退货明细")
    n = db.query(PurchaseReturnItem).filter(PurchaseReturnItem.product_id == product_id).count()
    if n: refs.append(f"{n} 条采购退货明细")

    if refs:
        raise HTTPException(
            status_code=400,
            detail=f"该商品已被以下单据引用，无法删除：{'、'.join(refs)}。"
                   f"如需停用请改为「禁用」状态。"
        )

    inv_rows = db.query(Inventory).filter(Inventory.product_id == product_id).all()
    nonzero = [r for r in inv_rows if r.quantity != 0]
    if nonzero and not force:
        total = sum(r.quantity for r in nonzero)
        raise HTTPException(
            status_code=400,
            detail=f"该商品在 {len(nonzero)} 个仓库尚有库存共 {total}，"
                   f"请先出库或盘点清零后再删除"
        )

    # 清理库存记录（均为 0 或已确认强制）
    for r in inv_rows:
        db.delete(r)

    name = product.name
    db.delete(product)
    log_op(db, current_user, "商品管理", "删除商品", name,
           f"清理库存 {len(inv_rows)} 条" + ("(强制)" if force else ""))
    db.commit()
    return ResponseModel(message="删除成功")
