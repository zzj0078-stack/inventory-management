# 服务器部署指南（Linux + SQLite）

## 一、打包

在**开发机**（Windows）上执行：

```
双击 package_for_deploy.bat
```

生成 `dist_deploy/inventory-erp-YYYYMMDD.zip`，包含后端源码、前端构建产物、部署脚本。
**不含**：数据库、node_modules、__pycache__、备份、日志。

---

## 二、上传

```bash
scp inventory-erp-20260921.zip root@<服务器IP>:/opt/
```

或用 WinSCP / Xftp 上传到 `/opt/`。

---

## 三、部署

```bash
cd /opt
unzip inventory-erp-20260921.zip -d inventory-erp
cd inventory-erp
sudo bash deploy/deploy.sh
```

脚本自动完成：

| 步骤 | 内容 |
|------|------|
| 1 | 检查 Python 3.9+，找不到则提示安装命令 |
| 2 | 创建虚拟环境 `/opt/inventory/venv` |
| 3 | 安装依赖（优先清华源） |
| 4 | 生成 `.env`，**随机 SECRET_KEY** |
| 5 | `init_db.py` → **建空库**（表结构 + 82 权限 + 8 角色 + admin 账号） |
| 6 | 检测前端 dist，启用单端口托管 |
| 7 | 写入 systemd 服务并启动 |
| 8 | 放行防火墙端口 |

完成后输出访问地址：
```
访问地址 : http://<服务器IP>:3041
API 文档 : http://<服务器IP>:3041/docs
账号密码 : admin / admin123
```

⚠️ **首次登录后立即修改 admin 密码**（右上角用户名 → 修改密码）。

---

## 四、环境要求

| 项 | 要求 |
|----|------|
| 系统 | CentOS 7+ / Ubuntu 20.04+ / 麒麟 V10 |
| Python | **3.9 及以上** |
| 内存 | 1 GB 起 |
| 磁盘 | 2 GB 起（数据库随业务增长） |
| 端口 | 3041（可改 `deploy.sh` 里的 `PORT`） |

缺 Python 时：

```bash
# CentOS / 麒麟
yum install -y python3 python3-devel

# Ubuntu
apt update && apt install -y python3 python3-venv python3-pip
```

---

## 五、日常运维

```bash
cd /opt/inventory-erp/deploy

bash service.sh status     # 查看状态
bash service.sh restart    # 重启
bash service.sh stop       # 停止
bash service.sh logf       # 实时日志（Ctrl+C 退出）

bash backup.sh             # 备份数据库
bash backup.sh --list      # 列出备份
bash backup.sh --restore inventory_20260921_093000.db   # 恢复
```

备份文件位于 `backend/backups/`。建议加定时任务：

```bash
crontab -e
# 每天凌晨 2 点备份，保留最近 30 天
0 2 * * * cd /opt/inventory-erp/deploy && bash backup.sh >> /var/log/inventory-backup.log 2>&1
```

---

## 六、升级

替换代码后重新部署，**保留数据库**：

```bash
cd /opt/inventory-erp
sudo bash deploy/deploy.sh --upgrade
```

`--upgrade` 不会重建数据库，只会：
- 重装依赖
- 执行 `init_db.py`（幂等：补权限、补角色、**自动补新增的数据库字段**）

---

## 七、配置项

`backend/.env`：

| 变量 | 默认 | 说明 |
|------|------|------|
| `DATABASE_URL` | `sqlite:///./inventory.db` | 相对 `backend/` 目录 |
| `SECRET_KEY` | 部署时随机生成 | **勿泄露、勿随意更换**（更换后所有人需重新登录） |
| `TOKEN_EXPIRE_MINUTES` | `480` | 登录有效期，8 小时 |
| `HOST` / `PORT` | `0.0.0.0` / `3041` | 监听地址 |
| `APP_TIMEZONE` | `Asia/Shanghai` | **业务时区，与服务器系统时区无关** |
| `BACKUP_DIR` | `backend/backups` | 备份目录 |

改完 `.env` 需 `bash service.sh restart`。

---

## 八、时区说明

数据库时间由 `APP_TIMEZONE` 决定，**不依赖服务器系统时区**。服务器设成 UTC 也不影响，页面时间始终是北京时间。

若服务器系统时间本身不准，用 `date` 检查并同步：

```bash
timedatectl set-timezone Asia/Shanghai
timedatectl set-ntp true
```

---

## 九、常见问题

**打不开页面**
```bash
systemctl status inventory
journalctl -u inventory -n 50
ss -lntp | grep 3041          # 端口是否监听
```

**提示端口被占用**
改 `deploy/deploy.sh` 里的 `PORT`，重新执行 `deploy.sh --upgrade`。

**忘记 admin 密码**
```bash
cd /opt/inventory-erp/backend
/opt/inventory/venv/bin/python -c "
from app.database import SessionLocal
from app.models.user import User
from app.core.security import get_password_hash
db = SessionLocal()
u = db.query(User).filter(User.username=='admin').first()
u.password_hash = get_password_hash('admin123')
db.commit(); print('已重置为 admin123')
"
```

**数据库越来越大**
SQLite 单文件，20 人销售公司年增长通常 < 100 MB。超过 1 GB 或需要多机部署时，改用 PostgreSQL：安装 PG → 改 `DATABASE_URL=postgresql://user:pwd@localhost:5432/inventory` → `pip install psycopg2-binary` → 重跑 `init_db.py`。

**需要 HTTPS**
当前为 IP + 端口直连。若有域名，前置 Nginx 反代并配置证书，后端 `HOST=127.0.0.1` 只监听本机。
