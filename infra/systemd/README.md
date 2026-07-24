# systemd 部署（推荐，无需把 jar 提交 git）

适用：服务器已有 JDK 17+、Maven；**对外 HTTPS 由现有 Nginx 终止**，本进程只监听本机 HTTP **12380**。  
与 IPDSV / AvpPlanning / ybhzsso 同一套路：**git pull → 本机构建 → systemd 托管**。

> Spring Boot 运行时仍是 jar（`target/*.jar`），但**不必**再走「本地打 jar → 提交 dist → scp」；  
> jar 只在服务器构建产物里，由 systemd 启动。  
> **应用内不再配置 SSL / 9065**。

```text
手机小程序 → https://parkinglot.c-avp.com:9065  （Nginx 等对外 HTTPS）
                    └─ proxy_pass → http://127.0.0.1:12380
                         wx-ybhz-cavp.service
                         java -jar target/...jar --spring.profiles.active=prod
```

## 1. 一次性准备

```bash
# 运行用户（若 unit 已改成 User=root + /home/wx_ybhzCavpSystem，可跳过 useradd）
sudo useradd --system --home /opt/cavp --shell /usr/sbin/nologin cavp
sudo mkdir -p /opt/cavp /etc/cavp

# 拉代码（按你实际仓库地址与路径改）
sudo git clone <你的-wx_ybhzCavpSystem.git> /home/wx_ybhzCavpSystem
# 或已有目录：cd /home/wx_ybhzCavpSystem && git pull

# JDK 17+ / Maven
java -version    # 需 17+
mvn -version
which java       # 与 unit 里 ExecStart= 路径一致（现网示例：/root/miniconda3/bin/java）
```

## 2. 环境文件

```bash
cp /home/wx_ybhzCavpSystem/infra/systemd/cavp.env.example /home/wx_ybhzCavpSystem/cavp.env
# 按需改 DATA_DIR / SERVER_ADDRESS
```

默认 `SERVER_ADDRESS=127.0.0.1`，只给本机反代用。无需 PKCS12 / CERT_*。

## 3. Nginx（外部 HTTPS）

对外仍可是 `https://parkinglot.c-avp.com:9065`，反代到本机：

```nginx
# 示意：按现网 conf 调整 listen / server_name / 证书路径
location / {
  proxy_pass http://127.0.0.1:12380;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

若以前反代到 `https://127.0.0.1:9065`，改为 **`http://127.0.0.1:12380`**。

## 4. 构建

```bash
cd /home/wx_ybhzCavpSystem
git pull
mvn -DskipTests package
# 产物：target/wx-ybhz-cavp-system-1.0.0.jar
```

`data/maps` 为缓存：首次启动会按 parkinglot catalog + 标定服同步；也可事后 `POST /api/admin/maps/sync`。

## 5. 安装并启动 systemd

```bash
sudo cp /home/wx_ybhzCavpSystem/infra/systemd/wx-ybhz-cavp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wx-ybhz-cavp
sudo systemctl status wx-ybhz-cavp
```

常用命令：

```bash
sudo systemctl restart wx-ybhz-cavp
sudo journalctl -u wx-ybhz-cavp -f
```

## 6. 验证

```bash
# 本机直连（HTTP）
curl -s http://127.0.0.1:12380/api/maps/index

# 经外部 HTTPS（反代）
curl -sk https://parkinglot.c-avp.com:9065/api/maps/index
```

应返回含 `maps` 的 JSON。

## 7. 日常更新

```bash
cd /home/wx_ybhzCavpSystem
git pull
mvn -DskipTests package
sudo systemctl restart wx-ybhz-cavp
```

## 与旧 deploy-prod.sh 的关系

| 方式 | 说明 |
|------|------|
| **systemd（推荐）** | git + mvn + `systemctl`，本机 `:12380` HTTP |
| `deploy-prod.sh` | 旧：内嵌 HTTPS 9065 + nohup；**已过时**，勿再用于启停进程 |
