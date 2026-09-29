#!/usr/bin/env bash
# 数据库备份 / 恢复（SQLite 在线备份，不中断服务）
#
# 用法：
#   bash backup.sh              备份
#   bash backup.sh --list       列出备份
#   bash backup.sh --restore <文件名>   恢复
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd)"
VENV_DIR="/opt/inventory/venv"
PY="$VENV_DIR/bin/python"

[[ -x "$PY" ]] || PY="$(command -v python3)"
[[ -n "$PY" ]] || { echo "找不到 python"; exit 1; }

cd "$BACKEND_DIR"
exec "$PY" backup_db.py "$@"
