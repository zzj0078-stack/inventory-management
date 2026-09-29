#!/usr/bin/env bash
# 进销存系统 - 服务管理
set -euo pipefail

APP_NAME="inventory"
ACTION="${1:-status}"

case "$ACTION" in
  start)   sudo systemctl start   "$APP_NAME" && echo "已启动" ;;
  stop)    sudo systemctl stop    "$APP_NAME" && echo "已停止" ;;
  restart) sudo systemctl restart "$APP_NAME" && echo "已重启" ;;
  status)  sudo systemctl status  "$APP_NAME" --no-pager ;;
  log)     sudo journalctl -u "$APP_NAME" -n 100 --no-pager ;;
  logf)    sudo journalctl -u "$APP_NAME" -f ;;
  *)
    cat <<EOF
用法: $0 {start|stop|restart|status|log|logf}

  start    启动服务
  stop     停止服务
  restart  重启服务
  status   查看状态
  log      查看最近 100 行日志
  logf     实时跟踪日志（Ctrl+C 退出）
EOF
    exit 1
    ;;
esac
