# 进销存管理系统 - 后端

## 技术栈
- Python 3.10+
- FastAPI
- SQLAlchemy + PostgreSQL
- JWT认证

## 安装依赖
```bash
cd backend
pip install -r requirements.txt
```

## 配置数据库
1. 安装PostgreSQL
2. 创建数据库: `inventory_db`
3. 复制 `.env.example` 为 `.env` 并修改数据库连接

## 初始化数据库
```bash
python init_db.py
```

默认管理员: admin / admin123

## 启动服务
```bash
uvicorn app.main:app --reload --port 8000
```

## API文档
启动后访问: http://localhost:8000/docs

## 功能模块
- 用户认证 (JWT)
- 供应商管理
- 客户管理
- 商品管理 (含分类)
- 采购管理 (创建/审核/入库/作废)
- 销售管理 (创建/审核/出库/作废)
- 库存管理 (查询/预警/盘点)
