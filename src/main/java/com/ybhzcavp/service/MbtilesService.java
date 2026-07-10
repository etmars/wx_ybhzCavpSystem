package com.ybhzcavp.service;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * mbtiles 矢量瓦片服务（对齐 Android MbtilesServer）。
 */
@Service
public class MbtilesService {

    private static final Logger log = LoggerFactory.getLogger(MbtilesService.class);
    private final Map<String, Connection> connections = new ConcurrentHashMap<>();

    public ResponseEntity<byte[]> serveTile(MapDataService.MapEntry map, int z, int x, int y) {
        if (map == null || !Files.exists(map.mbtilesFile())) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("no mbtiles".getBytes());
        }
        try {
            Connection conn = connections.computeIfAbsent(map.id(), id -> open(map.mbtilesFile()));
            if (conn == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body("no mbtiles db".getBytes());
            }
            int tmsY = ((1 << z) - 1) - y;
            try (PreparedStatement ps = conn.prepareStatement(
                    "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?")) {
                ps.setInt(1, z);
                ps.setInt(2, x);
                ps.setInt(3, tmsY);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) {
                        return ResponseEntity.status(HttpStatus.NOT_FOUND).body("tile not found".getBytes());
                    }
                    byte[] bytes = rs.getBytes(1);
                    HttpHeaders headers = new HttpHeaders();
                    headers.setContentType(MediaType.parseMediaType("application/x-protobuf"));
                    headers.set(HttpHeaders.CONTENT_ENCODING, "gzip");
                    headers.setCacheControl("public, max-age=3600");
                    headers.setAccessControlAllowOrigin("*");
                    return new ResponseEntity<>(bytes, headers, HttpStatus.OK);
                }
            }
        } catch (Exception e) {
            log.warn("tile serve failed z={} x={} y={}: {}", z, x, y, e.getMessage());
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("tile not found".getBytes());
        }
    }

    public Map<String, String> loadLabelIndex(MapDataService.MapEntry map) {
        Map<String, String> out = new LinkedHashMap<>();
        if (map == null || !Files.exists(map.mbtilesFile())) {
            return out;
        }
        try {
            Connection conn = connections.computeIfAbsent(map.id(), id -> open(map.mbtilesFile()));
            if (conn == null) {
                return out;
            }
            try (PreparedStatement ps = conn.prepareStatement("SELECT icon_id, label FROM label_index");
                 ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String iconId = rs.getString(1);
                    String label = rs.getString(2);
                    if (iconId != null && label != null) {
                        out.put(iconId, label);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("loadLabelIndex failed for {}: {}", map != null ? map.id() : "?", e.getMessage());
        }
        return out;
    }

    private Connection open(Path mbtiles) {
        try {
            if (!Files.exists(mbtiles) || Files.size(mbtiles) < 100) {
                log.warn("mbtiles missing or too small: {}", mbtiles);
                return null;
            }
            return DriverManager.getConnection("jdbc:sqlite:" + mbtiles.toAbsolutePath());
        } catch (Exception e) {
            log.error("open mbtiles failed: {}", mbtiles, e);
            return null;
        }
    }

    @PreDestroy
    public void closeAll() {
        for (Connection c : connections.values()) {
            try {
                c.close();
            } catch (Exception ignored) {
            }
        }
        connections.clear();
    }
}
