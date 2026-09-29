from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
import traceback
from ..database import get_db
from ..models.user import User, Role
from ..schemas.user import UserLogin, Token, UserResponse
from ..schemas.common import ResponseModel
from ..core.security import verify_password, create_access_token
from ..core.oplog import log_op
from ..api.deps import get_current_user

router = APIRouter()


def _build_user_response(db: Session, user: User) -> UserResponse:
    """把用户转成响应对象，并填充角色信息"""
    u = UserResponse.model_validate(user, from_attributes=True)
    if user.role_id:
        role = db.query(Role).filter(Role.id == user.role_id).first()
        if role:
            u.role_name = role.name
            u.role_label = role.description
            u.is_admin = (role.name == "admin")
        else:
            u.role_name = f"⚠ 角色#{user.role_id} 已不存在"
            u.is_admin = False
    else:
        u.role_name = ""
        u.is_admin = False
    return u


@router.post("/login", response_model=Token)
async def login(user_data: UserLogin, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else ""

    try:
        user = db.query(User).filter(User.username == user_data.username).first()
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"查询用户失败：{type(e).__name__}: {e}")

    if not user:
        log_op(db, None, "认证", "登录失败", user_data.username, "用户不存在", ip)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    try:
        ok = verify_password(user_data.password, user.password_hash)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"密码校验失败：{type(e).__name__}: {e}")

    if not ok:
        log_op(db, None, "认证", "登录失败", user_data.username, "密码错误", ip)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    if user.status == 0:
        log_op(db, user, "认证", "登录失败", user.username, "账号已禁用", ip)
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="用户已被禁用")

    try:
        access_token = create_access_token(data={"sub": str(user.id)})

        log_op(db, user, "认证", "登录", user.username, "登录成功", ip)
        db.commit()

        u = _build_user_response(db, user)
        return Token(access_token=access_token, user=u)

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"生成登录凭证失败：{type(e).__name__}: {e}"
        )


@router.post("/logout")
async def logout(request: Request, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    log_op(db, current_user, "认证", "退出登录", current_user.username,
           "", request.client.host if request.client else "")
    db.commit()
    return ResponseModel(message="已退出")


@router.get("/me", response_model=UserResponse)
async def get_me(db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    return _build_user_response(db, current_user)
