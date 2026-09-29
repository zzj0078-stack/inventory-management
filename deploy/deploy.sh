#!/usr/bin/env bash
# 进销存系统 - Linux 部署脚本
# 适用：CentOS 7+ / Ubuntu 20.04+ / 麒麟 V10
#
# 用法：
#   sudo bash deploy.sh              # 首次部署
#   sudo bash deploy.sh --upgrade    # 升级（保留数据库）
set -euo pipefail

APP_NAME="inventory"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd)"
FRONTEND_DIST="$SCRIPT_DIR/../frontend/dist"

PORT="${PORT:-3041}"
HOST="${HOST:-0.0.0.0}"
VENV_DIR="/opt/${APP_NAME}/venv"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"

UPGRADE=0
[[ "${1:-}" == "--upgrade" ]] && UPGRADE=1

log() { echo -e "\033[32m[$(date +%H:%M:%S)] $*\033[0m"; }
warn() { echo -e "\033[33m[WARN] $*\033[0m"; }
die() { echo -e "\033[31m[ERROR] $*\033[0m"; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 或 sudo 执行"

# ---------- 1. 检查 Python ----------
log "检查 Python ..."
PY_BIN=""
for c in python3.12 python3.11 python3.10 python3 python; do
    if command -v "$c" >/dev/null 2>&1; then
        v=$("$c" -c 'import sys;print(sys.version_info[0]*100+sys.version_info[1])' 2>/dev/null || echo 0)
        if [[ "$v" -ge 309 ]]; then PY_BIN="$c"; break; fi
    fi
done
[[ -n "$PY_BIN" ]] || die "未找到 Python 3.9+，请先安装：yum install python3 / apt install python3 python3-venv"
log "使用 $PY_BIN ($($PY_BIN --version 2>&1))"

if ! "$PY_BIN" -c 'import venv' >/dev/null 2>&1; then
    die "缺少 venv 模块：CentOS 执行 'yum install python3-devel'，Ubuntu 执行 'apt install python3-venv'"
fi

# ---------- 2. 建虚拟环境 ----------
if [[ ! -d "$VENV_DIR" ]]; then
    log "创建虚拟环境 $VENV_DIR ..."
    mkdir -p "$(dirname "$VENV_DIR")"
    "$PY_BIN" -m venv "$VENV_DIR"
fi
PY="$VENV_DIR/bin/python"

# ---------- 3. 装依赖 ----------
log "安装 Python 依赖 ..."
"$PY" -m pip install --upgrade pip -q
if [[ -f "$BACKEND_DIR/requirements.txt" ]]; then
    # 优先国内源，失败回退官方源
    "$PY" -m pip install -r "$BACKEND_DIR/requirements.txt" -q \
        -i https://pypi.tuna.tsinghua.edu.cn/simple \
        || "$PY" -m pip install -r "$BACKEND_DIR/requirements.txt" -q
else
    die "缺少 $BACKEND_DIR/requirements.txt"
fi

# ---------- 4. 配置文件 ----------
ENV_FILE="$BACKEND_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    log "生成 .env ..."
    SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 60)"
    cat > "$ENV_FILE" <<EOF
# 数据库（相对路径基于 backend/ 目录）
DATABASE_URL=sqlite:///./inventory.db

# JWT 密钥（已随机生成，勿泄露）
SECRET_KEY=${SECRET}

# 登录有效期（分钟），8 小时
TOKEN_EXPIRE_MINUTES=480

# 监听
HOST=${HOST}
PORT=${PORT}

# 业务时区（与服务器系统时区无关）
APP_TIMEZONE=Asia/Shanghai
EOF
    chmod 600 "$ENV_FILE"
    log "已生成 $ENV_FILE"
else
    warn ".env 已存在，保留不覆盖"
fi

# ---------- 5. 初始化数据库 ----------
if [[ $UPGRADE -eq 0 && ! -f "$BACKEND_DIR/inventory.db" ]]; then
    log "初始化空数据库（建表 + 权限 + 角色 + admin 账号）..."
    (cd "$BACKEND_DIR" && "$PY" init_db.py)
    log "默认账号 admin / admin123 —— 登录后请立即修改密码"
else
    log "复用现有数据库，执行表结构同步 ..."
    (cd "$BACKEND_DIR" && "$PY" init_db.py)
fi

mkdir -p "$BACKEND_DIR/backups" "$BACKEND_DIR/logs" "$BACKEND_DIR/uploads/products"

# ---------- 6. 前端 ----------
if [[ -d "$FRONTEND_DIST" && -f "$FRONTEND_DIST/index.html" ]]; then
    log "检测到前端构建产物 $FRONTEND_DIST —— 单端口模式（后端托管）"
else
    warn "未找到 frontend/dist，后端将只提供 API"
    warn "请在本机执行 npm run build 后把 dist 目录上传到 $FRONTEND_DIST"
fi

# ---------- 7. systemd ----------
log "写入 systemd 服务 $SERVICE_FILE ..."
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Inventory ERP System
After=network.target

[Service]
Type=simple
WorkingDirectory=${BACKEND_DIR}
Environment=PYTHONUNBUFFERED=1
ExecStart=${PY} ${BACKEND_DIR}/run.py
Restart=always
RestartSec=5
StandardOutput=append:${BACKEND_DIR}/logs/app.log
StandardError=append:${BACKEND_DIR}/logs/error.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${APP_NAME}" >/dev/null 2>&1 || true
systemctl restart "${APP_NAME}"

sleep 3
if systemctl is-active --quiet "$APP_NAME"; then
    IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    log "启动成功"
    echo
    echo "=========================================="
    echo "  访问地址 : http://${IP:-<服务器IP>}:${PORT}"
    echo "  API 文档 : http://${IP:-<服务器IP>}:${PORT}/docs"
    echo "  账号密码 : admin / admin123"
    echo "  日志     : ${BACKEND_DIR}/logs/app.log"
    echo "  服务管理 : systemctl {status|restart|stop} ${APP_NAME}"
    echo "=========================================="
else
    die "服务启动失败，查看日志：journalctl -u ${APP_NAME} -n 50 或 ${BACKEND_DIR}/logs/error.log"
fi

# ---------- 8. 防火墙 ----------
if command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port=${PORT}/tcp >/dev/null 2>&1 && firewall-cmd --reload >/dev/null 2>&1 \
        && log "firewalld 已放行 ${PORT}/tcp" || warn "firewalld 放行失败，请手动处理"
elif command -v ufw >/dev/null 2>&1; then
    ufw allow ${PORT}/tcp >/dev/null 2>&1 && log "ufw 已放行 ${PORT}/tcp" || true
else
    warn "未检测到防火墙工具，如无法访问请检查安全组/iptables"
fi
