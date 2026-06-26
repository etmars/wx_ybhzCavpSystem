package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.config.AppProperties;
import com.ybhzcavp.localization.KnnLocalizer;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class ParkingService {

    private static final Logger log = LoggerFactory.getLogger(ParkingService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AppProperties props;
    private final MapDataService mapDataService;
    private JsonNode avpRouteCache;

    public ParkingService(AppProperties props, MapDataService mapDataService) {
        this.props = props;
        this.mapDataService = mapDataService;
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
        lot.put("price", "¥5/h");
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

    public ArrayNode maps(String parkingLotId) {
        ArrayNode arr = MAPPER.createArrayNode();
        MapDataService.MapEntry map = mapDataService.resolveMap("ziguang_1-B2");
        ObjectNode item = MAPPER.createObjectNode();
        item.put("map_file", map != null ? map.name() : "紫光大厦/1-B2");
        item.put("to_coords", "出口A,B2,0.1349,-0.0086|出口B,B1,0.1350,-0.0087");
        arr.add(item);
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

    public Map<String, Object> avpAssignment() {
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
