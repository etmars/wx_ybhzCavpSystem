package com.ybhzcavp.controller;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.service.LocateService;
import com.ybhzcavp.service.MapDataService;
import com.ybhzcavp.service.MbtilesService;
import com.ybhzcavp.service.NavSpeedBumpsService;
import com.ybhzcavp.service.NavTuningProxyService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class MapController {

    private final MapDataService mapDataService;
    private final MbtilesService mbtilesService;
    private final LocateService locateService;
    private final NavTuningProxyService navTuningProxyService;
    private final NavSpeedBumpsService navSpeedBumpsService;

    public MapController(MapDataService mapDataService, MbtilesService mbtilesService,
                         LocateService locateService, NavTuningProxyService navTuningProxyService,
                         NavSpeedBumpsService navSpeedBumpsService) {
        this.mapDataService = mapDataService;
        this.mbtilesService = mbtilesService;
        this.locateService = locateService;
        this.navTuningProxyService = navTuningProxyService;
        this.navSpeedBumpsService = navSpeedBumpsService;
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

    public record LocateRequest(String mapId, Map<String, Object> rssiMap) {
    }
}
