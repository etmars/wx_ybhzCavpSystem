# 部署指南

## 一、整体架构

```
手机微信小程序 (wx_ybhzcavp)
  ├─ 本地 KNN 定位（assets/loc_model.json + BLE）  ← 不需要联网
  └─ 地图/路线 API ──────────→ 后端 (wx_ybhzCavpSystem 本机 HTTP:12380；对外 HTTPS 由反代)
```

**定位在手机上本地算，后端只负责地图几何和车位分配。**

---

## 二、本地开发（最快跑起来）

### 步骤 1：启动后端

**方式 A（推荐）**：双击运行

```
F:\wx_ybhzCavpSystem\run.bat
```

**方式 B**：IntelliJ IDEA

1. File → Open → 选择 `F:\wx_ybhzCavpSystem`
2. 等待 Maven 依赖下载完成
3. 运行 `WxYbhzCavpApplication.java`

**方式 C**：命令行（需已安装 Maven）

```bash
cd F:\wx_ybhzCavpSystem
mvn spring-boot:run
```

看到 `Started WxYbhzCavpApplication` 即成功。浏览器访问：

```
http://localhost:12380/api/nearby?lng=120.635716&lat=31.422788&radius=5000
```

应返回 JSON 停车场数据。

### 步骤 2：启动小程序

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入项目：`F:\wx_ybhzcavp`
3. AppID 选「测试号」或填入你的 AppID
4. **详情 → 本地设置 → 勾选「不校验合法域名、web-view、TLS」**
5. 点击「编译」

### 步骤 3：模拟器调试

`config.js` 保持默认即可：

```js
const BASE_URL = 'http://localhost:12380';
```

流程：首页 → 我要停车 → 按路线行驶 → 导航页

> 模拟器**没有蓝牙**，定位不会动，只能看地图和路线 UI。

### 步骤 4：真机调试（完整功能）

1. 手机和电脑连同一 WiFi
2. 查电脑 IP：`ipconfig`（例如 `192.168.1.100`）
3. 修改 `F:\wx_ybhzcavp\config.js`：

```js
const BASE_URL = 'http://192.168.1.100:12380';
```

4. 微信开发者工具 → 预览 → 手机扫码
5. 手机开启蓝牙，在停车场信标范围内测试定位

---

## 三、常见问题（卡住的地方）

| 现象 | 原因 | 解决 |
|------|------|------|
| `run.bat` 报 Maven 未找到 | 没装 Maven | 用 IntelliJ 打开运行，或让 run.bat 自动下载 |
| 首页显示「后端未连接」 | 后端没启动或地址错 | 先启动后端，检查 12380 端口 |
| 真机连不上 localhost | 手机访问不到本机 | 改成电脑局域网 IP |
| 导航页地图空白 | 后端 geometry API 失败 | 确认 map-sync 已跑通，或存在 `data/maps/<map_id>/map.osm`（兼容 yiqi.osm） |
| 定位不动 | 模拟器无 BLE | 必须真机 + 蓝牙 + 信标环境 |
| 上传失败 主包超限 | loc_model.json 约 0.5MB | 见下方「分包」 |

---

## 四、生产部署（推荐 systemd，不必提交 jar）

与 IPDSV / AvpPlanning 相同：**服务器 git pull → mvn package → systemd**。  
运行时仍是 Spring Boot 的 `target/*.jar`，但**不要**再走「本地打 jar → 提交 dist → scp」。

完整步骤见：[infra/systemd/README.md](infra/systemd/README.md)

摘要：

```bash
cd /opt/cavp/wx_ybhzCavpSystem
sudo -u cavp git pull
sudo -u cavp mvn -DskipTests package
sudo systemctl restart wx-ybhz-cavp   # 首次：enable --now，见 README
```

服务监听本机 **HTTP 12380**（`application-prod.yml`，默认 `127.0.0.1`）。  
对外 HTTPS（如 `:9065`）由 Nginx 反代，应用内不再配证书。环境变量见 `cavp.env`。

开发与生产端口一致，均为 **12380**：

```bash
mvn spring-boot:run
# 或
java -jar target/wx-ybhz-cavp-system-1.0.0.jar
# 生产加 --spring.profiles.active=prod（绑定 127.0.0.1）
```

旧脚本 `deploy-prod.sh`（内嵌 HTTPS）已过时；**进程启停请用 systemd**。

地图权威源为 parkinglot catalog + 标定服资产；`data/maps` 仅为缓存。

### 小程序（正式发布）

1. 修改 `config.js`：

```js
const BASE_URL = 'https://your-domain.com';
```

2. 登录 [微信公众平台](https://mp.weixin.qq.com/) → 开发管理 → 开发设置 → **服务器域名**：

   - request 合法域名：`https://your-domain.com`

3. 微信开发者工具 → 上传 → 提交审核 → 发布

4. **定位不需要配置服务器域名**（本地 KNN），但地图/分配接口需要。

### loc_model 分包（主包超 2MB 时）

在 `app.json` 增加：

```json
"subPackages": [
  {
    "root": "package-loc",
    "name": "loc",
    "pages": ["pages/blank/blank"]
  }
]
```

把 `assets/loc_model.json` 移到 `package-loc/`，并改 `loc-model.js` 的 require 路径。

---

## 五、最小验证清单

- [ ] `http://localhost:12380/api/nearby?lng=120.635716&lat=31.422788&radius=5000` 有 JSON
- [ ] `http://localhost:12380/api/avp/assignment` 返回 F074 路线
- [ ] `http://localhost:12380/api/maps/ziguang_1-B2/geometry` 返回地图几何
- [ ] 微信开发者工具首页能分配车位
- [ ] 真机蓝牙开启后能定位（停车场内）
