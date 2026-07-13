package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.CRC32;

/**
 * 对齐 Android MapAssetsDownloader：
 * parking_lots → maps?parking_lot_id（含 CRC）+ 标定服 /api/model/* → data/maps/&lt;map_id&gt;/ 缓存。
 */
@Service
@Order(100)
public class MapAssetSyncService implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(MapAssetSyncService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 地图运行时必需（与 Android MAP_BINARIES + loc_model 对齐） */
    private static final List<String> SYNC_FILES = List.of(
            "parking.mbtiles",
            "map.osm",
            "wall_grid.bin",
            "loc_model.json"
    );

    private final AppProperties props;
    private final MapDataService mapDataService;
    private final MbtilesService mbtilesService;
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    public MapAssetSyncService(AppProperties props, MapDataService mapDataService, MbtilesService mbtilesService) {
        this.props = props;
        this.mapDataService = mapDataService;
        this.mbtilesService = mbtilesService;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!props.getMapSync().isEnabled() || !props.getMapSync().isOnStartup()) {
            log.info("map-sync skipped (enabled={}, onStartup={})",
                    props.getMapSync().isEnabled(), props.getMapSync().isOnStartup());
            return;
        }
        try {
            Map<String, Object> result = syncAll();
            log.info("map-sync startup done: {}", result);
        } catch (Exception e) {
            log.warn("map-sync startup failed, using local cache if any: {}", e.getMessage());
        }
    }

    public Map<String, Object> syncAll() throws Exception {
        List<CatalogEntry> catalog = fetchMapsViaParkingLots();
        if (catalog.isEmpty()) {
            log.warn("no maps from parking lots; keep local maps");
            return Map.of("ok", true, "synced", 0, "maps", List.of());
        }

        List<MapDataService.IndexEntry> indexEntries = new ArrayList<>();
        List<Map<String, Object>> details = new ArrayList<>();
        int syncedMaps = 0;

        for (CatalogEntry entry : catalog) {
            Map<String, Object> detail = syncOne(entry);
            details.add(detail);
            if (Boolean.TRUE.equals(detail.get("changed"))) {
                syncedMaps++;
            }
            indexEntries.add(new MapDataService.IndexEntry(entry.mapId(), entry.displayName()));
        }

        mapDataService.upsertIndexEntries(indexEntries);
        mbtilesService.closeAll();
        return Map.of(
                "ok", true,
                "synced", syncedMaps,
                "total", catalog.size(),
                "maps", details
        );
    }

    private Map<String, Object> syncOne(CatalogEntry entry) throws Exception {
        Path dir = mapDataService.mapDir(entry.mapId());
        Files.createDirectories(dir);
        Path manifestPath = mapDataService.assetsCrcManifest(entry.mapId());
        Map<String, String> localCrc = readCrcManifest(manifestPath);
        Map<String, String> remoteCrc = entry.assetsCrc32();

        List<String> downloaded = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        List<String> failed = new ArrayList<>();
        Map<String, String> newManifest = new LinkedHashMap<>(localCrc);

        for (String file : SYNC_FILES) {
            String remote = remoteCrc.get(file);
            Path target = dir.resolve(file);
            boolean missing = !Files.exists(target) || Files.size(target) == 0;
            String local = localCrc.get(file);
            boolean crcMismatch = remote != null && !remote.isBlank()
                    && (local == null || !remote.equalsIgnoreCase(local));

            if (!missing && !crcMismatch && remote != null) {
                skipped.add(file);
                continue;
            }
            if (!missing && (remote == null || remote.isBlank())) {
                skipped.add(file);
                continue;
            }

            try {
                downloadAsset(entry.mapId(), file, target);
                if (remote != null && !remote.isBlank()) {
                    String actual = crc32Hex(target);
                    if (!remote.equalsIgnoreCase(actual)) {
                        log.warn("CRC mismatch after download map={} file={} remote={} local={}",
                                entry.mapId(), file, remote, actual);
                    }
                    newManifest.put(file, remote.toLowerCase());
                } else {
                    newManifest.put(file, crc32Hex(target));
                }
                downloaded.add(file);
            } catch (Exception e) {
                log.warn("download failed map={} file={}: {}", entry.mapId(), file, e.getMessage());
                failed.add(file);
            }
        }

        writeCrcManifest(manifestPath, newManifest);

        boolean changed = !downloaded.isEmpty();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("map_id", entry.mapId());
        out.put("map_file", entry.mapFile());
        out.put("changed", changed);
        out.put("downloaded", downloaded);
        out.put("skipped", skipped);
        out.put("failed", failed);
        return out;
    }

    private void downloadAsset(String mapId, String filename, Path target) throws Exception {
        String calib = props.getCalib().getApiBaseUrl().replaceAll("/$", "");
        String url = calib + "/api/model/" + filename
                + "?map_id=" + URLEncoder.encode(mapId, StandardCharsets.UTF_8);
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofMinutes(5))
                .GET()
                .build();
        HttpResponse<InputStream> resp = client.send(req, HttpResponse.BodyHandlers.ofInputStream());
        if (resp.statusCode() != 200) {
            try (InputStream ignored = resp.body()) {
                // drain
            }
            throw new IllegalStateException("HTTP " + resp.statusCode() + " for " + url);
        }
        Path tmp = target.resolveSibling(filename + ".tmp");
        try (InputStream in = resp.body(); OutputStream out = Files.newOutputStream(tmp)) {
            in.transferTo(out);
        }
        try {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception moveEx) {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        }
        log.info("downloaded {} -> {} ({} bytes)", url, target, Files.size(target));
    }

    /**
     * GET /api/parking-lots → 各 lot 的 GET /api/maps?parking_lot_id=（含 assets_crc32），按 map_id 去重。
     */
    private List<CatalogEntry> fetchMapsViaParkingLots() throws Exception {
        String parking = props.getParking().getApiBaseUrl().replaceAll("/$", "");
        List<String> lotIds = fetchParkingLotIds(parking);
        if (lotIds.isEmpty()) {
            log.warn("parking-lots empty from {}", parking);
            return List.of();
        }

        Map<String, CatalogEntry> byMapId = new LinkedHashMap<>();
        for (String lotId : lotIds) {
            String url = parking + "/api/maps?parking_lot_id="
                    + URLEncoder.encode(lotId, StandardCharsets.UTF_8);
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(30))
                    .GET()
                    .build();
            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (resp.statusCode() != 200) {
                log.warn("maps HTTP {} for lot={} url={}", resp.statusCode(), lotId, url);
                continue;
            }
            JsonNode root = MAPPER.readTree(resp.body());
            JsonNode arr = root.isArray() ? root : root.get("data");
            if (arr == null || !arr.isArray()) {
                continue;
            }
            for (JsonNode n : arr) {
                CatalogEntry e = parseMapRow(n);
                if (e != null) {
                    byMapId.putIfAbsent(e.mapId(), e);
                }
            }
        }
        log.info("resolved {} unique map(s) from {} parking lot(s)", byMapId.size(), lotIds.size());
        return new ArrayList<>(byMapId.values());
    }

    private List<String> fetchParkingLotIds(String parkingBase) throws Exception {
        String url = parkingBase + "/api/parking-lots";
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(30))
                .GET()
                .build();
        HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (resp.statusCode() != 200) {
            throw new IllegalStateException("parking-lots HTTP " + resp.statusCode() + " url=" + url);
        }
        JsonNode root = MAPPER.readTree(resp.body());
        JsonNode arr = root.isArray() ? root : root.get("data");
        List<String> ids = new ArrayList<>();
        if (arr != null && arr.isArray()) {
            for (JsonNode n : arr) {
                String id = text(n, "id", "parking_lot_id", "parkingLotId");
                if (id != null && !id.isBlank()) {
                    ids.add(id);
                }
            }
        }
        return ids;
    }

    private static CatalogEntry parseMapRow(JsonNode n) {
        String mapId = text(n, "map_id", "mapId");
        if (mapId == null || mapId.isBlank()) {
            return null;
        }
        String mapFile = text(n, "map_file", "mapFile");
        String display = text(n, "display_name", "displayName");
        if (display == null || display.isBlank()) {
            display = mapFile != null && !mapFile.isBlank() ? mapFile.replace(".osm", "") : mapId;
        }
        Map<String, String> crc = new LinkedHashMap<>();
        JsonNode crcNode = n.get("assets_crc32");
        if (crcNode != null && crcNode.isTextual()) {
            try {
                crcNode = MAPPER.readTree(crcNode.asText());
            } catch (Exception ignored) {
                crcNode = null;
            }
        }
        if (crcNode != null && crcNode.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = crcNode.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> f = fields.next();
                if (f.getValue() != null && f.getValue().isValueNode()) {
                    crc.put(f.getKey(), f.getValue().asText());
                }
            }
        }
        return new CatalogEntry(mapId, mapFile == null ? "" : mapFile, display, crc);
    }

    private static String text(JsonNode n, String... keys) {
        for (String k : keys) {
            if (n.has(k) && !n.get(k).isNull()) {
                String v = n.get(k).asText("").trim();
                if (!v.isEmpty()) {
                    return v;
                }
            }
        }
        return null;
    }

    private Map<String, String> readCrcManifest(Path path) {
        Map<String, String> out = new LinkedHashMap<>();
        if (!Files.exists(path)) {
            return out;
        }
        try {
            JsonNode root = MAPPER.readTree(path.toFile());
            if (root.isObject()) {
                Iterator<Map.Entry<String, JsonNode>> fields = root.fields();
                while (fields.hasNext()) {
                    Map.Entry<String, JsonNode> f = fields.next();
                    out.put(f.getKey(), f.getValue().asText());
                }
            }
        } catch (Exception e) {
            log.warn("read crc manifest failed {}: {}", path, e.getMessage());
        }
        return out;
    }

    private void writeCrcManifest(Path path, Map<String, String> crc) throws Exception {
        ObjectNode node = MAPPER.createObjectNode();
        crc.forEach(node::put);
        MAPPER.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), node);
    }

    static String crc32Hex(Path file) throws Exception {
        CRC32 crc = new CRC32();
        byte[] buf = new byte[8192];
        try (InputStream in = Files.newInputStream(file)) {
            int n;
            while ((n = in.read(buf)) >= 0) {
                crc.update(buf, 0, n);
            }
        }
        return String.format("%08x", crc.getValue());
    }

    private record CatalogEntry(
            String mapId,
            String mapFile,
            String displayName,
            Map<String, String> assetsCrc32
    ) {
    }
}
