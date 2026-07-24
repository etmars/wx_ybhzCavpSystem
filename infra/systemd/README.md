# systemd 部署（推荐，无需把 jar 提交 git）

适用：服务器已有 JDK 17+、Maven、现有 Nginx/证书体系。  
与 IPDSV / AvpPlanning / ybhzsso 同一套路：**git pull → 本机构建 → systemd 托管**。

> Spring Boot 运行时仍是 jar（`target/*.jar`），但**不必**再走「本地打 jar → 提交 dist → scp」；  
> jar 只在服务器构建产物里，由 systemd 启动。

```text
手机小程序 → https://parkinglot.c-avp.com:9065
                    └─（现有反代或直达）wx-ybhz-cavp.service
                         WorkingDirectory=/opt/cavp/wx_ybhzCavpSystem
                         java -jar target/wx-ybhz-cavp-system-1.0.0.jar --spring.profiles.active=prod
```

## 1. 一次性准备

```bash
# 运行用户
sudo useradd --system --home /opt/cavp --shell /usr/sbin/nologin cavp
sudo mkdir -p /opt/cavp /opt/cavp/cert /etc/cavp

# 拉代码（按你实际仓库地址改）
sudo git clone <你的-wx_ybhzCavpSystem.git> /opt/cavp/wx_ybhzCavpSystem
# 或已有目录：cd /opt/cavp/wx_ybhzCavpSystem && sudo git pull

sudo chown -R cavp:cavp /opt/cavp

# JDK 17+ / Maven
java -version    # 需 17+
mvn -version     # 需可用；没有则装 maven 或用仓库内 .tools/maven（Windows 本地用）
```

确认 Java 路径：

```bash
which java
# 若不是 /usr/bin/java，改 unit 里 ExecStart= 为实际路径
```

## 2. 环境文件与证书

```bash
sudo cp /opt/cavp/wx_ybhzCavpSystem/infra/systemd/cavp.env.example /etc/cavp/cavp.env
sudo chmod 600 /etc/cavp/cavp.env
# 按需改 CERT_PWD / DATA_DIR 等
```

生产 profile 走 HTTPS 9065，需要 PKCS12。若服务器上已有 Let's Encrypt：

```bash
DOMAIN=parkinglot.c-avp.com
CERT_DIR=/opt/cavp/cert
sudo openssl pkcs12 -export \
  -in /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
  -inkey /etc/letsencrypt/live/$DOMAIN/privkey.pem \
  -out $CERT_DIR/keystore.p12 \
  -name cavp \
  -passout pass:changeit
sudo chown cavp:cavp $CERT_DIR/keystore.p12
sudo chmod 600 $CERT_DIR/keystore.p12
```

也可用旧脚本 `deploy-prod.sh` 只做证书转换部分；**进程启停改交给 systemd**。

## 3. 构建

```bash
cd /opt/cavp/wx_ybhzCavpSystem
sudo -u cavp git pull
sudo -u cavp mvn -DskipTests package
# 产物：target/wx-ybhz-cavp-system-1.0.0.jar
```

`data/maps` 为缓存：首次启动会按 parkinglot catalog + 标定服同步；也可事后 `POST /api/admin/maps/sync`。

## 4. 安装并启动 systemd

```bash
sudo cp /opt/cavp/wx_ybhzCavpSystem/infra/systemd/wx-ybhz-cavp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wx-ybhz-cavp
sudo systemctl status wx-ybhz-cavp
```

常用命令：

```bash
sudo systemctl restart wx-ybhz-cavp
sudo journalctl -u wx-ybhz-cavp -f
```

## 5. 验证

```bash
curl -sk https://127.0.0.1:9065/api/maps/index
# 或
curl -sk https://parkinglot.c-avp.com:9065/api/maps/index
```

应返回含 `maps` 的 JSON。途径点标牌等 nav-h5 静态资源已打进 jar classpath（`src/main/resources/static/nav-h5`）。

## 6. 日常更新（推荐流程）

```bash
cd /opt/cavp/wx_ybhzCavpSystem
sudo -u cavp git pull
sudo -u cavp mvn -DskipTests package
sudo systemctl restart wx-ybhz-cavp
```

**不再需要**本地 `deploy.bat` 打 jar、也不必把 `dist/*.jar` 提交进 git。

## 与旧 deploy-prod.sh 的关系

| 方式 | 说明 |
|------|------|
| **systemd（推荐）** | git + mvn + `systemctl`，与其它服务一致 |
| `deploy-prod.sh` | 旧：nohup + 假定 jar 已放到 `/opt/cavp/`；可保留作证书辅助，进程管理请改用 systemd |

若仍想用「上传现成 jar」而不装 Maven，也可：把 jar 放到 `target/` 同名路径，或改 `ExecStart` 指向 `/opt/cavp/wx-ybhz-cavp-system-1.0.0.jar`——仍由 systemd 托管，只是构建步骤换成 scp。
