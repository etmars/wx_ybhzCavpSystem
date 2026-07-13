package com.ybhzcavp.controller;

import com.ybhzcavp.service.MapAssetSyncService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/admin/maps")
public class AdminMapsController {

    private final MapAssetSyncService mapAssetSyncService;

    public AdminMapsController(MapAssetSyncService mapAssetSyncService) {
        this.mapAssetSyncService = mapAssetSyncService;
    }

    /** 手动触发：从 parkinglot catalog + 标定服按 CRC 同步到 data/maps */
    @PostMapping("/sync")
    public ResponseEntity<Map<String, Object>> sync() {
        try {
            return ResponseEntity.ok(mapAssetSyncService.syncAll());
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "ok", false,
                    "error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()
            ));
        }
    }
}
