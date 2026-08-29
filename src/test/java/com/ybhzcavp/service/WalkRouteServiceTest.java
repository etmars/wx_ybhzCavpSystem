package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WalkRouteServiceTest {

    @Test
    void haversineReturnsZeroForSamePoint() {
        assertEquals(0.0, WalkRouteService.haversineMeters(39.9, 116.3, 39.9, 116.3), 0.001);
    }

    @Test
    void haversineReturnsExpectedShortIndoorDistance() {
        double meters = WalkRouteService.haversineMeters(39.9, 116.3, 39.9001, 116.3);
        assertTrue(meters > 10.0 && meters < 12.0);
    }

    @Test
    void flattenPointsJoinsSegmentsWithoutDuplicateSeam() throws Exception {
        var pathList = new ObjectMapper().readTree("""
                [
                  {"pointsPos":[
                    {"longitude":116.0,"latitude":39.0},
                    {"longitude":116.1,"latitude":39.1}
                  ]},
                  {"pointsPos":[
                    {"longitude":116.1,"latitude":39.1},
                    {"longitude":116.2,"latitude":39.2}
                  ]}
                ]
                """);
        var points = WalkRouteService.flattenPoints(pathList);
        assertEquals(3, points.size());
        assertEquals(116.2, points.get(2).path("longitude").asDouble());
    }
}
