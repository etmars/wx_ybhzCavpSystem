package com.ybhzcavp.controller;

import com.ybhzcavp.service.EmbedTokenService;
import com.ybhzcavp.service.AvpMapKeyService;
import com.ybhzcavp.service.MapDataService;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;

@RestController
public class EmbedMapController {

    private final EmbedTokenService tokenService;
    private final MapDataService mapDataService;
    private final AvpMapKeyService avpMapKeyService;

    public EmbedMapController(EmbedTokenService tokenService, MapDataService mapDataService,
                              AvpMapKeyService avpMapKeyService) {
        this.tokenService = tokenService;
        this.mapDataService = mapDataService;
        this.avpMapKeyService = avpMapKeyService;
    }

    @PostMapping("/api/embed/token")
    public ResponseEntity<?> issueToken(
            @RequestHeader(value = "X-Embed-Client-Secret", required = false) String clientSecret,
            @RequestBody TokenRequest request) {
        try {
            EmbedTokenService.IssuedToken issued = tokenService.issue(
                    request.clientId(), clientSecret, request.origin(), request.mapIds());
            return ResponseEntity.ok(Map.of(
                    "token", issued.token(),
                    "expires_at", issued.expiresAt()));
        } catch (EmbedTokenService.TokenException e) {
            HttpStatus status = "embed_disabled".equals(e.getMessage())
                    ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.UNAUTHORIZED;
            return ResponseEntity.status(status).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/embed/map")
    public ResponseEntity<Resource> host(
            @RequestParam(name = "map_id") String mapId,
            @RequestParam String token) {
        try {
            EmbedTokenService.Payload payload = tokenService.validate(token, mapId);
            Resource resource = new ClassPathResource("static/embed/host.html");
            if (!resource.exists()) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.ok()
                    .contentType(MediaType.TEXT_HTML)
                    .cacheControl(CacheControl.noStore())
                    .header("Content-Security-Policy",
                            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                                    + "connect-src 'self'; img-src 'self' data:; frame-ancestors "
                                    + payload.origin())
                    .body(resource);
        } catch (EmbedTokenService.TokenException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
    }

    @GetMapping("/api/embed/maps/{mapId}/avpmap")
    public ResponseEntity<byte[]> avpmap(
            @PathVariable String mapId,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch)
            throws IOException {
        validateBearer(authorization, mapId);
        return serveAsset(mapId, "parking.avpmap", mapDataService.resolveAvpmap(mapId), ifNoneMatch);
    }

    @GetMapping("/api/embed/maps/{mapId}/avpmap-key")
    public ResponseEntity<byte[]> avpmapKey(
            @PathVariable String mapId,
            @RequestParam(name = "key_id") int keyId,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        EmbedTokenService.Payload payload = validateBearer(authorization, mapId);
        return avpMapKeyService.fetchWithWebSubject(
                mapId, keyId, "embed:" + payload.clientId());
    }

    @GetMapping("/api/embed/maps/{mapId}/structures/{name}.mesh")
    public ResponseEntity<byte[]> structure(
            @PathVariable String mapId,
            @PathVariable String name,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch)
            throws IOException {
        validateBearer(authorization, mapId);
        return serveAsset(mapId, "structures/" + name + ".mesh",
                mapDataService.resolveStructureMesh(mapId, name), ifNoneMatch);
    }

    private EmbedTokenService.Payload validateBearer(String authorization, String mapId) {
        String prefix = "Bearer ";
        String token = authorization != null && authorization.startsWith(prefix)
                ? authorization.substring(prefix.length()).trim() : "";
        return tokenService.validate(token, mapId);
    }

    private ResponseEntity<byte[]> serveAsset(
            String mapId, String assetName, Path path, String ifNoneMatch) throws IOException {
        if (path == null) {
            return ResponseEntity.notFound().build();
        }
        String etag = mapDataService.assetEtag(mapId, assetName, path);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        headers.setETag(etag);
        headers.setCacheControl(CacheControl.maxAge(Duration.ZERO).cachePrivate().mustRevalidate());
        headers.set("Content-Encoding", "identity");
        if (ifNoneMatch != null
                && List.of(ifNoneMatch.split(",")).stream().map(String::trim)
                .anyMatch(value -> "*".equals(value)
                        || etag.equals(value)
                        || etag.equals(value.replaceFirst("^W/", "")))) {
            return new ResponseEntity<>(null, headers, HttpStatus.NOT_MODIFIED);
        }
        return new ResponseEntity<>(mapDataService.readBytes(path), headers, HttpStatus.OK);
    }

    public record TokenRequest(String clientId, String origin, List<String> mapIds) {
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(EmbedTokenService.TokenException.class)
    public ResponseEntity<Map<String, String>> invalidToken(EmbedTokenService.TokenException error) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", error.getMessage()));
    }
}
