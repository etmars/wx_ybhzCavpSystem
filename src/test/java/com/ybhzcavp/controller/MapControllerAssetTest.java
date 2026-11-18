package com.ybhzcavp.controller;

import com.ybhzcavp.config.AppProperties;
import com.ybhzcavp.service.MapDataService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class MapControllerAssetTest {

    @TempDir
    Path dataRoot;

    private MapController controller;

    @BeforeEach
    void setUp() throws Exception {
        Path mapDir = dataRoot.resolve("maps/test-map");
        Files.createDirectories(mapDir.resolve("structures"));
        Files.writeString(dataRoot.resolve("maps_index.json"),
                """
                {"maps":[{"id":"test-map","name":"Test Map"}]}
                """);

        AppProperties properties = new AppProperties();
        properties.setDataDir(dataRoot.toString());
        MapDataService mapDataService = new MapDataService(properties);
        mapDataService.init();
        controller = new MapController(
                mapDataService,
                null,
                null,
                null,
                null,
                null,
                null);
    }

    @Test
    void servesAvpmapWithCrcEtagAndHandlesConditionalGet() throws Exception {
        byte[] bytes = "AVPM-test".getBytes();
        Files.write(dataRoot.resolve("maps/test-map/parking.avpmap"), bytes);
        Files.writeString(dataRoot.resolve("maps/test-map/.assets_crc32.json"),
                "{\"parking.avpmap\":\"1a2b3c4d\"}");

        ResponseEntity<byte[]> response = controller.avpmap("test-map", null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_TYPE))
                .isEqualTo("application/octet-stream");
        assertThat(response.getHeaders().getETag()).isEqualTo("\"crc32-1a2b3c4d\"");
        assertThat(response.getHeaders().getCacheControl())
                .isEqualTo("max-age=0, must-revalidate, private");
        assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_ENCODING)).isEqualTo("identity");
        assertThat(response.getBody()).isEqualTo(bytes);

        ResponseEntity<byte[]> notModified =
                controller.avpmap("test-map", "W/\"crc32-1a2b3c4d\"");
        assertThat(notModified.getStatusCode()).isEqualTo(HttpStatus.NOT_MODIFIED);
        assertThat(notModified.getBody()).isNull();
    }

    @Test
    void servesOnlySafeMapSpecificStructureNames() throws Exception {
        byte[] mesh = "mesh-data".getBytes();
        Files.write(dataRoot.resolve("maps/test-map/structures/elevator.mesh"), mesh);

        ResponseEntity<byte[]> response = controller.structureMesh("test-map", "elevator", null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(mesh);
        assertThat(controller.structureMesh("test-map", "..", null).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(controller.structureMesh("../test-map", "elevator", null).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }
}
