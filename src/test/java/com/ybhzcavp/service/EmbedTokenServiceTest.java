package com.ybhzcavp.service;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class EmbedTokenServiceTest {

    private final EmbedTokenService service = new EmbedTokenService(
            "0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.UTF_8),
            Map.of("partner", new EmbedTokenService.ClientConfig(
                    "client-secret",
                    List.of("https://partner.example"),
                    List.of("gqyq", "B2"))));

    @Test
    void issuesOriginAndMapScopedToken() {
        EmbedTokenService.IssuedToken token = service.issue(
                "partner", "client-secret", "https://partner.example", List.of("gqyq"));

        EmbedTokenService.Payload payload = service.validate(token.token(), "gqyq");

        assertThat(payload.clientId()).isEqualTo("partner");
        assertThat(payload.origin()).isEqualTo("https://partner.example");
        assertThat(payload.maps()).containsExactly("gqyq");
    }

    @Test
    void rejectsWrongSecretOriginAndMap() {
        assertThatThrownBy(() -> service.issue(
                "partner", "wrong", "https://partner.example", List.of("gqyq")))
                .hasMessage("invalid_client");
        assertThatThrownBy(() -> service.issue(
                "partner", "client-secret", "https://evil.example", List.of("gqyq")))
                .hasMessage("origin_not_allowed");

        String token = service.issue(
                "partner", "client-secret", "https://partner.example", List.of("gqyq")).token();
        assertThatThrownBy(() -> service.validate(token, "B2"))
                .hasMessage("map_not_allowed");
    }
}
