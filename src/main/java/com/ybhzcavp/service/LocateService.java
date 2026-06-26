package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.localization.KnnLocalizer;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class LocateService {

    private final MapDataService mapDataService;

    public LocateService(MapDataService mapDataService) {
        this.mapDataService = mapDataService;
    }

    public Map<String, Object> locate(String mapId, Map<String, Object> rssiMapRaw) {
        MapDataService.MapEntry map = mapDataService.resolveMap(mapId);
        if (map == null) {
            return Map.of("ok", false, "message", "map not found");
        }
        KnnLocalizer knn = mapDataService.getKnn(map.id());
        if (knn == null) {
            return Map.of("ok", false, "message", "KNN model not ready");
        }

        Map<String, Float> rssiMap = new HashMap<>();
        for (Map.Entry<String, Object> e : rssiMapRaw.entrySet()) {
            if (e.getValue() instanceof Number n) {
                rssiMap.put(e.getKey(), n.floatValue());
            }
        }

        KnnLocalizer.KnnResult result = knn.predict(rssiMap);
        if (result == null) {
            return Map.of("ok", false, "message", "no position", "activeBeacons", rssiMap.size());
        }

        Map<String, Object> resp = new HashMap<>();
        resp.put("ok", true);
        resp.put("latitude", result.latitude());
        resp.put("longitude", result.longitude());
        resp.put("confidence", result.confidence());
        resp.put("nNeighbors", result.nNeighbors());
        resp.put("mode", result.mode());
        resp.put("map_id", map.id());
        return resp;
    }

    public ObjectNode mapMeta(String mapId) {
        MapDataService.MapEntry map = mapDataService.resolveMap(mapId);
        ObjectNode node = mapDataService.getFloorGeometry(map != null ? map.id() : mapId).toGeoJson();
        if (map != null) {
            node.put("map_id", map.id());
            node.put("map_name", map.name());
        }
        return node;
    }
}
