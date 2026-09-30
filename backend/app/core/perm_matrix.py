r"""集中式接口权限矩阵 + 校验中间件

为什么用中间件而不是逐个 Depends：
  - 90+ 接口，逐个加依赖容易漏、改动面大
  - 集中定义，新增接口只需加一行规则
  - 未命中规则的接口默认「登录即可访问」

规则格式：(HTTP 方法列表, 路径正则, 需要的权限码)
路径正则以 /api 开头，用 \d+ 匹配路径参数。
"""
import json
import re
from fastapi import Request
from fastapi.responses import JSONResponse

from .security import decode_access_token
from .perm_deps import get_user_permissions

# --------------------------------------------------------------------------
# 权限矩阵
# --------------------------------------------------------------------------
RULES = [
    # ---------------- 首页 ----------------
    (["GET"], r"^/api/ext/dashboard$", "dashboard:view"),
    (["GET"], r"^/api/ext/sales-daily$", "dashboard:view"),

    # ---------------- 供应商 ----------------
    (["GET"], r"^/api/suppliers$", "supplier:view"),
    (["GET"], r"^/api/suppliers/\d+$", "supplier:view"),
    (["GET"], r"^/api/suppliers/\d+/outstanding$", "supplier:view"),
    (["POST"], r"^/api/suppliers$", "supplier:add"),
    (["PUT"], r"^/api/suppliers/\d+$", "supplier:edit"),
    (["DELETE"], r"^/api/suppliers/\d+$", "supplier:delete"),

    # ---------------- 客户 ----------------
    (["GET"], r"^/api/customers$", "customer:view"),
    (["GET"], r"^/api/customers/\d+$", "customer:view"),
    (["GET"], r"^/api/customers/\d+/outstanding$", "customer:view"),
    (["POST"], r"^/api/customers$", "customer:add"),
    (["PUT"], r"^/api/customers/\d+$", "customer:edit"),
    (["DELETE"], r"^/api/customers/\d+$", "customer:delete"),

    # ---------------- 商品 / 分类 ----------------
    (["GET"], r"^/api/products$", "product:view"),
    (["GET"], r"^/api/products/\d+$", "product:view"),
    (["POST"], r"^/api/products$", "product:add"),
    (["PUT"], r"^/api/products/\d+$", "product:edit"),
    (["DELETE"], r"^/api/products/\d+$", "product:delete"),
    (["GET"], r"^/api/products/categories$", "category:view"),
    (["POST"], r"^/api/products/categories$", "category:add"),
    (["PUT"], r"^/api/products/categories/\d+$", "category:edit"),
    (["DELETE"], r"^/api/products/categories/\d+$", "category:delete"),
    (["POST"], r"^/api/products/upload-image$", ["product:add", "product:edit"]),

    # ---------------- 采购 ----------------
    (["GET"], r"^/api/purchase$", "purchase:view"),
    (["GET"], r"^/api/purchase/\d+$", "purchase:view"),
    (["POST"], r"^/api/purchase$", "purchase:add"),
    (["PUT"], r"^/api/purchase/\d+$", "purchase:edit"),
    (["DELETE"], r"^/api/purchase/\d+$", "purchase:delete"),
    (["PUT"], r"^/api/purchase/\d+/approve$", "purchase:approve"),
    (["PUT"], r"^/api/purchase/\d+/receive$", "purchase:receive"),
    (["PUT"], r"^/api/purchase/\d+/cancel$", "purchase:cancel"),

    # ---------------- 销售 ----------------
    (["GET"], r"^/api/sales$", "sales:view"),
    (["GET"], r"^/api/sales/\d+$", "sales:view"),
    (["POST"], r"^/api/sales$", "sales:add"),
    (["PUT"], r"^/api/sales/\d+$", "sales:edit"),
    (["DELETE"], r"^/api/sales/\d+$", "sales:delete"),
    (["PUT"], r"^/api/sales/\d+/approve$", "sales:approve"),
    (["PUT"], r"^/api/sales/\d+/ship$", "sales:ship"),
    (["PUT"], r"^/api/sales/\d+/cancel$", "sales:cancel"),

    # ---------------- 库存 / 仓库 ----------------
    # 读库存/仓库是「调拨、盘点、退货、采购入库」等业务的固有前提，
    # 因此这些读接口允许相关模块的权限通过，避免因缺 inventory:view 而卡死业务。
    (["GET"], r"^/api/inventory$", ["inventory:view", "transfer:view", "stockcheck:view",
                                   "purchase:view", "sales:view"]),
    (["GET"], r"^/api/inventory/stock-check$", ["inventory:view", "stockcheck:view"]),
    (["GET"], r"^/api/inventory/warehouses$", ["warehouse:view", "inventory:view",
                                               "transfer:view", "stockcheck:view",
                                               "purchase:view", "sales:view",
                                               "purchase_return:view", "sale_return:view"]),
    (["POST"], r"^/api/inventory/warehouses$", "warehouse:add"),
    (["PUT"], r"^/api/inventory/warehouses/\d+$", "warehouse:edit"),
    (["DELETE"], r"^/api/inventory/warehouses/\d+$", "warehouse:delete"),

    # ---------------- 销售退货 ----------------
    (["GET"], r"^/api/ext/sale-returns$", "sale_return:view"),
    (["GET"], r"^/api/ext/sale-returns/returnable$", "sale_return:view"),
    (["GET"], r"^/api/ext/sale-returns/available/\d+$", "sale_return:view"),
    (["POST"], r"^/api/ext/sale-returns$", "sale_return:add"),
    (["PUT"], r"^/api/ext/sale-returns/\d+/approve$", "sale_return:approve"),
    (["PUT"], r"^/api/ext/sale-returns/\d+/receive$", "sale_return:receive"),
    (["PUT"], r"^/api/ext/sale-returns/\d+/cancel$", "sale_return:cancel"),

    # ---------------- 采购退货 ----------------
    (["GET"], r"^/api/ext/purchase-returns$", "purchase_return:view"),
    (["GET"], r"^/api/ext/purchase-returns/returnable$", "purchase_return:view"),
    (["GET"], r"^/api/ext/purchase-returns/available/\d+$", "purchase_return:view"),
    (["POST"], r"^/api/ext/purchase-returns$", "purchase_return:add"),
    (["PUT"], r"^/api/ext/purchase-returns/\d+/approve$", "purchase_return:approve"),
    (["PUT"], r"^/api/ext/purchase-returns/\d+/ship$", "purchase_return:ship"),
    (["PUT"], r"^/api/ext/purchase-returns/\d+/cancel$", "purchase_return:cancel"),

    # ---------------- 收付款 ----------------
    (["GET"], r"^/api/ext/payments$", "finance:view"),
    (["GET"], r"^/api/ext/receivables$", "finance:view"),
    (["POST"], r"^/api/ext/payments$", "finance:add"),
    (["PUT"], r"^/api/ext/payments/\d+$", "finance:edit"),
    (["DELETE"], r"^/api/ext/payments/\d+$", "finance:delete"),

    # ---------------- 出入库明细 ----------------
    (["GET"], r"^/api/ext/stock-logs$", "stocklog:view"),
    (["GET"], r"^/api/ext/stock-logs/stat$", "stocklog:view"),
    (["POST"], r"^/api/ext/stock-logs/init$", "stocklog:init"),

    # ---------------- 库存调拨 ----------------
    (["GET"], r"^/api/ext/stock-transfers$", "transfer:view"),
    (["GET"], r"^/api/ext/stock-transfers/\d+$", "transfer:view"),
    (["POST"], r"^/api/ext/stock-transfers$", "transfer:add"),
    (["PUT"], r"^/api/ext/stock-transfers/\d+/approve$", "transfer:approve"),
    (["PUT"], r"^/api/ext/stock-transfers/\d+/cancel$", "transfer:cancel"),

    # ---------------- 库存盘点 ----------------
    (["GET"], r"^/api/ext/stock-checks$", "stockcheck:view"),
    (["GET"], r"^/api/ext/stock-checks/preview$", "stockcheck:view"),
    (["GET"], r"^/api/ext/stock-checks/\d+$", "stockcheck:view"),
    (["POST"], r"^/api/ext/stock-checks$", "stockcheck:add"),
    (["PUT"], r"^/api/ext/stock-checks/\d+/approve$", "stockcheck:approve"),
    (["PUT"], r"^/api/ext/stock-checks/\d+/cancel$", "stockcheck:cancel"),

    # ---------------- 报表 ----------------
    (["GET"], r"^/api/ext/reports/.*$", "report:view"),

    # ---------------- 操作日志 ----------------
    (["GET"], r"^/api/ext/logs$", "log:view"),

    # ---------------- 系统维护 ----------------
    (["GET"], r"^/api/ext/health-check$", "system:check"),
    (["POST"], r"^/api/ext/health-check/fix$", "system:fix"),

    # ---------------- 用户 / 角色 ----------------
    # 读取角色列表是「新增/编辑用户」的固有需求，故允许 user:* 或 role:view
    (["GET"], r"^/api/auth/roles$", ["role:view", "user:view", "user:add", "user:edit"]),
    (["GET"], r"^/api/auth/permissions$", ["role:view", "role:add", "role:edit"]),

    (["GET"], r"^/api/users$", "user:view"),
    (["GET"], r"^/api/users/\d+$", "user:view"),
    (["POST"], r"^/api/users$", "user:add"),
    (["PUT"], r"^/api/users/\d+$", "user:edit"),
    (["DELETE"], r"^/api/users/\d+$", "user:delete"),
    (["POST"], r"^/api/auth/reset-password$", "user:resetpwd"),

    (["POST"], r"^/api/auth/roles$", "role:add"),
    (["PUT"], r"^/api/auth/roles/\d+$", "role:edit"),
    (["DELETE"], r"^/api/auth/roles/\d+$", "role:delete"),
]

# 导出：按 kind 映射权限
EXPORT_PERM = {
    "inventory": "inventory:export",
    "sales": "sales:export",
    "purchase": "purchase:export",
    "stocklog": "stocklog:export",
    "logs": "log:export",
    "payments": "finance:export",
}

# 无需登录的路径
PUBLIC = {
    "/api/auth/login",
    "/api/auth/password-rules",
    "/api/health",
}

_compiled = [(methods, re.compile(pat), perm) for methods, pat, perm in RULES]


def _as_list(perm):
    """权限项可以是字符串或列表（列表为 OR 语义）"""
    if perm is None:
        return None
    return [perm] if isinstance(perm, str) else list(perm)


def resolve_required(method: str, path: str):
    """返回该请求需要的权限码列表（OR 语义），None 表示不限制"""
    if path in PUBLIC:
        return None

    m = re.match(r"^/api/ext/export/([^/]+)$", path)
    if m and method == "GET":
        return _as_list(EXPORT_PERM.get(m.group(1), "report:view"))

    for methods, rx, perm in _compiled:
        if method in methods and rx.match(path):
            return _as_list(perm)
    return None


def _permitted(owned: set, needed: list) -> bool:
    if "*" in owned:
        return True
    return any(c in owned for c in needed)


def _need_text(needed: list) -> str:
    return " 或 ".join(needed)


async def permission_middleware(request: Request, call_next):
    """保留函数式写法（兼容），实际使用 PermissionMiddleware"""
    path = request.url.path
    method = request.method

    if (not path.startswith("/api/")
            or method == "OPTIONS"
            or path in PUBLIC):
        return await call_next(request)

    needed = resolve_required(method, path)
    if not needed:
        return await call_next(request)

    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return JSONResponse({"detail": "未登录"}, status_code=401)

    payload = decode_access_token(auth[7:].strip())
    if not payload or not payload.get("sub"):
        return JSONResponse({"detail": "登录已过期，请重新登录"}, status_code=401)

    from ..database import SessionLocal
    from ..models.user import User

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == int(payload["sub"])).first()
        if not user:
            return JSONResponse({"detail": "用户不存在"}, status_code=401)
        if user.status == 0:
            return JSONResponse({"detail": "账号已被禁用"}, status_code=403)

        owned = get_user_permissions(db, user)
        if not _permitted(owned, needed):
            return JSONResponse(
                {"detail": f"权限不足，需要「{_need_text(needed)}」权限"},
                status_code=403,
            )
    finally:
        db.close()

    return await call_next(request)


class PermissionMiddleware:
    """纯 ASGI 中间件：避免 BaseHTTPMiddleware 吞掉下游异常导致 500 无详情。

    装饰器（app.middleware("http")）基于 BaseHTTPMiddleware，
    下游抛异常时不会经过 FastAPI 的 exception_handler，
    前端只能看到空的 500。这里改为原生 ASGI 实现。
    """

    _COMPILED = _compiled

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)

        path = scope.get("path", "")
        method = scope.get("method", "GET")

        if (not path.startswith("/api/")
                or method == "OPTIONS"
                or path in PUBLIC):
            return await self.app(scope, receive, send)

        needed = resolve_required(method, path)
        if not needed:
            return await self.app(scope, receive, send)

        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in scope.get("headers", [])}
        auth = headers.get("authorization", "")

        if not auth.lower().startswith("bearer "):
            return await self._deny(send, 401, "未登录")

        payload = decode_access_token(auth[7:].strip())
        if not payload or not payload.get("sub"):
            return await self._deny(send, 401, "登录已过期，请重新登录")

        from ..database import SessionLocal
        from ..models.user import User

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == int(payload["sub"])).first()
            if not user:
                return await self._deny(send, 401, "用户不存在")
            if user.status == 0:
                return await self._deny(send, 403, "账号已被禁用")

            owned = get_user_permissions(db, user)
            if not _permitted(owned, needed):
                return await self._deny(send, 403, f"权限不足，需要「{_need_text(needed)}」权限")
        finally:
            db.close()

        return await self.app(scope, receive, send)

    @staticmethod
    async def _deny(send, code: int, detail: str):
        body = json.dumps({"detail": detail}, ensure_ascii=False).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": code,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": body})
