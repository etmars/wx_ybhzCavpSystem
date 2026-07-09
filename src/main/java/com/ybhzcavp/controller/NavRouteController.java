package com.ybhzcavp.controller;

import com.ybhzcavp.service.NavRouteService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class NavRouteController {

    private final NavRouteService navRouteService;

    public NavRouteController(NavRouteService navRouteService) {
        this.navRouteService = navRouteService;
    }

    @PostMapping("/api/nav/route")
    public ResponseEntity<Map<String, Object>> saveRoute(@RequestBody Map<String, Object> body) {
        Object sessionId = body.get("sessionId");
        if (sessionId == null || String.valueOf(sessionId).isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "message", "sessionId required"));
        }
        navRouteService.save(String.valueOf(sessionId), body);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @GetMapping("/api/nav/route")
    public Map<String, Object> getRoute(@RequestParam String sessionId) {
        return navRouteService.get(sessionId);
    }
}
