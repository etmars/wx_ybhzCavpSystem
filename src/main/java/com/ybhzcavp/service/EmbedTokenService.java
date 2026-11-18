package com.ybhzcavp.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * 托管地图 H5 的短期访问令牌。
 *
 * <p>客户端配置来自 AVPMAP_EMBED_CLIENTS_JSON：
 * {@code {"partner":{"secret":"...","origins":["https://a.example"],"maps":["gqyq"]}}}。
 * 签名密钥来自 AVPMAP_EMBED_SIGNING_KEY。</p>
 */
@Service
public class EmbedTokenService {

    private static final long TOKEN_TTL_SECONDS = 300;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final byte[] signingKey;
    private final Map<String, ClientConfig> clients;

    public EmbedTokenService() {
        this(env("AVPMAP_EMBED_SIGNING_KEY").getBytes(StandardCharsets.UTF_8),
                parseClients(env("AVPMAP_EMBED_CLIENTS_JSON")));
    }

    EmbedTokenService(byte[] signingKey, Map<String, ClientConfig> clients) {
        this.signingKey = signingKey.clone();
        this.clients = Map.copyOf(clients);
    }

    public boolean enabled() {
        return signingKey.length >= 32 && !clients.isEmpty();
    }

    public IssuedToken issue(String clientId, String clientSecret, String origin, List<String> maps) {
        if (!enabled()) {
            throw new TokenException("embed_disabled");
        }
        ClientConfig client = clients.get(clientId);
        if (client == null || !constantEquals(client.secret(), clientSecret)) {
            throw new TokenException("invalid_client");
        }
        if (!client.origins().contains(origin)) {
            throw new TokenException("origin_not_allowed");
        }
        List<String> requestedMaps = maps == null ? List.of() : maps.stream().distinct().toList();
        if (requestedMaps.isEmpty() || !client.maps().containsAll(requestedMaps)) {
            throw new TokenException("map_not_allowed");
        }
        long expiresAt = Instant.now().getEpochSecond() + TOKEN_TTL_SECONDS;
        Payload payload = new Payload(clientId, origin, requestedMaps, expiresAt);
        try {
            String body = base64Url(MAPPER.writeValueAsBytes(payload));
            return new IssuedToken(body + "." + sign(body), expiresAt);
        } catch (Exception e) {
            throw new IllegalStateException("embed token encode failed", e);
        }
    }

    public Payload validate(String token, String mapId) {
        if (!enabled() || token == null || token.isBlank()) {
            throw new TokenException("invalid_token");
        }
        String[] parts = token.split("\\.", -1);
        if (parts.length != 2 || !constantEquals(sign(parts[0]), parts[1])) {
            throw new TokenException("invalid_token");
        }
        try {
            Payload payload = MAPPER.readValue(
                    Base64.getUrlDecoder().decode(parts[0]), Payload.class);
            if (payload.exp() < Instant.now().getEpochSecond()) {
                throw new TokenException("token_expired");
            }
            if (mapId != null && !mapId.isBlank() && !payload.maps().contains(mapId)) {
                throw new TokenException("map_not_allowed");
            }
            ClientConfig client = clients.get(payload.clientId());
            if (client == null || !client.origins().contains(payload.origin())) {
                throw new TokenException("invalid_token");
            }
            return payload;
        } catch (TokenException e) {
            throw e;
        } catch (Exception e) {
            throw new TokenException("invalid_token");
        }
    }

    private String sign(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(signingKey, "HmacSHA256"));
            return base64Url(mac.doFinal(body.getBytes(StandardCharsets.US_ASCII)));
        } catch (Exception e) {
            throw new IllegalStateException("embed token sign failed", e);
        }
    }

    private static boolean constantEquals(String a, String b) {
        return MessageDigest.isEqual(
                String.valueOf(a).getBytes(StandardCharsets.UTF_8),
                String.valueOf(b).getBytes(StandardCharsets.UTF_8));
    }

    private static String base64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String env(String name) {
        return System.getenv().getOrDefault(name, "").trim();
    }

    private static Map<String, ClientConfig> parseClients(String json) {
        if (json.isBlank()) {
            return Map.of();
        }
        try {
            return MAPPER.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            throw new IllegalStateException("invalid AVPMAP_EMBED_CLIENTS_JSON", e);
        }
    }

    public record ClientConfig(String secret, List<String> origins, List<String> maps) {
        public ClientConfig {
            origins = origins == null ? List.of() : List.copyOf(origins);
            maps = maps == null ? List.of() : List.copyOf(maps);
        }
    }

    public record Payload(String clientId, String origin, List<String> maps, long exp) {
    }

    public record IssuedToken(String token, long expiresAt) {
    }

    public static final class TokenException extends RuntimeException {
        public TokenException(String message) {
            super(message);
        }
    }
}
