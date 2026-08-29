package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.config.AppProperties;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 用户当前位置到目标车位的人行路线。
 *
 * CavpSystem 只负责参数校验与契约扁平化，实际路径由 AvpPlanning 在 OSM
 * 1004 中心线路网上计算，避免直线穿墙。
 */
@Service
public class WalkRouteService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final MapDataService mapDataService;
    private final AppProperties props;
    private final HttpClient httpClient;

    public WalkRouteService(MapDataService mapDataService, AppProperties props) {
        this(mapDataService, props, HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build());
    }

    WalkRouteService(MapDataService mapDataService, AppProperties props, HttpClient httpClient) {
        this.mapDataService = mapDataService;
        this.props = props;
        this.httpClient = httpClient;
    }

    public Map<String, Object> plan(
            String lotId,
            String mapId,
            String spaceId,
            double originLng,
            double originLat
    ) {
        validate(mapId, spaceId, originLng, originLat);
        MapDataService.MapEntry map = mapDataService.resolveMap(mapId);
        if (map == null) {
            throw new WalkTargetNotFoundException("map not found: " + mapId);
        }

        OsmMapSceneParser.MapScene scene = mapDataService.getMapScene(map.id());
        if (scene.centerLat() != 0 && scene.centerLon() != 0
                && haversineMeters(originLat, originLng, scene.centerLat(), scene.centerLon()) > 500) {
            throw new WalkOriginOutOfRangeException("origin is outside parking lot");
        }
        boolean targetExists = scene.parkingLabels().stream()
                .anyMatch(p -> matchesSpace(p, spaceId));
        if (!targetExists) {
            throw new WalkTargetNotFoundException("space not found: " + spaceId);
        }

        JsonNode plannerResponse = callPlanner(map.id(), spaceId, originLng, originLat);
        JsonNode info = plannerResponse.path("infoData");
        ArrayNode flattened = flattenPoints(info.path("pathList"));
        if (flattened.size() < 2) {
            throw new WalkPlannerException("planner returned fewer than two route points");
        }

        double totalLen = info.path("totalLen").asDouble(0);
        if (!(totalLen > 0)) {
            totalLen = polylineLength(flattened);
        }
        double speed = Math.max(0.5, props.getNavigation().getWalkSpeedMps());
        double estTotalTime = info.path("estTotalTime").asDouble(totalLen / speed);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        body.put("lotId", lotId == null ? "" : lotId);
        body.put("mapId", map.id());
        body.put("spaceId", spaceId);
        body.put("pointsPos", MAPPER.convertValue(flattened, List.class));
        body.put("totalLen", totalLen);
        body.put("estTotalTime", estTotalTime);
        body.put("planner", "avp-planning-osm");
        return body;
    }

    private JsonNode callPlanner(String mapId, String spaceId, double originLng, double originLat) {
        ObjectNode body = MAPPER.createObjectNode();
        body.put("osm_map_name", mapId);
        body.put("avg_speed_mps", props.getNavigation().getWalkSpeedMps());
        ObjectNode entrance = body.putObject("entrance");
        entrance.put("lon", originLng);
        entrance.put("lat", originLat);
        entrance.put("elevation", 0);
        body.putObject("target").put("space_id", spaceId);

        try {
            String base = props.getWalkPlanner().getBaseUrl().replaceAll("/$", "");
            HttpRequest request = HttpRequest.newBuilder(URI.create(base + "/plan"))
                    .timeout(Duration.ofSeconds(30))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body)))
                    .build();
            HttpResponse<String> response = httpClient.send(
                    request,
                    HttpResponse.BodyHandlers.ofString()
            );
            JsonNode parsed = MAPPER.readTree(response.body());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                String detail = parsed.path("error").asText(parsed.path("message").asText());
                throw new WalkPlannerException("planner HTTP " + response.statusCode() + ": " + detail);
            }
            return parsed;
        } catch (WalkPlannerException e) {
            throw e;
        } catch (Exception e) {
            throw new WalkPlannerException("planner unavailable: " + e.getMessage(), e);
        }
    }

    static ArrayNode flattenPoints(JsonNode pathList) {
        ArrayNode points = MAPPER.createArrayNode();
        if (!pathList.isArray()) return points;
        for (JsonNode segment : pathList) {
            JsonNode segmentPoints = segment.path("pointsPos");
            if (!segmentPoints.isArray()) continue;
            for (JsonNode point : segmentPoints) {
                if (points.isEmpty() || !samePoint(points.get(points.size() - 1), point)) {
                    points.add(point);
                }
            }
        }
        return points;
    }

    private static boolean samePoint(JsonNode a, JsonNode b) {
        return Math.abs(a.path("longitude").asDouble() - b.path("longitude").asDouble()) < 1e-9
                && Math.abs(a.path("latitude").asDouble() - b.path("latitude").asDouble()) < 1e-9;
    }

    private static boolean matchesSpace(OsmMapSceneParser.LabelPoint point, String spaceId) {
        String wanted = spaceId.trim();
        return wanted.equalsIgnoreCase(String.valueOf(point.label()).trim())
                || wanted.equalsIgnoreCase(String.valueOf(point.id()).trim());
    }

    private static void validate(String mapId, String spaceId, double originLng, double originLat) {
        if (mapId == null || mapId.isBlank()) throw new IllegalArgumentException("mapId is required");
        if (spaceId == null || spaceId.isBlank()) throw new IllegalArgumentException("spaceId is required");
        if (!Double.isFinite(originLng) || !Double.isFinite(originLat)) {
            throw new IllegalArgumentException("originLng and originLat are required");
        }
    }

    private static double polylineLength(ArrayNode points) {
        double total = 0;
        for (int i = 1; i < points.size(); i++) {
            JsonNode a = points.get(i - 1);
            JsonNode b = points.get(i);
            total += haversineMeters(
                    a.path("latitude").asDouble(),
                    a.path("longitude").asDouble(),
                    b.path("latitude").asDouble(),
                    b.path("longitude").asDouble()
            );
        }
        return total;
    }

    static double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        double radius = 6_371_000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    public static class WalkTargetNotFoundException extends RuntimeException {
        public WalkTargetNotFoundException(String message) {
            super(message);
        }
    }

    public static class WalkOriginOutOfRangeException extends RuntimeException {
        public WalkOriginOutOfRangeException(String message) {
            super(message);
        }
    }

    public static class WalkPlannerException extends RuntimeException {
        public WalkPlannerException(String message) {
            super(message);
        }

        public WalkPlannerException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
