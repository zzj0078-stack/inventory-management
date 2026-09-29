"""操作日志公共写入"""
from ..models.finance import OperationLog


def log_op(db, user, module, action, target="", detail="", ip=""):
    """写入操作日志。调用方负责 commit。

    user 可为 None（匿名/失败场景），此时 username 记为 'anonymous'。
    """
    try:
        db.add(OperationLog(
            user_id=getattr(user, "id", None),
            username=getattr(user, "username", None) or "anonymous",
            module=module,
            action=action,
            target=str(target or ""),
            detail=str(detail or ""),
            ip=str(ip or ""),
        ))
    except Exception as e:
        # 不能因为日志失败中断业务，但必须可见
        print(f"[WARN] 操作日志写入失败: {module}/{action}/{target} -> {e}")
