from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from ..database import get_db
from ..models.user import User, Role
from ..models.permission import Permission, role_permissions
from ..schemas.common import ResponseModel
from ..core.security import verify_password, get_password_hash
from ..core.password_policy import validate_password, RULES_TEXT
from ..api.deps import get_current_user
from ..core.oplog import log_op

router = APIRouter()


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class ResetPasswordRequest(BaseModel):
    # 默认值必须满足密码策略（至少 8 位 + 特殊字符）
    user_id: int
    new_password: str = "Aa123456!"


class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    permission_ids: List[int] = []


class RoleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    permission_ids: List[int] = []
    
    class Config:
        from_attributes = True


class PermissionResponse(BaseModel):
    id: int
    code: str
    name: str
    module: str
    module_label: Optional[str] = None
    
    class Config:
        from_attributes = True


# 修改密码（自己）
@router.post("/change-password")
async def change_password(
    data: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not verify_password(data.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="原密码错误")

    err = validate_password(data.new_password)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if data.new_password == data.old_password:
        raise HTTPException(status_code=400, detail="新密码不能与原密码相同")

    current_user.password_hash = get_password_hash(data.new_password)
    log_op(db, current_user, "认证", "修改密码", current_user.username)
    db.commit()
    return ResponseModel(message="密码修改成功")


# 重置密码（管理员）
@router.post("/reset-password")
async def reset_password(
    data: ResetPasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    err = validate_password(data.new_password)
    if err:
        raise HTTPException(status_code=400, detail=err)

    user.password_hash = get_password_hash(data.new_password)
    log_op(db, current_user, "用户管理", "重置密码", user.username)
    db.commit()
    return ResponseModel(message=f"密码已重置为: {data.new_password}")


# 密码策略提示（前端用来展示规则文案，避免两端各写一份）
@router.get("/password-rules")
async def password_rules():
    return {"rules": RULES_TEXT, "min_length": 8, "max_length": 64}


# 获取当前用户权限
@router.get("/my-permissions")
async def get_my_permissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not current_user.role_id:
        return {"permissions": [], "role_name": None}

    role = db.query(Role).filter(Role.id == current_user.role_id).first()
    if not role:
        return {"permissions": [], "role_name": None}

    # 管理员角色：直接返回通配符，前端/后端统一按全权限处理
    if role.name == "admin":
        return {"permissions": ["*"], "role_name": role.name}

    perms = db.query(Permission).join(role_permissions).filter(
        role_permissions.c.role_id == role.id
    ).all()

    return {"permissions": [p.code for p in perms], "role_name": role.name}


# ========== 权限管理（管理员） ==========

@router.get("/permissions", response_model=List[PermissionResponse])
async def get_permissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from ..core.permissions import group_labels
    labels = group_labels()

    perms = db.query(Permission).order_by(Permission.id).all()
    out = [PermissionResponse(
        id=p.id, code=p.code, name=p.name, module=p.module,
        module_label=labels.get(p.module, p.module)
    ) for p in perms]

    # 按预定义分组顺序排序
    order = {m: i for i, m in enumerate(labels.keys())}
    out.sort(key=lambda x: (order.get(x.module, 999), x.id))
    return out


# ========== 角色管理 ==========

@router.get("/roles")
async def get_roles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    roles = db.query(Role).all()
    result = []
    for r in roles:
        perm_ids = [p.id for p in db.query(Permission).join(role_permissions).filter(role_permissions.c.role_id == r.id).all()]
        result.append({
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "permission_ids": perm_ids
        })
    return result


@router.post("/roles")
async def create_role(
    data: RoleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if db.query(Role).filter(Role.name == data.name).first():
        raise HTTPException(status_code=400, detail="角色名已存在")
    
    role = Role(name=data.name, description=data.description)
    db.add(role)
    db.flush()
    
    # 关联权限
    if data.permission_ids:
        perms = db.query(Permission).filter(Permission.id.in_(data.permission_ids)).all()
        role.perms = perms
    
    log_op(db, current_user, "角色管理", "新增角色", data.name)
    db.commit()
    db.refresh(role)
    return {"id": role.id, "name": role.name, "description": role.description, "permission_ids": data.permission_ids}


@router.put("/roles/{role_id}")
async def update_role(
    role_id: int,
    data: RoleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    
    role.name = data.name
    role.description = data.description
    
    # 更新权限
    perms = db.query(Permission).filter(Permission.id.in_(data.permission_ids)).all()
    role.perms = perms
    
    log_op(db, current_user, "角色管理", "编辑角色", data.name)
    db.commit()
    return {"id": role.id, "name": role.name, "description": role.description, "permission_ids": data.permission_ids}


@router.delete("/roles/{role_id}")
async def delete_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    
    # 检查是否有关联用户
    user_count = db.query(User).filter(User.role_id == role_id).count()
    if user_count > 0:
        raise HTTPException(status_code=400, detail=f"该角色下有 {user_count} 个用户，无法删除")
    
    # 清除权限关联
    db.execute(role_permissions.delete().where(role_permissions.c.role_id == role_id))
    db.delete(role)
    db.commit()
    return ResponseModel(message="删除成功")
