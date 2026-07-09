# wx_ybhzCavpSystem

宜泊慧智 C-AVP 后端服务，对齐 Android `UserApp-osmandroid` 的 API 契约、地图瓦片与 KNN 室内定位。

## 功能

| 模块 | 端点 | 说明 |
|------|------|------|
| 停车场 | `GET /api/nearby`, `/api/maps`, `/avp/totalparking`, `POST /avp/sub` | 对齐 HomeActivity |
| AVP 分配 | `GET /api/avp/assignment` | 读取 `I1000110.txt` 路线数据 |
| 地图瓦片 | `GET /tiles/{z}/{x}/{y}.pbf?map_id=` | mbtiles 矢量瓦片（对齐 MbtilesServer） |
| 地图几何 | `GET /api/maps/{id}/geometry` | OSM 解析 GeoJSON，供小程序 Canvas |
| 定位 | `POST /api/locate` | 服务端 KNN（对齐 KnnLocalizer.kt） |
| 模型 | `GET /api/model/*` | loc_model、beacon_catalog、map_bearing |
| 标定 | `/api/calibration/*` | 标定点 CRUD |

## 地图数据

启动时自动从 `app.osmandroid-assets` 同步到 `./data`：

- 默认路径：`F:/osmandroid/OsmAndroidDemo/app/build/generated/assets/osm`
- 包含：`maps_index.json`、`loc_model.json`、`maps/*/parking.mbtiles`、`yiqi.osm`

## 启动

```bash
# 需要 JDK 17+ 与 Maven
cd F:\wx_ybhzCavpSystem
mvn spring-boot:run
```

服务默认端口：**12380**（本地 HTTP）；生产环境见 `application-prod.yml`（**9065** HTTPS，Nginx 反代）。

## 配置

`application.yml`:

```yaml
app:
  data-dir: ./data
  osmandroid-assets: F:/osmandroid/OsmAndroidDemo/app/build/generated/assets/osm
```

## 定位 API 示例

```http
POST /api/locate
Content-Type: application/json

{
  "mapId": "ziguang_1-B2",
  "rssiMap": {
    "ibeacon:name:IBN10014401": -65,
    "ibeacon:name:IBN10014405": -72
  }
}
```

响应：

```json
{
  "ok": true,
  "latitude": 0.1349,
  "longitude": -0.0086,
  "confidence": 0.85,
  "mode": "rel"
}
```

## 微信小程序联调

1. 启动本后端（本地 12380；服务器 prod 为 9065）
2. 微信开发者工具打开 `wx_ybhzcavp`
3. 勾选「不校验合法域名」
4. `config.js` 中 `BASE_URL` 改为本机 IP（真机调试时不能用 localhost）
