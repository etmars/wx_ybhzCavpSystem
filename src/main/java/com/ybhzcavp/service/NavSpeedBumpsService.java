package com.ybhzcavp.service;

import com.ybhzcavp.service.MapDataService.MapEntry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

/**
 * 减速带 GeoJSON 数据源。优先 parking.mbtiles 预处理表（对齐 NavSpeedBumps.kt），
 * 无表/无数据时回退直接解析 OSM 的闭合 way sType=1003。
 */
@Service
public class NavSpeedBumpsService {

    private static final Logger log = LoggerFactory.getLogger(NavSpeedBumpsService.class);
    private static final String EMPTY_FC = "{\"type\":\"FeatureCollection\",\"features\":[]}";
    private final MapDataService mapDataService;

    public NavSpeedBumpsService(MapDataService mapDataService) {
        this.mapDataService = mapDataService;
    }

    public byte[] loadGeoJson(String mapId) {
        MapEntry map = mapDataService.resolveMap(mapId);
        if (map == null) {
            return EMPTY_FC.getBytes(StandardCharsets.UTF_8);
        }
        String fromMbtiles = loadFromMbtiles(map);
        if (fromMbtiles != null && !fromMbtiles.isBlank()) {
            return fromMbtiles.getBytes(StandardCharsets.UTF_8);
        }
        // 回退：从 OSM 解析 sType=1003 闭合 way
        return loadFromOsm(map).getBytes(StandardCharsets.UTF_8);
    }

    private String loadFromMbtiles(MapEntry map) {
        if (!Files.exists(map.mbtilesFile())) {
            return null;
        }
        String url = "jdbc:sqlite:" + map.mbtilesFile().toAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url);
             Statement st = conn.createStatement()) {
            try (ResultSet tableCheck = st.executeQuery(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='nav_speedbumps_geojson' LIMIT 1")) {
                if (!tableCheck.next()) {
                    return null;
                }
            }
            try (ResultSet rs = st.executeQuery("SELECT data FROM nav_speedbumps_geojson WHERE id=1 LIMIT 1")) {
                if (rs.next()) {
                    return rs.getString(1);
                }
            }
        } catch (Exception e) {
            log.warn("load speed bumps from mbtiles failed map={}: {}", map.id(), e.getMessage());
        }
        return null;
    }

    private String loadFromOsm(MapEntry map) {
        try {
            if (!Files.exists(map.osmFile())) {
                return EMPTY_FC;
            }
            OsmMapSceneParser.MapScene scene = mapDataService.getMapScene(map.id());
            String json = scene.speedBumpsGeoJson().toString();
            int count = scene.speedBumps1003() == null ? 0 : scene.speedBumps1003().size();
            log.info("speed bumps from osm map={}: {}", map.id(), count);
            return json;
        } catch (Exception e) {
            log.warn("load speed bumps from osm failed map={}: {}", map.id(), e.getMessage());
            return EMPTY_FC;
        }
    }
}
