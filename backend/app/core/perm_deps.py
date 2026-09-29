"""接口级权限校验依赖"""
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, Role
from ..models.permission import Permission, role_permissions
from ..api.deps import get_current_user

# 管理员角色名（拥有全部权限）
ADMIN_ROLE = "admin"


def get_user_permissions(db: Session, user: User) -> set:
    """读取用户所属角色的权限码集合"""
    if not user.role_id:
        return set()
    role = db.query(Role).filter(Role.id == user.role_id).first()
    if not role:
        return set()
    if role.name == ADMIN_ROLE:
        return {"*"}
    perms = db.query(Permission).join(role_permissions).filter(
        role_permissions.c.role_id == role.id
    ).all()
    return {p.code for p in perms}


def has_perm(db: Session, user: User, *codes: str) -> bool:
    """任一权限满足即可（OR 语义）"""
    owned = get_user_permissions(db, user)
    if "*" in owned:
        return True
    return any(c in owned for c in codes)


def require_perm(*codes: str):
    """依赖工厂：用法 Depends(require_perm("purchase:add"))"""
    async def _checker(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        if not has_perm(db, current_user, *codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限不足，需要：{' 或 '.join(codes)}",
            )
        return current_user

    return _checker
