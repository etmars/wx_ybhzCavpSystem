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

/** 转发校准服 nav_tuning.json */
@Service
public class NavTuningProxyService {

    private static final Logger log = LoggerFactory.getLogger(NavTuningProxyService.class);
    private final AppProperties props;
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .build();

    public NavTuningProxyService(AppProperties props) {
        this.props = props;
    }

    public ResponseEntity<byte[]> fetchNavTuning(String mapId) {
        String calib = props.getCalib().getApiBaseUrl().replaceAll("/$", "");
        String url = calib + "/api/model/nav_tuning.json?map_id=" + URLEncoder.encode(mapId, StandardCharsets.UTF_8);
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
            log.warn("nav_tuning proxy failed url={}: {}", url, e.getMessage());
            return ResponseEntity.ok("{\"nav\":{}}".getBytes(StandardCharsets.UTF_8));
        }
    }
}
