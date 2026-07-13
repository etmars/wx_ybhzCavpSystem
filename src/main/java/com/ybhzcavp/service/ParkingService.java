package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.config.AppProperties;
import com.ybhzcavp.dispatch.DispatchContext;
import com.ybhzcavp.dispatch.DispatchResult;
import com.ybhzcavp.dispatch.DispatchRouter;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class ParkingService {

    private static final Logger log = LoggerFactory.getLogger(ParkingService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AppProperties props;
    private final MapDataService mapDataService;
    private final DispatchRouter dispatchRouter;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .build();
    private JsonNode avpRouteCache;

    public ParkingService(AppProperties props, MapDataService mapDataService, DispatchRouter dispatchRouter) {
        this.props = props;
        this.mapDataService = mapDataService;
        this.dispatchRouter = dispatchRouter;
    }

    @PostConstruct
    public void loadAvpRoute() {
        Path file = mapDataService.getDataRoot().resolve("I1000110.txt");
        if (!Files.exists(file)) {
            log.warn("AVP route file missing: {}", file);
            return;
        }
        try {
            avpRouteCache = MAPPER.readTree(file.toFile());
            log.info("Loaded AVP route from {}", file);
        } catch (IOException e) {
            log.error("Failed to load AVP route", e);
        }
    }

    public ObjectNode nearby(double lng, double lat, int radius) {
        ObjectNode root = MAPPER.createObjectNode();
        ArrayNode data = MAPPER.createArrayNode();
        ObjectNode lot = MAPPER.createObjectNode();
        lot.put("id", props.getParking().getDefaultParkingId());
        lot.put("name", "宜泊慧智地下停车场");
        lot.put("address", "紫光大厦 B2");
        lot.put("distance_m", 86.0);
        lot.put("emptySpots", 12408);
        lot.put("totalSpots", 20000);
        lot.put("price", "¥6/h");
        lot.put("WGS84", lng + "," + lat);
        lot.putArray("features").add("充电桩");
        ArrayNode floors = lot.putArray("floors");
        floors.add("B2");
        floors.add("B1");
        data.add(lot);
        root.set("data", data);
        return root;
    }

    public ArrayNode parkingLots() {
        ArrayNode arr = MAPPER.createArrayNode();
        ObjectNode lot = MAPPER.createObjectNode();
        lot.put("id", props.getParking().getDefaultParkingId());
        lot.put("name", "宜泊慧智地下停车场");
        arr.add(lot);
        return arr;
    }

    /**
     * 转发 parkinglot {@code GET /api/maps?parking_lot_id=}；失败时回退本地已同步地图。
     */
    public ArrayNode maps(String parkingLotId) {
        String lotId = (parkingLotId == null || parkingLotId.isBlank())
                ? props.getParking().getDefaultParkingId()
                : parkingLotId.trim();
        try {
            String base = props.getParking().getApiBaseUrl().replaceAll("/$", "");
            String url = base + "/api/maps?parking_lot_id="
                    + URLEncoder.encode(lotId, StandardCharsets.UTF_8);
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(15))
                    .GET()
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (resp.statusCode() == 200) {
                JsonNode body = MAPPER.readTree(resp.body());
                if (body.isArray()) {
                    return (ArrayNode) body;
                }
                if (body.has("data") && body.get("data").isArray()) {
                    return (ArrayNode) body.get("data");
                }
            }
            log.warn("parkinglot /api/maps HTTP {} for lot={}", resp.statusCode(), lotId);
        } catch (Exception e) {
            log.warn("parkinglot /api/maps proxy failed lot={}: {}", lotId, e.getMessage());
        }
        return fallbackMapsFromLocalCache();
    }

    private ArrayNode fallbackMapsFromLocalCache() {
        ArrayNode arr = MAPPER.createArrayNode();
        for (MapDataService.MapEntry map : mapDataService.listMaps()) {
            ObjectNode item = MAPPER.createObjectNode();
            item.put("map_file", map.name() + ".osm");
            item.put("map_id", map.id());
            item.put("display_name", map.name());
            item.set("assets_crc32", MAPPER.createObjectNode());
            arr.add(item);
        }
        return arr;
    }

    public ObjectNode totalParking(String parkingId) {
        ObjectNode root = MAPPER.createObjectNode();
        ArrayNode data = MAPPER.createArrayNode();
        for (int i = 0; i < 200; i++) {
            ObjectNode spot = MAPPER.createObjectNode();
            spot.put("status", i % 3 == 0 ? 1 : 0);
            data.add(spot);
        }
        root.set("data", data);
        return root;
    }

    /**
     * 兼容旧 H5 {@code GET /api/avp/assignment}。
     * 优先委托 {@link DispatchRouter}（新 API：{@code POST /api/dispatch/{lotId}/trigger}）；
     * 若调度失败则回退本地 AVP 路线缓存。
     */
    public Map<String, Object> avpAssignment() {
        String lotId = props.getParking().getDefaultParkingId();
        String vehicleId = props.getParking().getVehicleId();
        try {
            DispatchResult dr = dispatchRouter.trigger(lotId, vehicleId, "1", new DispatchContext());
            if (dr.isSuccess() && dr.getAssignment() != null) {
                Map<String, Object> result = new HashMap<>();
                result.put("spaceId", dr.getAssignment().getSpaceId());
                result.put("parkingId", lotId);
                result.put("provider", dr.getProvider());
                if (dr.getRoute() != null) {
                    result.put("totalLen", dr.getRoute().getTotalLen());
                    result.put("estTotalTime", dr.getRoute().getEstTotalTime());
                    result.put("pointsPos", dr.getRoute().getPointsPos());
                } else {
                    result.put("totalLen", 0);
                    result.put("estTotalTime", 0);
                    result.put("pointsPos", List.of());
                }
                // planner 未就绪时用本地缓存补齐路径，避免 H5 预览空白
                Object points = result.get("pointsPos");
                boolean emptyRoute = !(points instanceof List<?> list) || list.isEmpty();
                if (emptyRoute && avpRouteCache != null) {
                    Map<String, Object> cached = fallbackAvpAssignmentFromCache();
                    result.put("totalLen", cached.get("totalLen"));
                    result.put("estTotalTime", cached.get("estTotalTime"));
                    result.put("pointsPos", cached.get("pointsPos"));
                }
                return result;
            }
            log.debug("dispatch not usable ({}), fallback to cache", dr.getMessage());
        } catch (Exception e) {
            log.warn("dispatch via DispatchRouter failed, fallback to cache: {}", e.getMessage());
        }
        return fallbackAvpAssignmentFromCache();
    }

    private Map<String, Object> fallbackAvpAssignmentFromCache() {
        Map<String, Object> result = new HashMap<>();
        if (avpRouteCache == null) {
            result.put("spaceId", "F074");
            result.put("totalLen", 86.0);
            result.put("estTotalTime", 120.0);
            result.put("pointsPos", List.of());
            return result;
        }
        JsonNode info = avpRouteCache.path("infoData");
        result.put("spaceId", info.path("spaceId").asText("F074"));
        result.put("parkingId", info.path("parkingId").asText(props.getParking().getDefaultParkingId()));
        result.put("totalLen", info.path("totalLen").asDouble(145.06));
        result.put("estTotalTime", info.path("estTotalTime").asDouble(7.2) * 60);
        JsonNode pathList = info.path("pathList");
        if (pathList.isArray() && !pathList.isEmpty()) {
            result.put("pointsPos", pathList.get(0).path("pointsPos"));
        }
        return result;
    }

    public ObjectNode avpSubBody() {
        ObjectNode body = MAPPER.createObjectNode();
        body.put("timestamp", System.currentTimeMillis());
        body.put("vehicleId", props.getParking().getVehicleId());
        body.put("msgSeq", 1);
        ArrayNode func = body.putArray("funcSwitchData");
        ObjectNode f = MAPPER.createObjectNode();
        f.put("funcId", 131);
        f.put("switchStatus", 1);
        func.add(f);
        ObjectNode ext = MAPPER.createObjectNode();
        ext.put("length", 0);
        ext.put("content", "");
        body.set("ext", ext);
        return body;
    }
}
