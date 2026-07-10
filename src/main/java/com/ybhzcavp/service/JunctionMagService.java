package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.service.MapDataService.MapEntry;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;

/** 从 loc_model.json 指纹解析 junction 地磁点，供 B3 路口消歧 */
@Service
public class JunctionMagService {

    private final MapDataService mapDataService;
    private final ObjectMapper mapper = new ObjectMapper();

    public JunctionMagService(MapDataService mapDataService) {
        this.mapDataService = mapDataService;
    }

    public byte[] buildJson(String mapId) {
        try {
            MapEntry map = mapDataService.resolveMap(mapId);
            Path locModel = map != null && Files.exists(map.locModel())
                    ? map.locModel()
                    : mapDataService.getDataRoot().resolve("loc_model.json");
            if (!Files.exists(locModel)) {
                return emptyPointsJson();
            }
            JsonNode root = mapper.readTree(locModel.toFile());
            ArrayNode points = mapper.createArrayNode();
            JsonNode fps = root.get("fingerprints");
            if (fps != null && fps.isArray()) {
                for (JsonNode fp : fps) {
                    JsonNode mag = fp.get("mag");
                    Double lat = null;
                    Double lon = null;
                    if (fp.has("lat") && fp.has("lon")) {
                        lat = fp.get("lat").asDouble();
                        lon = fp.get("lon").asDouble();
                    } else if (fp.has("y") && fp.has("x")) {
                        lat = fp.get("y").asDouble();
                        lon = fp.get("x").asDouble();
                    }
                    if (lat == null || lon == null) continue;
                    ObjectNode p = mapper.createObjectNode();
                    p.put("latitude", lat);
                    p.put("longitude", lon);
                    if (mag != null && mag.has("n")) {
                        p.put("n", mag.get("n").asDouble());
                        p.put("e", mag.get("e").asDouble());
                        p.put("d", mag.get("d").asDouble());
                    } else if (fp.has("mag_north_ut")) {
                        p.put("n", fp.get("mag_north_ut").asDouble());
                        p.put("e", fp.get("mag_east_ut").asDouble());
                        p.put("d", fp.get("mag_down_ut").asDouble());
                    } else {
                        continue;
                    }
                    points.add(p);
                }
            }
            ObjectNode out = mapper.createObjectNode();
            out.set("points", points);
            out.put("map_id", mapId);
            out.put("count", points.size());
            return mapper.writeValueAsBytes(out);
        } catch (Exception e) {
            return emptyPointsJson();
        }
    }

    private byte[] emptyPointsJson() {
        try {
            ObjectNode out = mapper.createObjectNode();
            out.set("points", mapper.createArrayNode());
            out.put("count", 0);
            return mapper.writeValueAsBytes(out);
        } catch (Exception e) {
            return "{\"points\":[],\"count\":0}".getBytes();
        }
    }
}
