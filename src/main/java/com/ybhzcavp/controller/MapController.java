package com.ybhzcavp.controller;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.service.LocateService;
import com.ybhzcavp.service.AvpMapKeyService;
import com.ybhzcavp.service.MapDataService;
import com.ybhzcavp.service.MbtilesService;
import com.ybhzcavp.service.NavSpeedBumpsService;
import com.ybhzcavp.service.NavTuningProxyService;
import com.ybhzcavp.service.ParkingService;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.Map;

@RestController
public class MapController {

    private final MapDataService mapDataService;
    private final MbtilesService mbtilesService;
    private final LocateService locateService;
    private final NavTuningProxyService navTuningProxyService;
    private final NavSpeedBumpsService navSpeedBumpsService;
    private final ParkingService parkingService;
    private final AvpMapKeyService avpMapKeyService;

    public MapController(MapDataService mapDataService, MbtilesService mbtilesService,
                         LocateService locateService, NavTuningProxyService navTuningProxyService,
                         NavSpeedBumpsService navSpeedBumpsService, ParkingService parkingService,
                         AvpMapKeyService avpMapKeyService) {
        this.mapDataService = mapDataService;
        this.mbtilesService = mbtilesService;
        this.locateService = locateService;
        this.navTuningProxyService = navTuningProxyService;
        this.navSpeedBumpsService = navSpeedBumpsService;
        this.parkingService = parkingService;
        this.avpMapKeyService = avpMapKeyService;
    }

    @GetMapping("/tiles/{z}/{x}/{y}.pbf")
    public ResponseEntity<byte[]> tile(
            @RequestParam(defaultValue = "") String map_id,
            @PathVariable int z,
            @PathVariable int x,
            @PathVariable int y) {
        MapDataService.MapEntry map = mapDataService.resolveMap(map_id);
        return mbtilesService.serveTile(map, z, x, y);
    }

    @GetMapping("/api/maps/{mapId}/geometry")
    public ObjectNode geometry(@PathVariable String mapId) {
        MapDataService.MapEntry map = mapDataService.resolveMap(mapId);
        ObjectNode node = locateService.getMapSceneJson(mapId);
        if (map != null) {
            node.put("map_id", map.id());
            node.put("map_name", map.name());
        }
        node.put("geometry_rev", "hd1");
        // 缩略图兼容字段（对齐 Android OsmFloorGeometry + RouteThumbnailView）
        MapDataService.FloorGeometry floor = mapDataService.getFloorGeometry(mapId);
        ObjectNode floorJson = floor.toGeoJson();
        node.set("floorBounds", floorJson.get("floorBounds"));
        if (node.has("layers")) {
            var layers = node.get("layers");
            if (layers.has("walls1000")) {
                node.set("walls", layers.get("walls1000"));
            } else {
                node.set("walls", floorJson.get("walls"));
            }
            var parking = layers.has("parkingEdge") && layers.get("parkingEdge").size() > 0
                    ? layers.get("parkingEdge")
                    : layers.get("parkingFill");
            if (parking != null && !parking.isEmpty()) {
                node.set("parking", parking);
            } else {
                node.set("parking", floorJson.get("parking"));
            }
            if (layers.has("hdRoads")) {
                node.set("hdRoads", layers.get("hdRoads"));
            }
            if (layers.has("laneBounds")) {
                node.set("laneBounds", layers.get("laneBounds"));
            }
        } else {
            node.set("walls", floorJson.get("walls"));
            node.set("parking", floorJson.get("parking"));
        }
        return node;
    }

    @GetMapping("/api/maps/index")
    public Map<String, Object> mapIndex() {
        return Map.of(
                "maps", mapDataService.listMaps().stream().map(m -> Map.of(
                        "id", m.id(),
                        "name", m.name(),
                        "has_mbtiles", java.nio.file.Files.exists(m.mbtilesFile()),
                        "has_osm", java.nio.file.Files.exists(m.osmFile())
                )).toList()
        );
    }

    @PostMapping("/api/locate")
    public Map<String, Object> locate(@RequestBody LocateRequest request) {
        return locateService.locate(request.mapId(), request.rssiMap());
    }

    @GetMapping("/api/model/nav_tuning.json")
    public ResponseEntity<byte[]> navTuning(@RequestParam(name = "map_id") String mapId) {
        return navTuningProxyService.fetchNavTuning(mapId);
    }

    @GetMapping("/api/maps/{mapId}/speed-bumps")
    public ResponseEntity<byte[]> speedBumps(@PathVariable String mapId) {
        byte[] body = navSpeedBumpsService.loadGeoJson(mapId);
        return ResponseEntity.ok()
                .header("Content-Type", "application/json")
                .body(body);
    }

    @GetMapping("/api/maps/{mapId}/label-index")
    public Map<String, String> labelIndex(@PathVariable String mapId) {
        MapDataService.MapEntry map = mapDataService.resolveMap(mapId);
        return mbtilesService.loadLabelIndex(map);
    }

    @GetMapping("/api/maps/{mapId}/special-points")
    public ResponseEntity<ObjectNode> specialPoints(@PathVariable String mapId) {
        ObjectNode body = parkingService.specialPoints(mapId);
        if (body.path("ok").asBoolean(false)) {
            return ResponseEntity.ok(body);
        }
        int status = body.path("code").asInt(502);
        if (status < 400 || status > 599) status = 502;
        return ResponseEntity.status(status).body(body);
    }

    @GetMapping("/api/maps/{mapId}/wall_grid.bin")
    public ResponseEntity<byte[]> wallGrid(@PathVariable String mapId) throws java.io.IOException {
        java.nio.file.Path path = mapDataService.resolveWallGrid(mapId);
        if (path == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok()
                .header("Content-Type", "application/octet-stream")
                .body(mapDataService.readBytes(path));
    }

    @GetMapping({"/api/maps/{mapId}/avpmap", "/api/maps/{mapId}/parking.avpmap"})
    public ResponseEntity<byte[]> avpmap(
            @PathVariable String mapId,
            @org.springframework.web.bind.annotation.RequestHeader(
                    value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) throws IOException {
        Path path = mapDataService.resolveAvpmap(mapId);
        return serveAsset(mapId, "parking.avpmap", path, ifNoneMatch);
    }

    @GetMapping("/api/maps/{mapId}/avpmap-key")
    public ResponseEntity<byte[]> avpmapKey(
            @PathVariable String mapId,
            @RequestParam(name = "key_id") int keyId,
            @org.springframework.web.bind.annotation.RequestHeader(
                    value = "X-Model-Token", required = false) String modelToken) {
        return avpMapKeyService.fetchWithWxToken(mapId, keyId, modelToken);
    }

    @GetMapping("/api/maps/{mapId}/structures/{name}.mesh")
    public ResponseEntity<byte[]> structureMesh(
            @PathVariable String mapId,
            @PathVariable String name,
            @org.springframework.web.bind.annotation.RequestHeader(
                    value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) throws IOException {
        Path path = mapDataService.resolveStructureMesh(mapId, name);
        return serveAsset(mapId, "structures/" + name + ".mesh", path, ifNoneMatch);
    }

    private ResponseEntity<byte[]> serveAsset(
            String mapId, String assetName, Path path, String ifNoneMatch) throws IOException {
        if (path == null) {
            return ResponseEntity.notFound().build();
        }
        String etag = mapDataService.assetEtag(mapId, assetName, path);
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.CONTENT_TYPE, "application/octet-stream");
        headers.setETag(etag);
        headers.setCacheControl(CacheControl.maxAge(Duration.ZERO).cachePrivate().mustRevalidate());
        headers.set("Content-Encoding", "identity");
        if (etagMatches(ifNoneMatch, etag)) {
            return new ResponseEntity<>(null, headers, HttpStatus.NOT_MODIFIED);
        }
        return new ResponseEntity<>(mapDataService.readBytes(path), headers, HttpStatus.OK);
    }

    private static boolean etagMatches(String ifNoneMatch, String etag) {
        if (ifNoneMatch == null || ifNoneMatch.isBlank()) {
            return false;
        }
        return Arrays.stream(ifNoneMatch.split(","))
                .map(String::trim)
                .anyMatch(candidate -> "*".equals(candidate)
                        || etag.equals(candidate)
                        || etag.equals(candidate.replaceFirst("^W/", "")));
    }

    public record LocateRequest(String mapId, Map<String, Object> rssiMap) {
    }
}
