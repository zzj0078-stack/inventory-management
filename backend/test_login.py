"""测试登录功能"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import engine, SessionLocal, Base
from app.models import *
from app.core.security import verify_password, get_password_hash

# 创建表
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# 检查用户
user = db.query(User).filter(User.username == "admin").first()
if user:
    print(f"✅ 找到用户: {user.username}")
    print(f"   密码哈希: {user.password_hash[:20]}...")
    
    # 验证密码
    result = verify_password("admin123", user.password_hash)
    print(f"   密码验证: {'成功' if result else '失败'}")
else:
    print("❌ 未找到admin用户，正在创建...")
    
    # 创建用户
    from app.models.user import Role
    
    admin_role = Role(name="admin", description="系统管理员", permissions="*")
    db.add(admin_role)
    db.flush()
    
    admin_user = User(
        username="admin",
        email="admin@example.com",
        password_hash=get_password_hash("admin123"),
        full_name="系统管理员",
        role_id=admin_role.id,
        status=1
    )
    db.add(admin_user)
    
    # 创建仓库
    warehouse = Warehouse(name="默认仓库", address="总部", status=1)
    db.add(warehouse)
    
    db.commit()
    print("✅ 创建成功，默认账号: admin / admin123")

db.close()
