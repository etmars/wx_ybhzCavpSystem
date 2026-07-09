package com.ybhzcavp.service;

import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 导航会话路线暂存（避免 URL 传大 JSON / hash 在 web-view 丢失） */
@Service
public class NavRouteService {

    private static final long TTL_MS = 30 * 60 * 1000L;

    private final ConcurrentHashMap<String, Entry> routes = new ConcurrentHashMap<>();

    public void save(String sessionId, Map<String, Object> body) {
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("sessionId required");
        }
        purgeExpired();
        Entry entry = new Entry(
                sessionId,
                stringVal(body.get("mapId")),
                stringVal(body.get("spaceId")),
                doubleVal(body.get("totalLen")),
                doubleVal(body.get("estTotalTime")),
                body.get("pointsPos"),
                System.currentTimeMillis()
        );
        if (entry.pointsPos == null) {
            throw new IllegalArgumentException("pointsPos required");
        }
        routes.put(sessionId, entry);
    }

    public Map<String, Object> get(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            return Map.of("ok", false, "message", "sessionId required");
        }
        purgeExpired();
        Entry entry = routes.get(sessionId);
        if (entry == null) {
            return Map.of("ok", false, "message", "route not found");
        }
        return Map.of(
                "ok", true,
                "sessionId", entry.sessionId,
                "mapId", entry.mapId != null ? entry.mapId : "",
                "spaceId", entry.spaceId != null ? entry.spaceId : "",
                "totalLen", entry.totalLen,
                "estTotalTime", entry.estTotalTime,
                "pointsPos", entry.pointsPos
        );
    }

    private void purgeExpired() {
        long now = System.currentTimeMillis();
        routes.entrySet().removeIf(e -> now - e.getValue().createdAt > TTL_MS);
    }

    private static String stringVal(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    private static double doubleVal(Object v) {
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        if (v != null) {
            try {
                return Double.parseDouble(String.valueOf(v));
            } catch (NumberFormatException ignored) {
            }
        }
        return 0;
    }

    private record Entry(
            String sessionId,
            String mapId,
            String spaceId,
            double totalLen,
            double estTotalTime,
            Object pointsPos,
            long createdAt
    ) {
    }
}
