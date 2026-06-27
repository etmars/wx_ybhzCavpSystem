#!/usr/bin/env bash
# 宜泊慧智 C-AVP 后端生产部署脚本（HTTPS 9065）
# 在服务器 8.137.58.97 上执行，域名 parkinglot.c-avp.com
#
# 前置：服务器已装 JDK 17+、openssl、certbot
# 用法： bash deploy-prod.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/cavp}"
DOMAIN="parkinglot.c-avp.com"
PORT=9065
CERT_DIR="$APP_DIR/cert"
KEYSTORE="$CERT_DIR/keystore.p12"
KEYSTORE_PWD="${CERT_PWD:-changeit}"
ALIAS="cavp"

echo "========================================"
echo " 宜泊慧智 C-AVP 生产部署 (HTTPS $PORT)"
echo "========================================"

# 1. 目录
mkdir -p "$APP_DIR" "$CERT_DIR"
cd "$APP_DIR"

# 2. 申请 / 续期证书（standalone 模式，临时占用 80）
echo "[1/5] 申请 Let's Encrypt 证书..."
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  echo "  证书已存在，尝试续期..."
  certbot renew --quiet || true
else
  certbot certonly --standalone \
    -d "$DOMAIN" \
    --non-interactive --agree-tos \
    -m "${CERT_EMAIL:-admin@$DOMAIN}" \
    --no-eff-email
fi

FULLCHAIN="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
PRIVKEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"

# 3. 转换为 PKCS12
echo "[2/5] 转换为 PKCS12..."
openssl pkcs12 -export \
  -in "$FULLCHAIN" \
  -inkey "$PRIVKEY" \
  -out "$KEYSTORE" \
  -name "$ALIAS" \
  -passout pass:"$KEYSTORE_PWD"
chmod 600 "$KEYSTORE"

# 4. 检查 jar 与数据
echo "[3/5] 检查产物..."
JAR="$APP_DIR/wx-ybhz-cavp-system-1.0.0.jar"
if [ ! -f "$JAR" ]; then
  echo "[错误] 未找到 $JAR"
  echo "  请把 dist/wx-ybhz-cavp-system-1.0.0.jar 上传到 $APP_DIR/ 并改名为 wx-ybhz-cavp-system-1.0.0.jar"
  exit 1
fi
if [ ! -d "$APP_DIR/data/maps" ]; then
  echo "[警告] $APP_DIR/data/maps 不存在，瓦片/几何接口会 404"
  echo "  请把 data/ 目录上传到 $APP_DIR/data/"
fi

# 5. 停旧进程 + 启动
echo "[4/5] 停止旧进程..."
pkill -f "wx-ybhz-cavp-system-1.0.0.jar" 2>/dev/null || true
sleep 2

echo "[5/5] 启动后端 https://$DOMAIN:$PORT ..."
export CERT_PATH="$KEYSTORE"
export CERT_PWD="$KEYSTORE_PWD"
export CERT_ALIAS="$ALIAS"
nohup java -jar "$JAR" \
  --spring.profiles.active=prod \
  --app.data-dir="$APP_DIR/data" \
  > "$APP_DIR/app.log" 2>&1 &

sleep 6
if curl -sk "https://localhost:$PORT/api/maps/index" | grep -q maps; then
  echo "✓ 启动成功: https://$DOMAIN:$PORT"
else
  echo "✗ 启动异常，查日志: tail -50 $APP_DIR/app.log"
fi

echo ""
echo "证书续期：crontab 加一行（每月1号自动续期并重启）"
echo "  0 3 1 * * certbot renew --quiet --deploy-hook 'bash $APP_DIR/deploy-prod.sh'"
