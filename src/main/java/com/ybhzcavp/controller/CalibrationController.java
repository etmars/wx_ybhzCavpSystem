package com.ybhzcavp.controller;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

@RestController
@RequestMapping("/api/calibration")
public class CalibrationController {

    private final AtomicLong idSeq = new AtomicLong(1);
    private final Map<Long, Map<String, Object>> points = new ConcurrentHashMap<>();

    @PostMapping("/save")
    public Map<String, Object> save(@RequestBody Map<String, Object> body) {
        long id = idSeq.getAndIncrement();
        points.put(id, body);
        return Map.of("ok", true, "id", id);
    }

    @GetMapping("/list")
    public Map<String, Object> list(
            @RequestParam(defaultValue = "200") int limit,
            @RequestParam(required = false) String map_id) {
        List<Map<String, Object>> items = new ArrayList<>(points.values());
        if (items.size() > limit) {
            items = items.subList(0, limit);
        }
        return Map.of("items", items);
    }

    @DeleteMapping("/{pointId}")
    public Map<String, Object> delete(@PathVariable long pointId) {
        points.remove(pointId);
        return Map.of("ok", true);
    }
}
