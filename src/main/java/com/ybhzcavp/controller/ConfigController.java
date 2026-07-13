package com.ybhzcavp.controller;

import com.ybhzcavp.service.ConfigService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/config")
public class ConfigController {

    private final ConfigService configService;

    public ConfigController(ConfigService configService) {
        this.configService = configService;
    }

    @GetMapping("/lots")
    public List<Map<String, Object>> listLots() {
        return configService.listLots();
    }

    @PostMapping("/lots")
    public Map<String, Object> createLot(@RequestBody Map<String, Object> body) {
        return configService.createLot(body);
    }

    @GetMapping("/lots/{lotId}")
    public Map<String, Object> getLot(@PathVariable String lotId) {
        return configService.getLot(lotId);
    }

    @PutMapping("/lots/{lotId}")
    public Map<String, Object> updateLot(@PathVariable String lotId, @RequestBody Map<String, Object> body) {
        return configService.updateLot(lotId, body);
    }

    @GetMapping("/lots/{lotId}/dispatch")
    public Map<String, Object> getDispatch(@PathVariable String lotId) {
        return configService.getDispatch(lotId);
    }

    @PutMapping("/lots/{lotId}/dispatch")
    public Map<String, Object> putDispatch(@PathVariable String lotId, @RequestBody Map<String, Object> body) {
        return configService.putDispatch(lotId, body);
    }

    @GetMapping("/lots/{lotId}/device")
    public Map<String, Object> getDevice(@PathVariable String lotId) {
        return configService.getDevice(lotId);
    }

    @PutMapping("/lots/{lotId}/device")
    public Map<String, Object> putDevice(@PathVariable String lotId, @RequestBody Map<String, Object> body) {
        return configService.putDevice(lotId, body);
    }

    @GetMapping("/lots/{lotId}/destination")
    public List<Map<String, Object>> getDestinations(@PathVariable String lotId) {
        return configService.getDestinations(lotId);
    }

    @PutMapping("/lots/{lotId}/destination")
    public List<Map<String, Object>> putDestinations(@PathVariable String lotId, @RequestBody Object body) {
        return configService.putDestinations(lotId, body);
    }

    @GetMapping("/lots/{lotId}/maps")
    public List<Map<String, Object>> getMaps(@PathVariable String lotId) {
        return configService.getMaps(lotId);
    }

    @PutMapping("/lots/{lotId}/maps")
    public List<Map<String, Object>> putMaps(@PathVariable String lotId, @RequestBody Object body) {
        return configService.putMaps(lotId, body);
    }

    @GetMapping("/lots/{lotId}/zones")
    public List<Map<String, Object>> getZones(@PathVariable String lotId) {
        return configService.getZones(lotId);
    }

    @PutMapping("/lots/{lotId}/zones")
    public List<Map<String, Object>> putZones(@PathVariable String lotId, @RequestBody Object body) {
        return configService.putZones(lotId, body);
    }

    @GetMapping("/lots/{lotId}/members")
    public List<Map<String, Object>> getMembers(@PathVariable String lotId) {
        return configService.getMembers(lotId);
    }

    @PutMapping("/lots/{lotId}/members")
    public List<Map<String, Object>> putMembers(@PathVariable String lotId, @RequestBody Object body) {
        return configService.putMembers(lotId, body);
    }

    @GetMapping("/lots/{lotId}/lookup")
    public List<Map<String, Object>> getLookup(@PathVariable String lotId) {
        return configService.getLookup(lotId);
    }

    @PostMapping("/lots/{lotId}/lookup/rebuild")
    public List<Map<String, Object>> rebuildLookup(@PathVariable String lotId) {
        return configService.rebuildLookup(lotId);
    }
}
