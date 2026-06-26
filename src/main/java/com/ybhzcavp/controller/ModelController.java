package com.ybhzcavp.controller;

import com.ybhzcavp.service.MapDataService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/model")
public class ModelController {

    private final MapDataService mapDataService;

    public ModelController(MapDataService mapDataService) {
        this.mapDataService = mapDataService;
    }

    @GetMapping("/loc_model.json")
    public ResponseEntity<Resource> locModel(@RequestParam(required = false) String map_id) throws Exception {
        return serveModelFile("loc_model.json", map_id);
    }

    @GetMapping("/map_bearing.json")
    public Map<String, Object> mapBearing(@RequestParam(required = false) String map_id) {
        return Map.of("bearing_deg", 0.0);
    }

    @GetMapping("/fusion_norm.json")
    public ResponseEntity<Resource> fusionNorm(@RequestParam(required = false) String map_id) throws Exception {
        return serveModelFile("fusion_norm.json", map_id);
    }

    @GetMapping("/beacon_catalog.json")
    public ResponseEntity<Resource> beaconCatalog() throws Exception {
        Path path = mapDataService.getDataRoot().resolve("beacon_catalog.json");
        if (!Files.exists(path)) {
            return ResponseEntity.notFound().build();
        }
        return fileResponse(path, "application/json");
    }

    @PostMapping("/rebuild")
    public Map<String, String> rebuild(@RequestBody(required = false) Map<String, Object> body) {
        return Map.of("status", "ok", "message", "model already bundled");
    }

    private ResponseEntity<Resource> serveModelFile(String fileName, String mapId) throws Exception {
        MapDataService.MapEntry map = mapDataService.resolveMap(mapId);
        if (map != null && Files.exists(map.locModel()) && "loc_model.json".equals(fileName)) {
            return fileResponse(map.locModel(), "application/json");
        }
        Path global = mapDataService.getDataRoot().resolve(fileName);
        if (Files.exists(global)) {
            return fileResponse(global, "application/json");
        }
        return ResponseEntity.notFound().build();
    }

    private ResponseEntity<Resource> fileResponse(Path path, String contentType) {
        FileSystemResource resource = new FileSystemResource(path);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, contentType)
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300")
                .body(resource);
    }
}
