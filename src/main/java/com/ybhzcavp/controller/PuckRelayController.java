package com.ybhzcavp.controller;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * web-view H5 与小程序之间的实时定位中转。
 * 小程序定位后将坐标 POST 到 /api/puck，H5 轮询 GET /api/puck/latest。
 * key = mapId + ":" + sessionId，避免不同会话串扰。
 */
@RestController
public class PuckRelayController {

    private static final long TTL_MS = 10_000L;
    private final Map<String, PuckEntry> store = new ConcurrentHashMap<>();

    @PostMapping("/api/puck")
    public Map<String, Object> postPuck(@RequestBody PuckRequest req) {
        String key = key(req.mapId(), req.sessionId());
        PuckEntry entry = new PuckEntry(req.latitude(), req.longitude(), System.currentTimeMillis());
        store.put(key, entry);
        return Map.of("ok", true);
    }

    @GetMapping("/api/puck/latest")
    public Map<String, Object> latestPuck(
            @RequestParam(defaultValue = "ziguang_1-B2") String mapId,
            @RequestParam(defaultValue = "default") String sessionId) {
        PuckEntry entry = store.get(key(mapId, sessionId));
        long now = System.currentTimeMillis();
        if (entry == null || now - entry.ts > TTL_MS) {
            return Map.of("ok", false, "message", "no puck");
        }
        return Map.of(
                "ok", true,
                "latitude", entry.lat,
                "longitude", entry.lon,
                "ts", entry.ts
        );
    }

    private static String key(String mapId, String sessionId) {
        return (mapId == null ? "default" : mapId) + ":" + (sessionId == null ? "default" : sessionId);
    }

    public record PuckRequest(String mapId, String sessionId, double latitude, double longitude) {
    }

    private record PuckEntry(double lat, double lon, long ts) {
    }
}
