from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import traceback

from .config import settings
from .database import engine, Base
from .api import SUB_ROUTERS
from .core.automigrate import auto_migrate, rebuild_table_relaxing_not_null
from .core.router_utils import mount_all
from .core.perm_matrix import PermissionMiddleware

# 建表（新表）+ 补列（旧表）
Base.metadata.create_all(bind=engine)
_added = auto_migrate(engine, Base)
if _added:
    print("[MIGRATE] 已补齐缺失字段：")
    for c in _added:
        print(f"          + {c}")
else:
    print("[MIGRATE] 表结构与模型一致，无需补列")

# 历史库：users.email 曾是 NOT NULL，邮箱改为选填后需去掉该约束
_ok, _msg = rebuild_table_relaxing_not_null(engine, Base.metadata.tables["users"], "email")
if _ok:
    print(f"[MIGRATE] {_msg}")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)

# 中间件顺序：后 add 的在更外层
# 1) 权限校验（内层）
app.add_middleware(PermissionMiddleware)
# 2) CORS（最外层，保证 401/403 等由权限中间件返回的响应也带 CORS 头）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """把未处理异常的真因同时打到控制台和返回给前端，便于定位。"""
    tb = traceback.format_exc()
    print("=" * 70)
    print(f"[500] {request.method} {request.url.path}")
    print(tb)
    print("=" * 70)

    # 取最后一行异常信息作为简要原因
    last = tb.strip().splitlines()[-1] if tb.strip() else repr(exc)
    return JSONResponse(
        status_code=500,
        content={
            "detail": f"服务器内部错误：{last}",
            "path": request.url.path,
            "type": exc.__class__.__name__,
        },
    )


_before = len(app.routes)
_pairs = [(p, r) for (p, r, _t) in SUB_ROUTERS]
_n = mount_all(app, _pairs, api_prefix="/api")
_after = len(app.routes)
print(f"[MAIN] 直接挂载 -> app.routes {_before} -> {_after} (+{_after - _before})，注册 {_n} 条")
if _n == 0:
    print("[MAIN][ERROR] 未注册任何业务路由，请检查 app/api/__init__.py")


@app.get("/health")
async def health():
    return {"status": "ok"}


# ---- 上传文件（商品图片等）----
UPLOAD_DIR = settings.UPLOAD_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


# ---- 前端托管：frontend/dist 存在时启用（生产模式，单端口） ----
DIST = settings.FRONTEND_DIST
if DIST.exists() and (DIST / "index.html").exists():
    assets = DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    # index.html 绝不缓存：它引用带 hash 的 assets，重建后必须立刻拿到新壳
    NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"}

    def _html_response(path):
        return FileResponse(str(path), headers=NO_CACHE)

    @app.get("/", include_in_schema=False)
    async def _index():
        index = DIST / "index.html"
        if not index.is_file():
            return _not_built()
        return _html_response(index)

    def _not_built():
        """frontend/dist 被清空或构建失败时的友好提示（而非 500）"""
        return JSONResponse(
            status_code=503,
            content={
                "detail": "前端资源尚未构建或正在重建",
                "hint": "请稍候刷新；若持续出现，双击 watch.bat 或 go.bat 重新构建",
                "dist": str(DIST),
            },
        )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa(full_path: str):
        # API 未匹配的路径直接 404，其余交给前端路由
        if full_path.startswith(("api/", "docs", "redoc", "openapi.json", "health", "uploads/")):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        candidate = DIST / full_path
        if candidate.is_file():
            # 静态资源带 hash，可长期缓存；html 不缓存
            if candidate.suffix.lower() == ".html":
                return _html_response(candidate)
            return FileResponse(str(candidate))
        # vite build --watch 重建时会短暂清空 dist
        index = DIST / "index.html"
        if not index.is_file():
            return _not_built()
        return _html_response(index)
else:
    @app.get("/", include_in_schema=False)
    async def _root():
        return {
            "message": settings.PROJECT_NAME + " API",
            "version": settings.VERSION,
            "docs": "/docs",
            "hint": "前端未构建，请开发模式访问 http://localhost:3040 或执行 build_frontend.bat",
        }
