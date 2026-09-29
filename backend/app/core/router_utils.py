"""路由注册工具：绕开 APIRouter.include_router 的包装行为。

本环境下 include_router 会把子路由包装成 _IncludedRouter 而非展开为 APIRoute，
导致 app.include_router() 无法识别并整体跳过。这里直接重建 APIRoute。
"""
from fastapi.routing import APIRoute


def _route_kwargs(route: APIRoute, prefix: str) -> dict:
    methods = sorted(set(route.methods or []))
    return dict(
        path=prefix + route.path,
        endpoint=route.endpoint,
        methods=methods,
        response_model=getattr(route, "response_model", None),
        status_code=getattr(route, "status_code", None),
        tags=list(getattr(route, "tags", None) or []),
        dependencies=list(getattr(route, "dependencies", None) or []),
        summary=getattr(route, "summary", None),
        description=getattr(route, "description", None),
        response_description=getattr(route, "response_description", "Successful Response"),
        responses=dict(getattr(route, "responses", None) or {}),
        deprecated=getattr(route, "deprecated", None),
        name=getattr(route, "name", None),
        include_in_schema=getattr(route, "include_in_schema", True),
    )


def mount_router(app, router, prefix: str = "") -> int:
    """把 router 中的所有路由直接注册到 app，返回注册数量。"""
    added = 0
    for route in list(getattr(router, "routes", [])):
        if isinstance(route, APIRoute):
            try:
                app.router.add_api_route(**_route_kwargs(route, prefix))
                added += 1
            except Exception as e:
                print(f"[ROUTES][FAIL] {prefix}{getattr(route, 'path', '?')}: {e}")
        else:
            # 非 API 路由（如 Mount/WebSocket）原样挂载
            try:
                app.router.routes.append(route)
                added += 1
            except Exception as e:
                print(f"[ROUTES][FAIL] 非API路由 {type(route).__name__}: {e}")
    return added


def mount_all(app, sub_routers, api_prefix: str = "/api") -> int:
    """依次挂载 [(prefix, router), ...]"""
    total = 0
    for prefix, router in sub_routers:
        n = mount_router(app, router, api_prefix + prefix)
        total += n
        print(f"[ROUTES] mount {api_prefix}{prefix:<14} +{n}")
    return total
