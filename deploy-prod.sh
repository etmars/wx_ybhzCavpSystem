#!/usr/bin/env bash
# 【已过时】旧生产脚本：内嵌 HTTPS 9065 + nohup。
# 请改用 systemd：infra/systemd/README.md
# 应用现监听本机 HTTP 12380，对外 HTTPS 由 Nginx 反代。
#
# 本文件仅保留作历史参考，勿再用于启停进程。
set -euo pipefail
echo "deploy-prod.sh 已废弃：请使用 systemctl restart wx-ybhz-cavp（本机 :12380 HTTP）"
echo "说明见 infra/systemd/README.md"
exit 1
