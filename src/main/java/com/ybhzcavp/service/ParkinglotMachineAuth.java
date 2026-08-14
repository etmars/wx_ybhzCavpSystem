package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/** CavpSystem 调 parkinglot 使用的短期 client_credentials JWT。 */
@Component
public class ParkinglotMachineAuth {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();
    private volatile String token = "";
    private volatile long expiresAtMs;

    public HttpRequest.Builder authorize(HttpRequest.Builder builder) throws Exception {
        return builder.header("Authorization", "Bearer " + token());
    }

    private synchronized String token() throws Exception {
        if (!token.isBlank() && expiresAtMs > System.currentTimeMillis() + 30_000) {
            return token;
        }
        String secret = env("SSO_SERVICE_CLIENT_SECRET", "");
        if (secret.isBlank()) throw new IllegalStateException("SSO_SERVICE_CLIENT_SECRET is required");
        ObjectNode body = MAPPER.createObjectNode();
        body.put("grant_type", "client_credentials");
        body.put("client_id", env("SSO_SERVICE_CLIENT_ID", "cavp-system"));
        body.put("client_secret", secret);
        HttpRequest request = HttpRequest.newBuilder(
                        URI.create(env("SSO_TOKEN_URL", "https://parkinglot.c-avp.com/sso/oauth/token")))
                .timeout(Duration.ofSeconds(15))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> response =
                client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException("SSO token HTTP " + response.statusCode());
        }
        JsonNode json = MAPPER.readTree(response.body());
        token = json.path("access_token").asText("");
        if (token.isBlank()) throw new IllegalStateException("SSO token missing access_token");
        expiresAtMs = System.currentTimeMillis()
                + Math.max(60, json.path("expires_in").asLong(900)) * 1000;
        return token;
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
