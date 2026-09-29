"""启动入口：路径无关，可在任意目录运行。"""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from app.config import settings  # noqa: E402
from app.main import app         # noqa: E402
import uvicorn                   # noqa: E402

KEY_ROUTES = [
    "/api/auth/login",
    "/api/users",
    "/api/products",
    "/api/purchase",
    "/api/sales",
    "/api/inventory",
    "/api/inventory/warehouses",
    "/api/ext/dashboard",
    "/api/ext/sale-returns",
    "/api/ext/purchase-returns",
    "/api/ext/payments",
    "/api/ext/stock-logs",
    "/api/ext/stock-transfers",
    "/api/ext/stock-checks",
    "/api/ext/reports/sales",
    "/api/ext/logs",
    "/api/ext/health-check",
]


def print_routes():
    paths = [str(getattr(r, "path", "")) for r in app.routes]
    api_paths = [p for p in paths if p.startswith("/api")]

    print(f"[INFO] app.routes  = {len(paths)}")
    print(f"[INFO] /api/* 路由 = {len(api_paths)}")

    if not api_paths:
        print("[ERROR] 没有任何 /api 路由！")
        return

    missing = [p for p in KEY_ROUTES if p not in paths]
    if missing:
        print("[WARN] 缺失关键路由：")
        for m in missing:
            print(f"        - {m}")
    else:
        print("[OK]   关键路由齐全")


def print_schema():
    from sqlalchemy import inspect
    from app.database import engine
    need = {
        "purchase_orders": ["invoice_no", "delivery_address"],
        "sales_orders": ["invoice_no", "delivery_address"],
        "payments": ["voucher_no"],
        "products": ["sub_unit", "sub_unit_ratio", "color", "size", "image_url"],
    }
    try:
        insp = inspect(engine)
        bad = []
        for table, cols in need.items():
            if not insp.has_table(table):
                bad.append(f"{table}(表不存在)")
                continue
            have = {c["name"] for c in insp.get_columns(table)}
            miss = [c for c in cols if c not in have]
            if miss:
                bad.append(f"{table}: {', '.join(miss)}")
        if bad:
            print("[WARN] 缺失字段：")
            for b in bad:
                print(f"        - {b}")
        else:
            print("[OK]   关键字段齐全")
    except Exception as e:
        print(f"[WARN] 字段自检失败: {e}")


def main():
    print("=" * 60)
    print(f"[INFO] backend dir : {settings.BASE_DIR}")
    print(f"[INFO] database    : {settings.DATABASE_URL}")
    print(f"[INFO] listening   : http://{settings.HOST}:{settings.PORT}")
    print(f"[INFO] api docs    : http://127.0.0.1:{settings.PORT}/docs")
    print_routes()
    print_schema()
    print("=" * 60)
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)


if __name__ == "__main__":
    main()
