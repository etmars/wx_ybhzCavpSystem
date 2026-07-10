package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.config.AppProperties;
import com.ybhzcavp.localization.KnnLocalizer;
import com.ybhzcavp.localization.LocFingerprintModel;
import com.ybhzcavp.localization.LocModelLoader;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.xml.sax.Attributes;
import org.xml.sax.helpers.DefaultHandler;

import javax.xml.parsers.SAXParserFactory;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class MapDataService {

    private static final Logger log = LoggerFactory.getLogger(MapDataService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AppProperties props;
    private final Map<String, MapEntry> mapsById = new ConcurrentHashMap<>();
    private final Map<String, MapEntry> mapsByName = new ConcurrentHashMap<>();
    private final Map<String, KnnLocalizer> knnByMapId = new ConcurrentHashMap<>();
    private final Map<String, OsmMapSceneParser.MapScene> sceneCache = new ConcurrentHashMap<>();
    private final Map<String, FloorGeometry> geometryCache = new ConcurrentHashMap<>();

    private Path dataRoot;

    public MapDataService(AppProperties props) {
        this.props = props;
    }

    @PostConstruct
    public void init() throws IOException {
        dataRoot = Paths.get(props.getDataDir()).toAbsolutePath().normalize();
        Files.createDirectories(dataRoot);

        Path external = Paths.get(props.getOsmandroidAssets());
        if (Files.isDirectory(external)) {
            syncFromExternal(external);
        }

        loadMapIndex();
        if (mapsById.isEmpty()) {
            log.warn("No maps loaded. Set app.osmandroid-assets or place data under {}", dataRoot);
        } else {
            log.info("Loaded {} maps from {}", mapsById.size(), dataRoot);
        }
    }

    private void syncFromExternal(Path external) throws IOException {
        Path indexSrc = external.resolve("maps_index.json");
        if (Files.exists(indexSrc)) {
            Files.copy(indexSrc, dataRoot.resolve("maps_index.json"), StandardCopyOption.REPLACE_EXISTING);
        }
        for (String name : List.of("loc_model.json", "beacon_catalog.json", "fusion_norm.json")) {
            Path src = external.resolve(name);
            if (Files.exists(src)) {
                Files.copy(src, dataRoot.resolve(name), StandardCopyOption.REPLACE_EXISTING);
            }
        }
        Path mapsSrc = external.resolve("maps");
        if (Files.isDirectory(mapsSrc)) {
            try (var stream = Files.list(mapsSrc)) {
                stream.filter(Files::isDirectory).forEach(dir -> {
                    try {
                        String id = dir.getFileName().toString();
                        Path dest = dataRoot.resolve("maps").resolve(id);
                        Files.createDirectories(dest);
                        copyIfExists(dir.resolve("yiqi.osm"), dest.resolve("yiqi.osm"));
                        copyIfExists(dir.resolve("parking.mbtiles"), dest.resolve("parking.mbtiles"));
                        copyIfExists(dir.resolve("loc_model.json"), dest.resolve("loc_model.json"));
                        copyIfExists(dir.resolve("wall_grid.bin"), dest.resolve("wall_grid.bin"));
                    } catch (IOException e) {
                        log.warn("sync map dir failed: {}", dir, e);
                    }
                });
            }
        }
        Path avpSrc = Paths.get("F:/UserApp-osmandroid/osmandroid/OsmAndroidDemo/app/src/main/assets/I1000110.txt");
        if (Files.exists(avpSrc)) {
            Files.copy(avpSrc, dataRoot.resolve("I1000110.txt"), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static void copyIfExists(Path src, Path dest) throws IOException {
        if (Files.exists(src)) {
            Files.copy(src, dest, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void loadMapIndex() throws IOException {
        Path indexFile = dataRoot.resolve("maps_index.json");
        if (!Files.exists(indexFile)) {
            return;
        }
        JsonNode root = MAPPER.readTree(indexFile.toFile());
        JsonNode maps = root.get("maps");
        if (maps == null) {
            return;
        }
        for (JsonNode m : maps) {
            String id = m.get("id").asText();
            String name = m.get("name").asText();
            Path mapDir = dataRoot.resolve("maps").resolve(id);
            MapEntry entry = new MapEntry(
                    id,
                    name,
                    mapDir.resolve("yiqi.osm"),
                    mapDir.resolve("parking.mbtiles"),
                    resolveLocModel(mapDir, id)
            );
            mapsById.put(id, entry);
            mapsByName.put(name, entry);
            loadKnn(entry);
        }
    }

    private Path resolveLocModel(Path mapDir, String mapId) {
        Path perMap = mapDir.resolve("loc_model.json");
        if (Files.exists(perMap)) {
            return perMap;
        }
        Path global = dataRoot.resolve("loc_model.json");
        if (Files.exists(global)) {
            return global;
        }
        Path legacy = Paths.get("F:/UserApp-osmandroid/osmandroid/OsmAndroidDemo/app/src/main/assets/maps")
                .resolve(mapId).resolve("loc_model.json");
        return Files.exists(legacy) ? legacy : perMap;
    }

    private void loadKnn(MapEntry entry) {
        if (!Files.exists(entry.locModel())) {
            log.warn("loc_model missing for map {}", entry.id());
            return;
        }
        try {
            LocFingerprintModel model = LocModelLoader.load(entry.locModel());
            knnByMapId.put(entry.id(), new KnnLocalizer(model, true));
            log.info("KNN ready for {} fingerprints={}", entry.id(), model.fpRssiList().size());
        } catch (IOException e) {
            log.error("KNN load failed for {}", entry.id(), e);
        }
    }

    public MapEntry resolveMap(String mapFileOrId) {
        if (mapFileOrId == null || mapFileOrId.isBlank()) {
            return mapsById.get("ziguang_1-B2");
        }
        MapEntry byId = mapsById.get(mapFileOrId);
        if (byId != null) {
            return byId;
        }
        MapEntry byName = mapsByName.get(mapFileOrId);
        if (byName != null) {
            return byName;
        }
        for (MapEntry e : mapsById.values()) {
            if (e.name().contains(mapFileOrId) || mapFileOrId.contains(e.name())) {
                return e;
            }
        }
        return mapsById.values().stream().findFirst().orElse(null);
    }

    public KnnLocalizer getKnn(String mapId) {
        return knnByMapId.get(mapId);
    }

    public Path getDataRoot() {
        return dataRoot;
    }

    public List<MapEntry> listMaps() {
        return new ArrayList<>(mapsById.values());
    }

    public JsonNode readJsonResource(Path path) throws IOException {
        return MAPPER.readTree(path.toFile());
    }

    public byte[] readBytes(Path path) throws IOException {
        return Files.readAllBytes(path);
    }

    public OsmMapSceneParser.MapScene getMapScene(String mapId) {
        return sceneCache.computeIfAbsent(mapId, id -> {
            MapEntry entry = mapsById.get(id);
            if (entry == null || !Files.exists(entry.osmFile())) {
                return OsmMapSceneParser.MapScene.empty();
            }
            return OsmMapSceneParser.parse(entry.osmFile());
        });
    }

    /** @deprecated 使用 getMapScene */
    public FloorGeometry getFloorGeometry(String mapId) {
        return geometryCache.computeIfAbsent(mapId, id -> {
            MapEntry entry = mapsById.get(id);
            if (entry == null || !Files.exists(entry.osmFile())) {
                return FloorGeometry.empty();
            }
            return OsmFloorGeometryParser.parse(entry.osmFile());
        });
    }

    public Path resolveWallGrid(String mapId) {
        MapEntry entry = resolveMap(mapId);
        if (entry == null) {
            return null;
        }
        Path path = dataRoot.resolve("maps").resolve(entry.id()).resolve("wall_grid.bin");
        return Files.exists(path) ? path : null;
    }

    public record MapEntry(String id, String name, Path osmFile, Path mbtilesFile, Path locModel) {
    }

    public record FloorGeometry(
            List<List<double[]>> floorBounds,
            List<List<double[]>> walls,
            List<List<double[]>> parking
    ) {
        static FloorGeometry empty() {
            return new FloorGeometry(List.of(), List.of(), List.of());
        }

        public ObjectNode toGeoJson() {
            ObjectNode root = MAPPER.createObjectNode();
            root.set("floorBounds", ringsToGeo(floorBounds));
            root.set("walls", ringsToGeo(walls));
            root.set("parking", ringsToGeo(parking));
            return root;
        }

        private ArrayNode ringsToGeo(List<List<double[]>> rings) {
            ArrayNode arr = MAPPER.createArrayNode();
            for (List<double[]> ring : rings) {
                ArrayNode coords = MAPPER.createArrayNode();
                for (double[] p : ring) {
                    ArrayNode c = MAPPER.createArrayNode();
                    c.add(p[1]);
                    c.add(p[0]);
                    coords.add(c);
                }
                arr.add(coords);
            }
            return arr;
        }
    }

    private static final class OsmFloorGeometryParser {
        private static final String STYPE_WALL = "1000";
        private static final String STYPE_PARKING = "1002";
        private static final String STYPE_FLOOR = "0";
        private static final String FLOOR_ID = "1000";

        static FloorGeometry parse(Path osmFile) {
            try {
                Handler handler = new Handler();
                SAXParserFactory.newInstance().newSAXParser().parse(osmFile.toFile(), handler);
                return new FloorGeometry(
                        handler.collect(STYPE_FLOOR, FLOOR_ID),
                        handler.collect(STYPE_WALL, null),
                        handler.collect(STYPE_PARKING, null)
                );
            } catch (Exception e) {
                log.error("OSM parse failed: {}", osmFile, e);
                return FloorGeometry.empty();
            }
        }

        private static class Handler extends DefaultHandler {
            private final Map<Long, double[]> nodes = new HashMap<>();
            private final List<Way> ways = new ArrayList<>();
            private Way currentWay;

            @Override
            public void startElement(String uri, String localName, String qName, Attributes attrs) {
                switch (qName) {
                    case "node" -> {
                        long id = Long.parseLong(attrs.getValue("id"));
                        double lat = Double.parseDouble(attrs.getValue("lat"));
                        double lon = Double.parseDouble(attrs.getValue("lon"));
                        nodes.put(id, new double[]{lat, lon});
                    }
                    case "way" -> currentWay = new Way();
                    case "nd" -> {
                        if (currentWay != null) {
                            currentWay.refs.add(Long.parseLong(attrs.getValue("ref")));
                        }
                    }
                    case "tag" -> {
                        if (currentWay != null) {
                            currentWay.tags.put(attrs.getValue("k"), attrs.getValue("v"));
                        }
                    }
                    default -> {
                    }
                }
            }

            @Override
            public void endElement(String uri, String localName, String qName) {
                if ("way".equals(qName) && currentWay != null) {
                    ways.add(currentWay);
                    currentWay = null;
                }
            }

            List<List<double[]>> collect(String sType, String id) {
                List<List<double[]>> polygons = new ArrayList<>();
                for (Way way : ways) {
                    if (!sType.equals(way.tags.get("sType"))) {
                        continue;
                    }
                    if (id != null && !id.equals(way.tags.get("id"))) {
                        continue;
                    }
                    if (way.refs.size() < 3) {
                        continue;
                    }
                    List<double[]> ring = new ArrayList<>();
                    for (long ref : way.refs) {
                        double[] p = nodes.get(ref);
                        if (p != null) {
                            ring.add(p);
                        }
                    }
                    if (ring.size() >= 3) {
                        polygons.add(ring);
                    }
                }
                return polygons;
            }
        }

        private static class Way {
            final List<Long> refs = new ArrayList<>();
            final Map<String, String> tags = new HashMap<>();
        }
    }
}
