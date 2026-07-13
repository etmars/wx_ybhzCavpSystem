package com.ybhzcavp.controller;



import java.util.LinkedHashMap;

import java.util.List;

import java.util.Map;

import java.util.concurrent.ConcurrentHashMap;



import org.springframework.web.bind.annotation.GetMapping;

import org.springframework.web.bind.annotation.PostMapping;

import org.springframework.web.bind.annotation.RequestBody;

import org.springframework.web.bind.annotation.RequestParam;

import org.springframework.web.bind.annotation.RestController;



@RestController
/** @deprecated 定位已改小程序 Hash 通道本地传递，不再使用 puck 中继 */
public class PuckRelayController {



    private static final long TTL_MS = 10_000L;



    private static final List<String> SENSOR_KEYS = List.of(

            "gyroDegS", "gyroVar", "accelNorm", "accelHp", "imuSpd", "knnSpd", "routeSpd", "imuHp",

            "gameBearing", "offsetCal", "gameOnly", "magNorm", "magBearingDeg", "magNe", "trulyStill");



    private final Map<String, PuckEntry> store = new ConcurrentHashMap<>();



    @PostMapping("/api/puck")

    public Map<String, Object> postPuck(@RequestBody Map<String, Object> raw) {

        String mapId = asString(raw.get("mapId"));

        String sessionId = asString(raw.get("sessionId"));

        double lat = asDouble(raw.get("latitude"));

        double lon = asDouble(raw.get("longitude"));

        long ts = asLong(raw.get("ts"));

        if (ts <= 0) ts = System.currentTimeMillis();



        PuckEntry entry = new PuckEntry(

                lat,

                lon,

                ts,

                asDoubleObj(raw.get("bearing")),

                asFloatObj(raw.get("confidence")),

                asIntObj(raw.get("beaconCount")),

                asDoubleObj(raw.get("imuSpeedMps")),

                asDoubleObj(raw.get("angularSpeedRadS")),

                asBoolObj(raw.get("parked")),

                asBoolObj(raw.get("bumpDetected")),

                asLongObj(raw.get("bumpTs")),

                asFloatObj(raw.get("histConfidence")),

                asBoolObj(raw.get("softDisplay")),

                asBoolObj(raw.get("gateRejected")),

                asBoolObj(raw.get("rotationOnly")),

                asIntObj(raw.get("navLocSuccessCount")),

                asBoolObj(raw.get("imuLaunchConfirmed")),

                extractSensorDebug(raw));

        store.put(key(mapId, sessionId), entry);

        return Map.of("ok", true);

    }



    @GetMapping("/api/puck/latest")

    public Map<String, Object> latestPuck(

            @RequestParam(defaultValue = "") String mapId,

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

        if (entry.sensorDebug != null && !entry.sensorDebug.isEmpty()) {

            out.put("sensorDebug", entry.sensorDebug);

            entry.sensorDebug.forEach((k, v) -> {

                if (v != null && !out.containsKey(k)) out.put(k, v);

            });

        }

        return out;

    }



    private static Map<String, Object> extractSensorDebug(Map<String, Object> raw) {

        Map<String, Object> sd = new LinkedHashMap<>();

        Object nested = raw.get("sensorDebug");

        if (nested instanceof Map<?, ?> nestedMap) {

            nestedMap.forEach((k, v) -> {

                if (k != null && v != null) sd.put(String.valueOf(k), v);

            });

        }

        for (String k : SENSOR_KEYS) {

            if (raw.containsKey(k) && !sd.containsKey(k)) {

                Object v = raw.get(k);

                if (v != null) sd.put(k, v);

            }

        }

        return sd.isEmpty() ? null : sd;

    }



    private static String key(String mapId, String sessionId) {

        return (mapId == null ? "default" : mapId) + ":" + (sessionId == null ? "default" : sessionId);

    }



    private static String asString(Object v) {

        return v == null ? null : String.valueOf(v);

    }



    private static double asDouble(Object v) {

        if (v instanceof Number n) return n.doubleValue();

        if (v instanceof String s) {

            try {

                return Double.parseDouble(s);

            } catch (NumberFormatException ignored) {

                return 0d;

            }

        }

        return 0d;

    }



    private static Double asDoubleObj(Object v) {

        if (v == null) return null;

        if (v instanceof Number n) return n.doubleValue();

        if (v instanceof String s) {

            try {

                return Double.parseDouble(s);

            } catch (NumberFormatException ignored) {

                return null;

            }

        }

        return null;

    }



    private static Float asFloatObj(Object v) {

        Double d = asDoubleObj(v);

        return d == null ? null : d.floatValue();

    }



    private static Integer asIntObj(Object v) {

        if (v == null) return null;

        if (v instanceof Number n) return n.intValue();

        if (v instanceof String s) {

            try {

                return Integer.parseInt(s);

            } catch (NumberFormatException ignored) {

                return null;

            }

        }

        return null;

    }



    private static Long asLong(Object v) {

        if (v == null) return 0L;

        if (v instanceof Number n) return n.longValue();

        if (v instanceof String s) {

            try {

                return Long.parseLong(s);

            } catch (NumberFormatException ignored) {

                return 0L;

            }

        }

        return 0L;

    }



    private static Long asLongObj(Object v) {

        if (v == null) return null;

        if (v instanceof Number n) return n.longValue();

        if (v instanceof String s) {

            try {

                return Long.parseLong(s);

            } catch (NumberFormatException ignored) {

                return null;

            }

        }

        return null;

    }



    private static Boolean asBoolObj(Object v) {

        if (v == null) return null;

        if (v instanceof Boolean b) return b;

        if (v instanceof Number n) return n.intValue() != 0;

        if (v instanceof String s) return Boolean.parseBoolean(s);

        return null;

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

            Boolean imuLaunchConfirmed,

            Map<String, Object> sensorDebug) {

    }

}


