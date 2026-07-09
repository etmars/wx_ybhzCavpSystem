package com.ybhzcavp.controller;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.service.AvpDispatchService;
import com.ybhzcavp.service.ParkingService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class ParkingController {

    private final ParkingService parkingService;
    private final AvpDispatchService avpDispatchService;

    public ParkingController(ParkingService parkingService, AvpDispatchService avpDispatchService) {
        this.parkingService = parkingService;
        this.avpDispatchService = avpDispatchService;
    }

    @GetMapping("/api/nearby")
    public ObjectNode nearby(
            @RequestParam double lng,
            @RequestParam double lat,
            @RequestParam(defaultValue = "5000") int radius) {
        return parkingService.nearby(lng, lat, radius);
    }

    @GetMapping("/api/parking-lots")
    public ArrayNode parkingLots() {
        return parkingService.parkingLots();
    }

    @GetMapping("/api/maps")
    public ArrayNode maps(@RequestParam(name = "parking_lot_id") String parkingLotId) {
        return parkingService.maps(parkingLotId);
    }

    @GetMapping("/avp/totalparking")
    public ObjectNode totalParking(@RequestParam String parkingId) {
        return parkingService.totalParking(parkingId);
    }

    @PostMapping("/avp/sub")
    public ResponseEntity<Map<String, String>> avpSub(@RequestBody(required = false) Map<String, Object> body) {
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    @PostMapping("/avp/event")
    public ResponseEntity<Map<String, String>> avpEvent(@RequestBody Map<String, Object> body) {
        Object vehicleId = body.get("vehicleId");
        if (vehicleId != null) {
            avpDispatchService.handleEvent(String.valueOf(vehicleId), body);
        }
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    @GetMapping("/avp/groute")
    public ObjectNode groute(@RequestParam String vehicleId) {
        return avpDispatchService.getGroute(vehicleId);
    }

    @GetMapping("/api/avp/assignment")
    public Map<String, Object> avpAssignment() {
        return parkingService.avpAssignment();
    }
}
