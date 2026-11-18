package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;

/** 代网页向标定服换取 parking.avpmap CEK；密钥响应禁止缓存。 */
@Service
public class AvpMapKeyService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final String calibrationBase = env(
            "CALIB_BASE_URL", "https://parkinglot.c-avp.com:18231");
    private final byte[] webTokenSecret = env(
            "MODEL_WEB_TOKEN_SECRET", env("MODEL_TOKEN_SECRET", ""))
            .getBytes(StandardCharsets.UTF_8);

    public ResponseEntity<byte[]> fetchWithWxToken(String mapId, int keyId, String wxToken) {
        if (wxToken == null || wxToken.isBlank()) {
            return ResponseEntity.status(401).body(jsonError("model_token_required"));
        }
        ObjectNode auth = MAPPER.createObjectNode()
                .put("type", "wx_token")
                .put("token", wxToken.trim());
        return fetch(mapId, keyId, auth);
    }

    public ResponseEntity<byte[]> fetchWithWebSubject(String mapId, int keyId, String subject) {
        if (webTokenSecret.length < 32) {
            return ResponseEntity.status(503).body(jsonError("model_web_token_secret_missing"));
        }
        ObjectNode auth = MAPPER.createObjectNode()
                .put("type", "web_token")
                .put("token", signWebToken(subject, mapId));
        return fetch(mapId, keyId, auth);
    }

    /** 标定服二进制下载所需的 X-Model-Auth（base64(JSON)）。 */
    public String webAuthHeader(String mapId, String subject) {
        if (webTokenSecret.length < 32) {
            return "";
        }
        try {
            ObjectNode auth = MAPPER.createObjectNode()
                    .put("type", "web_token")
                    .put("token", signWebToken(subject, mapId));
            return Base64.getEncoder().encodeToString(MAPPER.writeValueAsBytes(auth));
        } catch (Exception error) {
            throw new IllegalStateException("model auth header encode failed", error);
        }
    }

    private ResponseEntity<byte[]> fetch(String mapId, int keyId, ObjectNode auth) {
        if (mapId == null || mapId.isBlank() || keyId <= 0 || keyId > 0xffff) {
            return ResponseEntity.badRequest().body(jsonError("invalid_map_or_key_id"));
        }
        try {
            ObjectNode body = MAPPER.createObjectNode()
                    .put("map_id", mapId)
                    .put("key_id", keyId)
                    .put("asset_name", "parking.avpmap")
                    .set("auth", auth);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(calibrationBase + "/api/model/key"))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(MAPPER.writeValueAsBytes(body)))
                    .build();
            HttpResponse<byte[]> response = client.send(
                    request, HttpResponse.BodyHandlers.ofByteArray());
            return ResponseEntity.status(HttpStatusCode.valueOf(response.statusCode()))
                    .contentType(MediaType.APPLICATION_JSON)
                    .cacheControl(CacheControl.noStore())
                    .header("Pragma", "no-cache")
                    .body(response.body());
        } catch (Exception error) {
            return ResponseEntity.status(502).contentType(MediaType.APPLICATION_JSON)
                    .cacheControl(CacheControl.noStore())
                    .body(jsonError("model_key_upstream_unreachable"));
        }
    }

    private String signWebToken(String subject, String mapId) {
        try {
            ObjectNode payload = MAPPER.createObjectNode()
                    .put("sub", subject)
                    .put("map_id", mapId)
                    .put("exp", Instant.now().getEpochSecond() + 600)
                    .put("scope", "model_key")
                    .put("kind", "web");
            String body = base64Url(MAPPER.writeValueAsBytes(payload));
            String input = "v1." + body;
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(webTokenSecret, "HmacSHA256"));
            return input + "." + base64Url(
                    mac.doFinal(input.getBytes(StandardCharsets.US_ASCII)));
        } catch (Exception error) {
            throw new IllegalStateException("web token sign failed", error);
        }
    }

    private static byte[] jsonError(String error) {
        return ("{\"error\":\"" + error + "\"}").getBytes(StandardCharsets.UTF_8);
    }

    private static String base64Url(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private static String env(String name, String fallback) {
        return System.getenv().getOrDefault(name, fallback).trim().replaceAll("/+$", "");
    }
}
