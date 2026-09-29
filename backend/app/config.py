import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent   # backend/
load_dotenv(BASE_DIR / ".env")

_DB_URL = os.getenv("DATABASE_URL", "").strip()
if not _DB_URL:
    _DB_URL = f"sqlite:///{(BASE_DIR / 'inventory.db').as_posix()}"

# 相对 sqlite 路径转为绝对，避免受 cwd 影响
if _DB_URL.startswith("sqlite:///./"):
    _DB_URL = "sqlite:///" + str(BASE_DIR / _DB_URL[len("sqlite:///./"):])


class Settings:
    PROJECT_NAME: str = "进销存管理系统"
    VERSION: str = "1.0.0"
    BASE_DIR: Path = BASE_DIR

    DATABASE_URL: str = _DB_URL

    # JWT
    SECRET_KEY: str = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("TOKEN_EXPIRE_MINUTES", "480"))

    REDIS_URL: str = os.getenv("REDIS_URL", "")

    # 服务
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "3041"))

    # 前端构建产物（存在则由后端托管）
    FRONTEND_DIST: Path = Path(os.getenv("FRONTEND_DIST", str(BASE_DIR.parent / "frontend" / "dist")))

    # 备份目录
    BACKUP_DIR: Path = Path(os.getenv("BACKUP_DIR", str(BASE_DIR / "backups")))

    # 上传文件目录（商品图片等），通过 /uploads 对外提供
    UPLOAD_DIR: Path = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads")))

    # 单文件上传上限（字节）
    MAX_UPLOAD_BYTES: int = int(os.getenv("MAX_UPLOAD_MB", "5")) * 1024 * 1024


settings = Settings()
