package com.ybhzcavp.dispatch;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.config.AppProperties;
import com.ybhzcavp.config.dao.ConfigDao;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * 内部调度：贪心最小代价选位（骨架，后续可换 Timefold/匈牙利算法）+ HTTP 调 Python planner。
 */
@Component
public class InternalDispatchProvider implements DispatchProvider {

    private static final Logger log = LoggerFactory.getLogger(InternalDispatchProvider.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {};
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private final AppProperties props;
    private final ConfigDao configDao;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    public InternalDispatchProvider(AppProperties props, ConfigDao configDao) {
        this.props = props;
        this.configDao = configDao;
    }

    @Override
    public String id() {
        return "internal";
    }

    @Override
    public DispatchResult assignAndRoute(String lotId, String vehicleId, String eventType, DispatchContext context) {
        DispatchResult result = new DispatchResult();
        result.setProvider(id());

        List<String> freeSpots = stubFreeSpots(lotId);
        List<String> candidates = filterByLookup(lotId, context != null ? context.getMemberId() : null, freeSpots);
        if (candidates.isEmpty()) {
            result.setSuccess(false);
            result.setMessage("no free spot available");
            return result;
        }

        // 贪心最小代价：按 lookup 顺序代价递增（索引即代价）；后续可换匈牙利/Timefold
        String bestSpot = candidates.stream()
                .min(Comparator.comparingDouble(s -> costOf(s, candidates, context)))
                .orElse(candidates.get(0));
        double cost = costOf(bestSpot, candidates, context);

        DispatchResult.Assignment assignment = new DispatchResult.Assignment();
        assignment.setLotId(lotId);
        assignment.setVehicleId(vehicleId);
        assignment.setSpaceId(bestSpot);
        assignment.setCost(cost);
        result.setAssignment(assignment);

        DispatchResult.Route route = callPlanner(lotId, vehicleId, bestSpot, eventType, context);
        result.setRoute(route);
        result.setSuccess(true);
        result.setMessage("assigned by internal greedy min-cost");

        publishMqttOptional(lotId, vehicleId, result);
        return result;
    }

    /**
     * Stub：占用未知时，用 zones 全部车位作为「空闲」；后续对接真实占用接口。
     */
    private List<String> stubFreeSpots(String lotId) {
        Set<String> occupied = Set.of(); // TODO: 读真实占用
        List<String> free = new ArrayList<>();
        for (Map<String, Object> zone : configDao.listZones(lotId)) {
            for (String spot : parseSpots(zone.get("spotNamesJson"))) {
                if (!occupied.contains(spot)) {
                    free.add(spot);
                }
            }
        }
        if (free.isEmpty()) {
            // 无 zone 配置时回退默认车位，保证联调可用
            free.add(props.getParking().getParkingSpaceNumber());
        }
        return free;
    }

    private List<String> filterByLookup(String lotId, String memberId, List<String> freeSpots) {
        if (memberId == null || memberId.isBlank()) {
            return freeSpots;
        }
        Optional<Map<String, Object>> lookup = configDao.getLookup(lotId, memberId);
        if (lookup.isEmpty()) {
            log.debug("no lookup for memberId={}, use all free spots", memberId);
            return freeSpots;
        }
        try {
            JsonNode entry = MAPPER.readTree(String.valueOf(lookup.get().get("entryJson")));
            List<String> allowed = new ArrayList<>();
            JsonNode spots = entry.path("spots");
            if (spots.isArray()) {
                spots.forEach(n -> allowed.add(n.asText()));
            }
            Set<String> freeSet = new HashSet<>(freeSpots);
            List<String> filtered = new ArrayList<>();
            for (String s : allowed) {
                if (freeSet.contains(s)) {
                    filtered.add(s);
                }
            }
            return filtered.isEmpty() ? freeSpots : filtered;
        } catch (Exception e) {
            log.warn("parse lookup failed: {}", e.getMessage());
            return freeSpots;
        }
    }

    private double costOf(String spot, List<String> ordered, DispatchContext context) {
        // 骨架：lookup 排序靠前代价更低；有 start 坐标时可叠加欧氏距离占位
        int idx = ordered.indexOf(spot);
        double base = idx < 0 ? 9999 : idx;
        if (context != null && context.getStartLat() != null && context.getStartLon() != null) {
            // 无真实车位坐标时用 hash 伪坐标，避免依赖地图
            double spotLat = hashCoord(spot, 0) * 0.001;
            double spotLon = hashCoord(spot, 1) * 0.001;
            double dLat = context.getStartLat() - spotLat;
            double dLon = context.getStartLon() - spotLon;
            base += Math.sqrt(dLat * dLat + dLon * dLon) * 1000;
        }
        return base;
    }

    private static int hashCoord(String spot, int salt) {
        return Math.abs((spot + ":" + salt).hashCode() % 1000);
    }

    @SuppressWarnings("unchecked")
    private DispatchResult.Route callPlanner(String lotId, String vehicleId, String spaceId,
                                             String eventType, DispatchContext context) {
        DispatchResult.Route route = new DispatchResult.Route();
        String base = props.getPlanner().getBaseUrl().replaceAll("/$", "");
        String url = base + "/plan";
        try {
            ObjectNode req = MAPPER.createObjectNode();
            req.put("lotId", lotId);
            req.put("vehicleId", vehicleId);
            req.put("spaceId", spaceId);
            req.put("eventType", eventType != null ? eventType : "1");
            if (context != null) {
                if (context.getStartLat() != null) {
                    req.put("startLat", context.getStartLat());
                }
                if (context.getStartLon() != null) {
                    req.put("startLon", context.getStartLon());
                }
                if (context.getStartFloor() != null) {
                    req.put("startFloor", context.getStartFloor());
                }
            }
            HttpRequest httpReq = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(20))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(req.toString()))
                    .build();
            HttpResponse<String> resp = httpClient.send(httpReq, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() >= 200 && resp.statusCode() < 300 && resp.body() != null && !resp.body().isBlank()) {
                Map<String, Object> body = MAPPER.readValue(resp.body(), MAP_TYPE);
                route.setPlannerResponse(body);
                Object totalLen = body.getOrDefault("totalLen", body.get("total_len"));
                Object est = body.getOrDefault("estTotalTime", body.get("est_total_time"));
                Object points = body.getOrDefault("pointsPos", body.get("points_pos"));
                if (totalLen instanceof Number n) {
                    route.setTotalLen(n.doubleValue());
                }
                if (est instanceof Number n) {
                    route.setEstTotalTime(n.doubleValue());
                }
                if (points instanceof List<?> list) {
                    route.setPointsPos(new ArrayList<>(list));
                }
                return route;
            }
            log.warn("planner HTTP {} body={}", resp.statusCode(), resp.body());
        } catch (Exception e) {
            log.warn("planner call failed url={}: {}", url, e.getMessage());
        }
        // planner 不可用时返回空路径骨架
        route.setTotalLen(0);
        route.setEstTotalTime(0);
        route.setPointsPos(List.of());
        return route;
    }

    private void publishMqttOptional(String lotId, String vehicleId, DispatchResult result) {
        if (!props.getMqtt().isEnabled()) {
            return;
        }
        String broker = props.getMqtt().getBrokerUrl();
        String topic = "cavp/" + lotId + "/dispatch/" + vehicleId;
        String clientId = "cavp-dispatch-" + UUID.randomUUID().toString().substring(0, 8);
        try {
            MqttClient client = new MqttClient(broker, clientId, new MemoryPersistence());
            MqttConnectOptions opts = new MqttConnectOptions();
            opts.setAutomaticReconnect(false);
            opts.setCleanSession(true);
            opts.setConnectionTimeout(5);
            client.connect(opts);
            byte[] payload = MAPPER.writeValueAsBytes(result.toMap());
            MqttMessage msg = new MqttMessage(payload);
            msg.setQos(0);
            client.publish(topic, msg);
            client.disconnect();
            client.close();
            log.info("MQTT published topic={}", topic);
        } catch (Exception e) {
            log.warn("MQTT publish skipped: {}", e.getMessage());
        }
    }

    private List<String> parseSpots(Object raw) {
        if (raw == null) {
            return List.of();
        }
        try {
            String s = String.valueOf(raw).trim();
            if (s.startsWith("[")) {
                return MAPPER.readValue(s, STRING_LIST);
            }
            if (s.isEmpty()) {
                return List.of();
            }
            return List.of(s.split("[,;\\s]+"));
        } catch (Exception e) {
            return List.of();
        }
    }
}
