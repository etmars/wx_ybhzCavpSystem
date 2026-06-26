package com.ybhzcavp.controller;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.service.LocateService;
import com.ybhzcavp.service.MapDataService;
import com.ybhzcavp.service.MbtilesService;
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

    public MapController(MapDataService mapDataService, MbtilesService mbtilesService, LocateService locateService) {
        this.mapDataService = mapDataService;
        this.mbtilesService = mbtilesService;
        this.locateService = locateService;
    }

    @GetMapping("/tiles/{z}/{x}/{y}.pbf")
    public ResponseEntity<byte[]> tile(
            @RequestParam(defaultValue = "ziguang_1-B2") String map_id,
            @PathVariable int z,
            @PathVariable int x,
            @PathVariable int y) {
        MapDataService.MapEntry map = mapDataService.resolveMap(map_id);
        return mbtilesService.serveTile(map, z, x, y);
    }

    @GetMapping("/api/maps/{mapId}/geometry")
    public ObjectNode geometry(@PathVariable String mapId) {
        return locateService.mapMeta(mapId);
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

    public record LocateRequest(String mapId, Map<String, Object> rssiMap) {
    }
}
