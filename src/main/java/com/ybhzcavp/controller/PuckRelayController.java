package com.ybhzcavp.controller;



import java.util.LinkedHashMap;

import java.util.Map;

import java.util.concurrent.ConcurrentHashMap;



import org.springframework.web.bind.annotation.GetMapping;

import org.springframework.web.bind.annotation.PostMapping;

import org.springframework.web.bind.annotation.RequestBody;

import org.springframework.web.bind.annotation.RequestParam;

import org.springframework.web.bind.annotation.RestController;



@RestController

public class PuckRelayController {



    private static final long TTL_MS = 10_000L;

    private final Map<String, PuckEntry> store = new ConcurrentHashMap<>();



    @PostMapping("/api/puck")

    public Map<String, Object> postPuck(@RequestBody PuckRequest req) {

        String key = key(req.mapId(), req.sessionId());

        long ts = req.ts() != null && req.ts() > 0 ? req.ts() : System.currentTimeMillis();

        PuckEntry entry = new PuckEntry(

                req.latitude(),

                req.longitude(),

                ts,

                req.bearing(),

                req.confidence(),

                req.beaconCount(),

                req.imuSpeedMps(),

                req.angularSpeedRadS(),

                req.parked(),

                req.bumpDetected(),

                req.bumpTs(),

                req.histConfidence(),

                req.softDisplay(),

                req.gateRejected(),

                req.rotationOnly(),

                req.navLocSuccessCount(),

                req.imuLaunchConfirmed());

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

        Map<String, Object> out = new LinkedHashMap<>();

        out.put("ok", true);

        out.put("latitude", entry.lat);

        out.put("longitude", entry.lon);

        out.put("ts", entry.ts);

        if (entry.bearing != null) out.put("bearing", entry.bearing);

        if (entry.confidence != null) out.put("confidence", entry.confidence);

        if (entry.beaconCount != null) out.put("beaconCount", entry.beaconCount);

        if (entry.imuSpeedMps != null) out.put("imuSpeedMps", entry.imuSpeedMps);

        if (entry.angularSpeedRadS != null) out.put("angularSpeedRadS", entry.angularSpeedRadS);

        if (entry.parked != null) out.put("parked", entry.parked);

        if (entry.bumpDetected != null) out.put("bumpDetected", entry.bumpDetected);

        if (entry.bumpTs != null) out.put("bumpTs", entry.bumpTs);

        if (entry.histConfidence != null) out.put("histConfidence", entry.histConfidence);

        if (entry.softDisplay != null) out.put("softDisplay", entry.softDisplay);

        if (entry.gateRejected != null) out.put("gateRejected", entry.gateRejected);

        if (entry.rotationOnly != null) out.put("rotationOnly", entry.rotationOnly);

        if (entry.navLocSuccessCount != null) out.put("navLocSuccessCount", entry.navLocSuccessCount);

        if (entry.imuLaunchConfirmed != null) out.put("imuLaunchConfirmed", entry.imuLaunchConfirmed);

        return out;

    }



    private static String key(String mapId, String sessionId) {

        return (mapId == null ? "default" : mapId) + ":" + (sessionId == null ? "default" : sessionId);

    }



    public record PuckRequest(

            String mapId,

            String sessionId,

            double latitude,

            double longitude,

            Double bearing,

            Float confidence,

            Integer beaconCount,

            Double imuSpeedMps,

            Double angularSpeedRadS,

            Boolean parked,

            Boolean bumpDetected,

            Long bumpTs,

            Float histConfidence,

            Boolean softDisplay,

            Boolean gateRejected,

            Boolean rotationOnly,

            Integer navLocSuccessCount,

            Boolean imuLaunchConfirmed,

            Long ts) {

    }



    private record PuckEntry(

            double lat,

            double lon,

            long ts,

            Double bearing,

            Float confidence,

            Integer beaconCount,

            Double imuSpeedMps,

            Double angularSpeedRadS,

            Boolean parked,

            Boolean bumpDetected,

            Long bumpTs,

            Float histConfidence,

            Boolean softDisplay,

            Boolean gateRejected,

            Boolean rotationOnly,

            Integer navLocSuccessCount,

            Boolean imuLaunchConfirmed) {

    }

}

