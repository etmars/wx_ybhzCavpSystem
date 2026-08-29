package com.ybhzcavp.controller;

import com.ybhzcavp.service.WalkRouteService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class WalkRouteController {

    private final WalkRouteService walkRouteService;

    public WalkRouteController(WalkRouteService walkRouteService) {
        this.walkRouteService = walkRouteService;
    }

    @GetMapping("/api/nav/walk-route")
    public ResponseEntity<Map<String, Object>> plan(
            @RequestParam(defaultValue = "") String lotId,
            @RequestParam String mapId,
            @RequestParam String spaceId,
            @RequestParam double originLng,
            @RequestParam double originLat
    ) {
        try {
            return ResponseEntity.ok(walkRouteService.plan(
                    lotId,
                    mapId,
                    spaceId,
                    originLng,
                    originLat
            ));
        } catch (WalkRouteService.WalkOriginOutOfRangeException e) {
            return ResponseEntity.unprocessableEntity().body(Map.of(
                    "ok", false,
                    "code", "OUT_OF_RANGE",
                    "message", e.getMessage()
            ));
        } catch (WalkRouteService.WalkTargetNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of(
                    "ok", false,
                    "message", e.getMessage()
            ));
        } catch (WalkRouteService.WalkPlannerException e) {
            return ResponseEntity.status(502).body(Map.of(
                    "ok", false,
                    "code", "PLANNER_UNAVAILABLE",
                    "message", e.getMessage()
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "ok", false,
                    "message", e.getMessage()
            ));
        }
    }
}
