from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import Optional
from ..database import get_db
from ..models.user import User, Role
from ..models.permission import Permission, role_permissions
from ..schemas.user import UserCreate, UserUpdate, UserResponse
from ..schemas.common import ResponseModel, PaginatedResponse
from ..core.security import get_password_hash
from ..core.password_policy import validate_password
from ..core.oplog import log_op
from ..api.deps import get_current_user

router = APIRouter()


def _role_perm_count(db, role: Role) -> int:
    if not role:
        return 0
    if role.name == "admin":
        return db.query(Permission).count()
    return db.query(Permission).join(role_permissions).filter(
        role_permissions.c.role_id == role.id
    ).count()


def _decorate(db, user: User) -> UserResponse:
    d = UserResponse.from_orm(user)
    if user.role_id:
        role = db.query(Role).filter(Role.id == user.role_id).first()
        if role:
            d.role_name = role.name
            d.role_label = role.description
            d.permission_count = _role_perm_count(db, role)
            d.is_admin = (role.name == "admin")
        else:
            d.role_name = f"⚠ 角色#{user.role_id} 已不存在"
            d.permission_count = 0
            d.is_admin = False
    else:
        d.role_name = ""
        d.permission_count = 0
        d.is_admin = False
    return d


@router.get("", response_model=PaginatedResponse)
async def get_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: Optional[str] = None,
    role_id: Optional[int] = None,
    status_filter: Optional[int] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(User)

    if keyword:
        query = query.filter(
            (User.username.contains(keyword)) |
            (User.full_name.contains(keyword)) |
            (User.phone.contains(keyword)) |
            (User.email.contains(keyword))
        )
    if role_id:
        query = query.filter(User.role_id == role_id)
    if status_filter is not None:
        query = query.filter(User.status == status_filter)

    total = query.count()
    items = query.order_by(User.id).offset((page - 1) * page_size).limit(page_size).all()

    return PaginatedResponse(
        total=total, page=page, page_size=page_size,
        items=[_decorate(db, u) for u in items]
    )


@router.post("", response_model=UserResponse)
async def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if db.query(User).filter(User.username == user_data.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(status_code=400, detail="邮箱已被使用")

    if not user_data.role_id:
        raise HTTPException(status_code=400, detail="请为用户指定角色，否则其登录后无任何权限")
    if not db.query(Role).filter(Role.id == user_data.role_id).first():
        raise HTTPException(status_code=400, detail="指定的角色不存在")

    err = validate_password(user_data.password)
    if err:
        raise HTTPException(status_code=400, detail=err)

    user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=get_password_hash(user_data.password),
        full_name=user_data.full_name,
        phone=user_data.phone,
        role_id=user_data.role_id,
        status=1,
    )
    db.add(user)
    log_op(db, current_user, "用户管理", "新增用户", user_data.username,
           f"角色#{user_data.role_id}")
    db.commit()
    db.refresh(user)
    return _decorate(db, user)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return _decorate(db, user)


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    user_data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    data = user_data.dict(exclude_unset=True)

    # 唯一性校验（排除自身）
    if data.get("username") and data["username"] != user.username:
        if db.query(User).filter(User.username == data["username"], User.id != user_id).first():
            raise HTTPException(status_code=400, detail="用户名已存在")
    if data.get("email") and data["email"] != user.email:
        if db.query(User).filter(User.email == data["email"], User.id != user_id).first():
            raise HTTPException(status_code=400, detail="邮箱已被使用")

    # 角色必须存在
    if "role_id" in data and data["role_id"]:
        if not db.query(Role).filter(Role.id == data["role_id"]).first():
            raise HTTPException(status_code=400, detail="指定的角色不存在")

    # 不允许把自己降级/禁用，避免锁死系统
    if user.id == current_user.id:
        if "role_id" in data and data["role_id"] != user.role_id:
            raise HTTPException(status_code=400, detail="不能修改自己的角色")
        if data.get("status") == 0:
            raise HTTPException(status_code=400, detail="不能禁用自己的账号")

    password = data.pop("password", None)
    if password:
        err = validate_password(password)
        if err:
            raise HTTPException(status_code=400, detail=err)
        user.password_hash = get_password_hash(password)

    for k, v in data.items():
        if v is not None:
            setattr(user, k, v)

    log_op(db, current_user, "用户管理", "编辑用户", user.username)
    db.commit()
    db.refresh(user)
    return _decorate(db, user)


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账号")

    if user.username == "admin":
        raise HTTPException(status_code=400, detail="内置管理员账号不可删除")

    uname = user.username
    db.delete(user)
    log_op(db, current_user, "用户管理", "删除用户", uname)
    db.commit()
    return ResponseModel(message="删除成功")
