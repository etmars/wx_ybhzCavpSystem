package com.ybhzcavp.service;

import com.ybhzcavp.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/** 转发 :3000 /avp/location，供 H5 导航上报渲染进度。 */
@Service
public class AvpLocationProxyService {

    private static final Logger log = LoggerFactory.getLogger(AvpLocationProxyService.class);
    private final AppProperties props;
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .build();

    public AvpLocationProxyService(AppProperties props) {
        this.props = props;
    }

    public ResponseEntity<byte[]> postLocation(String body) {
        String base = props.getParking().getApiBaseUrl().replaceAll("/$", "");
        String url = base + "/avp/location";
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body == null ? "{}" : body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<byte[]> resp = client.send(req, HttpResponse.BodyHandlers.ofByteArray());
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setAccessControlAllowOrigin("*");
            return ResponseEntity.status(resp.statusCode()).headers(headers).body(resp.body());
        } catch (Exception e) {
            log.warn("avp location proxy failed url={}: {}", url, e.getMessage());
            return ResponseEntity.status(502)
                    .body("{\"error\":\"avp location proxy failed\"}".getBytes(StandardCharsets.UTF_8));
        }
    }
}
