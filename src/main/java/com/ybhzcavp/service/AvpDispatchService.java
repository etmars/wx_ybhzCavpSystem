package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.config.AppProperties;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 模拟 Android AVP 调度：/avp/event 后刷新 /avp/groute timestamp。
 */
@Service
public class AvpDispatchService {

    private static final Logger log = LoggerFactory.getLogger(AvpDispatchService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AppProperties props;
    private final MapDataService mapDataService;

    private JsonNode parkRouteTemplate;
    private JsonNode pickupRouteTemplate;
    private final Map<String, GrouteState> grouteByVehicle = new ConcurrentHashMap<>();

    public AvpDispatchService(AppProperties props, MapDataService mapDataService) {
        this.props = props;
        this.mapDataService = mapDataService;
    }

    @PostConstruct
    public void loadRouteTemplates() {
        Path dataRoot = mapDataService.getDataRoot();
        parkRouteTemplate = loadJson(dataRoot.resolve("I1000110.txt"));
        pickupRouteTemplate = loadJson(dataRoot.resolve("O_I1000110.txt"));
        if (pickupRouteTemplate == null) {
            pickupRouteTemplate = parkRouteTemplate;
        }
        String vid = props.getParking().getVehicleId();
        if (parkRouteTemplate != null) {
            grouteByVehicle.put(vid, new GrouteState(0L, ((ObjectNode) parkRouteTemplate).deepCopy()));
        }
    }

    private JsonNode loadJson(Path file) {
        if (!Files.exists(file)) {
            log.warn("AVP route template missing: {}", file);
            return null;
        }
        try {
            return MAPPER.readTree(file.toFile());
        } catch (IOException e) {
            log.error("Failed to load {}", file, e);
            return null;
        }
    }

    public ObjectNode getGroute(String vehicleId) {
        GrouteState state = grouteByVehicle.get(vehicleId);
        if (state == null || state.body == null) {
            ObjectNode empty = MAPPER.createObjectNode();
            empty.put("timestamp", 0L);
            return empty;
        }
        ObjectNode copy = state.body.deepCopy();
        copy.put("timestamp", state.timestamp);
        copy.put("vehicleId", vehicleId);
        return copy;
    }

    public void handleEvent(String vehicleId, Map<String, Object> body) {
        int eventType = body.get("eventType") instanceof Number n ? n.intValue() : 1;
        JsonNode template = eventType == 2 ? pickupRouteTemplate : parkRouteTemplate;
        if (template == null) {
            log.warn("No route template for eventType={}", eventType);
            return;
        }
        long ts = System.currentTimeMillis();
        ObjectNode route = ((ObjectNode) template).deepCopy();
        route.put("timestamp", ts);
        route.put("vehicleId", vehicleId);
        grouteByVehicle.put(vehicleId, new GrouteState(ts, route));
        log.info("groute updated vehicleId={} eventType={} ts={}", vehicleId, eventType, ts);
    }

    private record GrouteState(long timestamp, ObjectNode body) {
    }
}
