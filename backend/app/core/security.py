from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import hashlib
import secrets
from ..config import settings


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    if hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$"):
        # bcrypt格式
        try:
            from passlib.context import CryptContext
            pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
            return pwd_context.verify(plain_password, hashed_password)
        except Exception:
            return False
    else:
        # SHA256格式
        salt, hash_val = hashed_password.split(":")
        return hashlib.sha256(f"{salt}{plain_password}".encode()).hexdigest() == hash_val


def get_password_hash(password: str) -> str:
    """生成密码哈希（使用SHA256避免bcrypt兼容问题）"""
    salt = secrets.token_hex(16)
    hash_val = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return f"{salt}:{hash_val}"


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return None
