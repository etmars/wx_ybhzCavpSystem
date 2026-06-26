package com.ybhzcavp.localization;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

public final class LocModelLoader {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private LocModelLoader() {
    }

    public static LocFingerprintModel load(Path file) throws IOException {
        JsonNode root = MAPPER.readTree(Files.readString(file));
        return parse(root);
    }

    public static LocFingerprintModel parse(JsonNode root) {
        List<String> beaconOrder = new ArrayList<>();
        JsonNode orderNode = root.get("beacon_order");
        if (orderNode != null && orderNode.isArray() && !orderNode.isEmpty()) {
            orderNode.forEach(n -> beaconOrder.add(n.asText()));
        } else {
            JsonNode beacons = root.get("beacons");
            if (beacons != null && beacons.isArray()) {
                beacons.forEach(b -> beaconOrder.add(b.get("name").asText()));
            }
        }

        List<Map<String, Integer>> fpRssiList = new ArrayList<>();
        List<double[]> fpLatLngs = new ArrayList<>();

        JsonNode fps = root.get("fingerprints");
        if (fps != null && fps.isArray()) {
            int max = Math.min(fps.size(), 2000);
            for (int i = 0; i < max; i++) {
                JsonNode fp = fps.get(i);
                JsonNode rssi = fp.get("rssi");
                if (rssi == null) {
                    rssi = fp.get("rssi_values");
                }
                if (rssi == null || !rssi.isObject()) {
                    continue;
                }
                Map<String, Integer> snap = new HashMap<>();
                Iterator<Map.Entry<String, JsonNode>> fields = rssi.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> e = fields.next();
                    int value = e.getValue().isNumber()
                            ? e.getValue().intValue()
                            : (int) Math.round(e.getValue().asDouble());
                    if (value >= -95) {
                        snap.put(e.getKey(), value);
                    }
                }
                if (snap.size() < 3) {
                    continue;
                }
                fpRssiList.add(snap);

                double lat;
                double lon;
                if (fp.has("x") && fp.has("y")) {
                    lat = fp.get("y").asDouble();
                    lon = fp.get("x").asDouble();
                } else if (fp.has("lat") && fp.has("lon")) {
                    lat = fp.get("lat").asDouble();
                    lon = fp.get("lon").asDouble();
                } else if (fp.has("loc_coords") && fp.get("loc_coords").size() >= 2) {
                    lat = fp.get("loc_coords").get(0).asDouble();
                    lon = fp.get("loc_coords").get(1).asDouble();
                } else {
                    lat = 0;
                    lon = 0;
                }
                fpLatLngs.add(new double[]{lat, lon});
            }
        }

        return new LocFingerprintModel(beaconOrder, fpRssiList, fpLatLngs);
    }
}
