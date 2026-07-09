package com.ybhzcavp.service;

import com.ybhzcavp.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/** 转发 :3000 /avp/groute，供 H5 与 Home 页使用同一份路线。 */
@Service
public class GrouteProxyService {

    private static final Logger log = LoggerFactory.getLogger(GrouteProxyService.class);
    private final AppProperties props;
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .build();

    public GrouteProxyService(AppProperties props) {
        this.props = props;
    }

    public ResponseEntity<byte[]> fetchLiveGroute(String vehicleId) {
        String base = props.getParking().getApiBaseUrl().replaceAll("/$", "");
        String url = base + "/avp/groute?vehicleId=" + URLEncoder.encode(vehicleId, StandardCharsets.UTF_8);
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(15))
                    .GET()
                    .build();
            HttpResponse<byte[]> resp = client.send(req, HttpResponse.BodyHandlers.ofByteArray());
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setAccessControlAllowOrigin("*");
            return ResponseEntity.status(resp.statusCode()).headers(headers).body(resp.body());
        } catch (Exception e) {
            log.warn("groute proxy failed url={}: {}", url, e.getMessage());
            return ResponseEntity.status(502).body(("{\"error\":\"groute proxy failed\"}").getBytes(StandardCharsets.UTF_8));
        }
    }
}
