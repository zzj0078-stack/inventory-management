"""API 子路由汇总（不做 include_router，由 main.py 直接挂载）"""
from .auth import router as auth_router
from .auth_extended import router as auth_ext_router
from .users import router as users_router
from .suppliers import router as suppliers_router
from .customers import router as customers_router
from .products import router as products_router
from .purchase import router as purchase_router
from .sales import router as sales_router
from .inventory import router as inventory_router
from .extended import router as extended_router

# (前缀, 路由, 标签)
SUB_ROUTERS = [
    ("/auth", auth_router, "认证"),
    ("/auth", auth_ext_router, "权限与角色"),
    ("/users", users_router, "用户"),
    ("/suppliers", suppliers_router, "供应商"),
    ("/customers", customers_router, "客户"),
    ("/products", products_router, "商品"),
    ("/purchase", purchase_router, "采购"),
    ("/sales", sales_router, "销售"),
    ("/inventory", inventory_router, "库存"),
    ("/ext", extended_router, "扩展功能"),
]

# 兼容旧引用
api_router = None

__all__ = ["SUB_ROUTERS", "api_router",
           "auth_router", "auth_ext_router", "users_router", "suppliers_router",
           "customers_router", "products_router", "purchase_router", "sales_router",
           "inventory_router", "extended_router"]
