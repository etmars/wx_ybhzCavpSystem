package com.ybhzcavp.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ybhzcavp.config.dao.ConfigDao;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class ConfigService {

    private static final Logger log = LoggerFactory.getLogger(ConfigService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {};
    private static final TypeReference<List<Object>> OBJECT_LIST = new TypeReference<>() {};

    private final ConfigDao dao;

    public ConfigService(ConfigDao dao) {
        this.dao = dao;
    }

    public List<Map<String, Object>> listLots() {
        return dao.listLots();
    }

    public Map<String, Object> createLot(Map<String, Object> body) {
        String lotId = stringVal(body, "lotId", "lot_id");
        if (lotId == null || lotId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "lotId required");
        }
        if (stringVal(body, "name") == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "name required");
        }
        String now = Instant.now().toString();
        body.putIfAbsent("createdAt", now);
        body.put("updatedAt", now);
        dao.upsertLot(body);
        dao.upsertDispatch(lotId, Map.of("provider", "internal"));
        return dao.getLot(lotId).orElseThrow();
    }

    public Map<String, Object> getLot(String lotId) {
        return dao.getLot(lotId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "lot not found: " + lotId));
    }

    public Map<String, Object> updateLot(String lotId, Map<String, Object> body) {
        Map<String, Object> existing = getLot(lotId);
        Map<String, Object> merged = new LinkedHashMap<>(existing);
        merge(merged, body);
        merged.put("lotId", lotId);
        merged.put("createdAt", existing.get("createdAt"));
        merged.put("updatedAt", Instant.now().toString());
        dao.upsertLot(merged);
        return getLot(lotId);
    }

    public Map<String, Object> getDispatch(String lotId) {
        ensureLot(lotId);
        return dao.getDispatch(lotId).orElseGet(() -> {
            Map<String, Object> def = new LinkedHashMap<>();
            def.put("lotId", lotId);
            def.put("provider", "internal");
            def.put("providerParams", null);
            return def;
        });
    }

    public Map<String, Object> putDispatch(String lotId, Map<String, Object> body) {
        ensureLot(lotId);
        String provider = stringVal(body, "provider");
        if (provider == null || (!provider.equals("internal") && !provider.equals("tsinghua"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "provider must be internal|tsinghua");
        }
        dao.upsertDispatch(lotId, body);
        return getDispatch(lotId);
    }

    public Map<String, Object> getDevice(String lotId) {
        ensureLot(lotId);
        return dao.getDevice(lotId).orElseGet(() -> {
            Map<String, Object> def = new LinkedHashMap<>();
            def.put("lotId", lotId);
            def.put("accessMode", "http");
            def.put("endpoint", null);
            def.put("vendor", null);
            return def;
        });
    }

    public Map<String, Object> putDevice(String lotId, Map<String, Object> body) {
        ensureLot(lotId);
        dao.upsertDevice(lotId, body);
        return getDevice(lotId);
    }

    public List<Map<String, Object>> getDestinations(String lotId) {
        ensureLot(lotId);
        return dao.listDestinations(lotId);
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> putDestinations(String lotId, Object body) {
        ensureLot(lotId);
        dao.replaceDestinations(lotId, asMapList(body));
        return dao.listDestinations(lotId);
    }

    public List<Map<String, Object>> getMaps(String lotId) {
        ensureLot(lotId);
        return dao.listMaps(lotId);
    }

    public List<Map<String, Object>> putMaps(String lotId, Object body) {
        ensureLot(lotId);
        dao.replaceMaps(lotId, asMapList(body));
        return dao.listMaps(lotId);
    }

    public List<Map<String, Object>> getZones(String lotId) {
        ensureLot(lotId);
        return dao.listZones(lotId);
    }

    public List<Map<String, Object>> putZones(String lotId, Object body) {
        ensureLot(lotId);
        dao.replaceZones(lotId, asMapList(body));
        return dao.listZones(lotId);
    }

    public List<Map<String, Object>> getMembers(String lotId) {
        ensureLot(lotId);
        return dao.listMembers(lotId);
    }

    public List<Map<String, Object>> putMembers(String lotId, Object body) {
        ensureLot(lotId);
        dao.replaceMembers(lotId, asMapList(body));
        return dao.listMembers(lotId);
    }

    public List<Map<String, Object>> getLookup(String lotId) {
        ensureLot(lotId);
        return dao.listLookup(lotId);
    }

    /**
     * 根据 zones + members 生成会员 → 排序车位列表 JSON。
     * 规则：按 zone.priority 降序展开 allowed zones 的 spot_names；再截断 max_spots。
     */
    public List<Map<String, Object>> rebuildLookup(String lotId) {
        ensureLot(lotId);
        List<Map<String, Object>> zones = dao.listZones(lotId);
        List<Map<String, Object>> members = dao.listMembers(lotId);
        Map<Long, Map<String, Object>> zoneById = new HashMap<>();
        Map<String, Map<String, Object>> zoneByName = new HashMap<>();
        for (Map<String, Object> z : zones) {
            Long id = ((Number) z.get("id")).longValue();
            zoneById.put(id, z);
            zoneByName.put(String.valueOf(z.get("name")), z);
        }

        String generatedAt = Instant.now().toString();
        List<Map<String, Object>> entries = new ArrayList<>();
        for (Map<String, Object> member : members) {
            String memberId = String.valueOf(member.get("id"));
            Set<String> allowed = resolveAllowedZones(member, zoneById, zoneByName);
            List<ZoneSpot> candidates = new ArrayList<>();
            for (Map<String, Object> z : zones) {
                String zName = String.valueOf(z.get("name"));
                Long zId = ((Number) z.get("id")).longValue();
                if (!allowed.isEmpty()
                        && !allowed.contains(zName)
                        && !allowed.contains(String.valueOf(zId))) {
                    continue;
                }
                int priority = memberInt(z.get("priority"), 0);
                for (String spot : parseSpotNames(z.get("spotNamesJson"))) {
                    candidates.add(new ZoneSpot(spot, priority, zName));
                }
            }
            // priority 高优先；同优先级保持 zone 顺序 / 车位名稳定排序
            candidates.sort((a, b) -> {
                int c = Integer.compare(b.priority, a.priority);
                if (c != 0) {
                    return c;
                }
                c = a.zoneName.compareTo(b.zoneName);
                if (c != 0) {
                    return c;
                }
                return a.spot.compareTo(b.spot);
            });
            Integer maxSpots = member.get("maxSpots") instanceof Number n ? n.intValue() : null;
            List<String> spots = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (ZoneSpot zs : candidates) {
                if (!seen.add(zs.spot)) {
                    continue;
                }
                spots.add(zs.spot);
                if (maxSpots != null && spots.size() >= maxSpots) {
                    break;
                }
            }

            ObjectNode entry = MAPPER.createObjectNode();
            entry.put("memberId", memberId);
            entry.put("memberName", String.valueOf(member.get("name")));
            ArrayNode arr = entry.putArray("spots");
            spots.forEach(arr::add);
            entry.put("spotCount", spots.size());

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("memberId", memberId);
            row.put("entryJson", entry.toString());
            row.put("generatedAt", generatedAt);
            entries.add(row);
        }
        dao.replaceLookup(lotId, entries);
        log.info("lookup rebuilt lotId={} members={}", lotId, entries.size());
        return dao.listLookup(lotId);
    }

    private Set<String> resolveAllowedZones(Map<String, Object> member,
                                            Map<Long, Map<String, Object>> zoneById,
                                            Map<String, Map<String, Object>> zoneByName) {
        Set<String> allowed = new HashSet<>();
        Object raw = member.get("allowedZonesJson");
        if (raw == null || String.valueOf(raw).isBlank()) {
            return allowed; // 空 = 全部 zone
        }
        try {
            String s = String.valueOf(raw).trim();
            if (s.startsWith("[")) {
                List<Object> list = MAPPER.readValue(s, OBJECT_LIST);
                for (Object o : list) {
                    if (o instanceof Number n) {
                        allowed.add(String.valueOf(n.longValue()));
                        Map<String, Object> z = zoneById.get(n.longValue());
                        if (z != null) {
                            allowed.add(String.valueOf(z.get("name")));
                        }
                    } else {
                        allowed.add(String.valueOf(o));
                        Map<String, Object> z = zoneByName.get(String.valueOf(o));
                        if (z != null) {
                            allowed.add(String.valueOf(z.get("id")));
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.warn("parse allowedZonesJson failed: {}", e.getMessage());
        }
        return allowed;
    }

    private List<String> parseSpotNames(Object raw) {
        if (raw == null) {
            return List.of();
        }
        try {
            String s = String.valueOf(raw).trim();
            if (s.isEmpty()) {
                return List.of();
            }
            if (s.startsWith("[")) {
                return MAPPER.readValue(s, STRING_LIST);
            }
            return List.of(s.split("[,;\\s]+"));
        } catch (Exception e) {
            log.warn("parse spotNamesJson failed: {}", e.getMessage());
            return List.of();
        }
    }

    private void ensureLot(String lotId) {
        getLot(lotId);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> asMapList(Object body) {
        if (body == null) {
            return List.of();
        }
        if (body instanceof List<?> list) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Object o : list) {
                if (o instanceof Map<?, ?> m) {
                    out.add((Map<String, Object>) m);
                }
            }
            return out;
        }
        if (body instanceof Map<?, ?> map) {
            Object items = map.get("items");
            if (items == null) {
                items = map.get("data");
            }
            if (items instanceof List<?>) {
                return asMapList(items);
            }
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "expected JSON array");
    }

    private static void merge(Map<String, Object> target, Map<String, Object> src) {
        if (src == null) {
            return;
        }
        for (Map.Entry<String, Object> e : src.entrySet()) {
            String k = e.getKey();
            if ("lot_id".equals(k)) {
                target.put("lotId", e.getValue());
            } else if ("anchor_lat".equals(k)) {
                target.put("anchorLat", e.getValue());
            } else if ("anchor_lon".equals(k)) {
                target.put("anchorLon", e.getValue());
            } else if ("map_bearing".equals(k)) {
                target.put("mapBearing", e.getValue());
            } else if ("created_at".equals(k) || "updated_at".equals(k) || "lotId".equals(k)) {
                // skip identity / timestamps from client overwrite of created
            } else {
                target.put(k, e.getValue());
            }
        }
    }

    private static String stringVal(Map<String, Object> m, String... keys) {
        for (String k : keys) {
            Object v = m.get(k);
            if (v != null) {
                return String.valueOf(v);
            }
        }
        return null;
    }

    private static int memberInt(Object v, int def) {
        return v instanceof Number n ? n.intValue() : def;
    }

    private record ZoneSpot(String spot, int priority, String zoneName) {
    }
}
