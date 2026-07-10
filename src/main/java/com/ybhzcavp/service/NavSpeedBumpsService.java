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

/** 对齐 NavSpeedBumps.kt — 从 parking.mbtiles 读取减速带 GeoJSON */
@Service
public class NavSpeedBumpsService {

    private static final Logger log = LoggerFactory.getLogger(NavSpeedBumpsService.class);
    private final MapDataService mapDataService;

    public NavSpeedBumpsService(MapDataService mapDataService) {
        this.mapDataService = mapDataService;
    }

    public byte[] loadGeoJson(String mapId) {
        MapEntry map = mapDataService.resolveMap(mapId);
        if (map == null || !Files.exists(map.mbtilesFile())) {
            return "{\"type\":\"FeatureCollection\",\"features\":[]}".getBytes(StandardCharsets.UTF_8);
        }
        String url = "jdbc:sqlite:" + map.mbtilesFile().toAbsolutePath();
        try (Connection conn = DriverManager.getConnection(url);
             Statement st = conn.createStatement()) {
            try (ResultSet tableCheck = st.executeQuery(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='nav_speedbumps_geojson' LIMIT 1")) {
                if (!tableCheck.next()) {
                    return "{\"type\":\"FeatureCollection\",\"features\":[]}".getBytes(StandardCharsets.UTF_8);
                }
            }
            try (ResultSet rs = st.executeQuery("SELECT data FROM nav_speedbumps_geojson WHERE id=1 LIMIT 1")) {
                if (rs.next()) {
                    String json = rs.getString(1);
                    if (json != null && !json.isBlank()) {
                        return json.getBytes(StandardCharsets.UTF_8);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("load speed bumps failed map={}: {}", mapId, e.getMessage());
        }
        return "{\"type\":\"FeatureCollection\",\"features\":[]}".getBytes(StandardCharsets.UTF_8);
    }
}
