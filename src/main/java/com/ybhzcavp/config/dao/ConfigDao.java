package com.ybhzcavp.config.dao;

import com.ybhzcavp.config.ConfigDb;
import org.springframework.stereotype.Repository;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 配置库 JDBC DAO（原生 SQLite，无 JPA）。
 */
@Repository
public class ConfigDao {

    private final ConfigDb configDb;

    public ConfigDao(ConfigDb configDb) {
        this.configDb = configDb;
    }

    private Connection conn() {
        return configDb.getConnection();
    }

    // ---------- parking_lot ----------

    public List<Map<String, Object>> listLots() {
        String sql = "SELECT lot_id, name, status, anchor_lat, anchor_lon, map_bearing, scale, created_at, updated_at "
                + "FROM parking_lot ORDER BY lot_id";
        List<Map<String, Object>> rows = new ArrayList<>();
        try (PreparedStatement ps = conn().prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                rows.add(mapLot(rs));
            }
        } catch (SQLException e) {
            throw new IllegalStateException("listLots failed", e);
        }
        return rows;
    }

    public Optional<Map<String, Object>> getLot(String lotId) {
        String sql = "SELECT lot_id, name, status, anchor_lat, anchor_lon, map_bearing, scale, created_at, updated_at "
                + "FROM parking_lot WHERE lot_id = ?";
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, lotId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(mapLot(rs));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("getLot failed", e);
        }
        return Optional.empty();
    }

    public void upsertLot(Map<String, Object> lot) {
        String sql = """
                INSERT INTO parking_lot (lot_id, name, status, anchor_lat, anchor_lon, map_bearing, scale, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(lot_id) DO UPDATE SET
                  name=excluded.name, status=excluded.status,
                  anchor_lat=excluded.anchor_lat, anchor_lon=excluded.anchor_lon,
                  map_bearing=excluded.map_bearing, scale=excluded.scale,
                  updated_at=excluded.updated_at
                """;
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, str(lot, "lotId", "lot_id"));
            ps.setString(2, str(lot, "name"));
            ps.setString(3, strOr(lot, "status", "active"));
            setDouble(ps, 4, lot, "anchorLat", "anchor_lat");
            setDouble(ps, 5, lot, "anchorLon", "anchor_lon");
            setDouble(ps, 6, lot, "mapBearing", "map_bearing");
            setDouble(ps, 7, lot, "scale");
            String now = strOr(lot, "updatedAt", strOr(lot, "updated_at", nowIso()));
            String created = strOr(lot, "createdAt", strOr(lot, "created_at", now));
            ps.setString(8, created);
            ps.setString(9, now);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("upsertLot failed", e);
        }
    }

    private Map<String, Object> mapLot(ResultSet rs) throws SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("lotId", rs.getString("lot_id"));
        m.put("name", rs.getString("name"));
        m.put("status", rs.getString("status"));
        m.put("anchorLat", rs.getObject("anchor_lat"));
        m.put("anchorLon", rs.getObject("anchor_lon"));
        m.put("mapBearing", rs.getObject("map_bearing"));
        m.put("scale", rs.getObject("scale"));
        m.put("createdAt", rs.getString("created_at"));
        m.put("updatedAt", rs.getString("updated_at"));
        return m;
    }

    // ---------- dispatch ----------

    public Optional<Map<String, Object>> getDispatch(String lotId) {
        String sql = "SELECT lot_id, provider, provider_params FROM parking_lot_dispatch WHERE lot_id = ?";
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, lotId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("lotId", rs.getString("lot_id"));
                    m.put("provider", rs.getString("provider"));
                    m.put("providerParams", rs.getString("provider_params"));
                    return Optional.of(m);
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("getDispatch failed", e);
        }
        return Optional.empty();
    }

    public void upsertDispatch(String lotId, Map<String, Object> body) {
        String sql = """
                INSERT INTO parking_lot_dispatch (lot_id, provider, provider_params)
                VALUES (?, ?, ?)
                ON CONFLICT(lot_id) DO UPDATE SET
                  provider=excluded.provider, provider_params=excluded.provider_params
                """;
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, lotId);
            ps.setString(2, strOr(body, "provider", "internal"));
            ps.setString(3, str(body, "providerParams", "provider_params"));
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("upsertDispatch failed", e);
        }
    }

    // ---------- device ----------

    public Optional<Map<String, Object>> getDevice(String lotId) {
        String sql = "SELECT lot_id, access_mode, endpoint, vendor FROM parking_lot_device WHERE lot_id = ?";
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, lotId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("lotId", rs.getString("lot_id"));
                    m.put("accessMode", rs.getString("access_mode"));
                    m.put("endpoint", rs.getString("endpoint"));
                    m.put("vendor", rs.getString("vendor"));
                    return Optional.of(m);
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("getDevice failed", e);
        }
        return Optional.empty();
    }

    public void upsertDevice(String lotId, Map<String, Object> body) {
        String sql = """
                INSERT INTO parking_lot_device (lot_id, access_mode, endpoint, vendor)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(lot_id) DO UPDATE SET
                  access_mode=excluded.access_mode, endpoint=excluded.endpoint, vendor=excluded.vendor
                """;
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, lotId);
            ps.setString(2, strOr(body, "accessMode", strOr(body, "access_mode", "http")));
            ps.setString(3, str(body, "endpoint"));
            ps.setString(4, str(body, "vendor"));
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("upsertDevice failed", e);
        }
    }

    // ---------- destinations ----------

    public List<Map<String, Object>> listDestinations(String lotId) {
        String sql = "SELECT id, lot_id, dest_type, url, enabled, params_json FROM parking_lot_destination "
                + "WHERE lot_id = ? ORDER BY id";
        List<Map<String, Object>> rows = new ArrayList<>();
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, lotId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("lotId", rs.getString("lot_id"));
                    m.put("destType", rs.getString("dest_type"));
                    m.put("url", rs.getString("url"));
                    m.put("enabled", rs.getInt("enabled") == 1);
                    m.put("paramsJson", rs.getString("params_json"));
                    rows.add(m);
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("listDestinations failed", e);
        }
        return rows;
    }

    public void replaceDestinations(String lotId, List<Map<String, Object>> items) {
        try {
            conn().setAutoCommit(false);
            try (PreparedStatement del = conn().prepareStatement(
                    "DELETE FROM parking_lot_destination WHERE lot_id = ?")) {
                del.setString(1, lotId);
                del.executeUpdate();
            }
            String insert = "INSERT INTO parking_lot_destination (lot_id, dest_type, url, enabled, params_json) "
                    + "VALUES (?, ?, ?, ?, ?)";
            try (PreparedStatement ps = conn().prepareStatement(insert)) {
                for (Map<String, Object> item : items) {
                    ps.setString(1, lotId);
                    ps.setString(2, str(item, "destType", "dest_type"));
                    ps.setString(3, str(item, "url"));
                    Object en = first(item, "enabled");
                    int enabled = (en instanceof Boolean b) ? (b ? 1 : 0)
                            : (en instanceof Number n) ? n.intValue() : 1;
                    ps.setInt(4, enabled);
                    ps.setString(5, str(item, "paramsJson", "params_json"));
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            conn().commit();
        } catch (SQLException e) {
            try {
                conn().rollback();
            } catch (SQLException ignored) {
            }
            throw new IllegalStateException("replaceDestinations failed", e);
        } finally {
            try {
                conn().setAutoCommit(true);
            } catch (SQLException ignored) {
            }
        }
    }

    // ---------- maps ----------

    public List<Map<String, Object>> listMaps(String lotId) {
        String sql = "SELECT id, lot_id, map_id, floor, map_type, sort_order FROM parking_lot_map "
                + "WHERE lot_id = ? ORDER BY sort_order, id";
        List<Map<String, Object>> rows = new ArrayList<>();
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, lotId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("lotId", rs.getString("lot_id"));
                    m.put("mapId", rs.getString("map_id"));
                    m.put("floor", rs.getString("floor"));
                    m.put("mapType", rs.getString("map_type"));
                    m.put("sortOrder", rs.getInt("sort_order"));
                    rows.add(m);
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("listMaps failed", e);
        }
        return rows;
    }

    public void replaceMaps(String lotId, List<Map<String, Object>> items) {
        try {
            conn().setAutoCommit(false);
            try (PreparedStatement del = conn().prepareStatement("DELETE FROM parking_lot_map WHERE lot_id = ?")) {
                del.setString(1, lotId);
                del.executeUpdate();
            }
            String insert = "INSERT INTO parking_lot_map (lot_id, map_id, floor, map_type, sort_order) VALUES (?, ?, ?, ?, ?)";
            try (PreparedStatement ps = conn().prepareStatement(insert)) {
                int i = 0;
                for (Map<String, Object> item : items) {
                    ps.setString(1, lotId);
                    ps.setString(2, str(item, "mapId", "map_id"));
                    ps.setString(3, str(item, "floor"));
                    ps.setString(4, strOr(item, "mapType", strOr(item, "map_type", "osm")));
                    Object so = first(item, "sortOrder", "sort_order");
                    ps.setInt(5, so instanceof Number n ? n.intValue() : i);
                    ps.addBatch();
                    i++;
                }
                ps.executeBatch();
            }
            conn().commit();
        } catch (SQLException e) {
            try {
                conn().rollback();
            } catch (SQLException ignored) {
            }
            throw new IllegalStateException("replaceMaps failed", e);
        } finally {
            try {
                conn().setAutoCommit(true);
            } catch (SQLException ignored) {
            }
        }
    }

    // ---------- zones ----------

    public List<Map<String, Object>> listZones(String lotId) {
        String sql = "SELECT id, lot_id, name, color, bounds_json, priority, spot_names_json FROM parking_zone "
                + "WHERE lot_id = ? ORDER BY priority DESC, id";
        List<Map<String, Object>> rows = new ArrayList<>();
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, lotId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("lotId", rs.getString("lot_id"));
                    m.put("name", rs.getString("name"));
                    m.put("color", rs.getString("color"));
                    m.put("boundsJson", rs.getString("bounds_json"));
                    m.put("priority", rs.getInt("priority"));
                    m.put("spotNamesJson", rs.getString("spot_names_json"));
                    rows.add(m);
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("listZones failed", e);
        }
        return rows;
    }

    public void replaceZones(String lotId, List<Map<String, Object>> items) {
        try {
            conn().setAutoCommit(false);
            try (PreparedStatement del = conn().prepareStatement("DELETE FROM parking_zone WHERE lot_id = ?")) {
                del.setString(1, lotId);
                del.executeUpdate();
            }
            String insert = "INSERT INTO parking_zone (lot_id, name, color, bounds_json, priority, spot_names_json) "
                    + "VALUES (?, ?, ?, ?, ?, ?)";
            try (PreparedStatement ps = conn().prepareStatement(insert)) {
                for (Map<String, Object> item : items) {
                    ps.setString(1, lotId);
                    ps.setString(2, str(item, "name"));
                    ps.setString(3, str(item, "color"));
                    ps.setString(4, str(item, "boundsJson", "bounds_json"));
                    Object p = first(item, "priority");
                    ps.setInt(5, p instanceof Number n ? n.intValue() : 0);
                    ps.setString(6, str(item, "spotNamesJson", "spot_names_json"));
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            conn().commit();
        } catch (SQLException e) {
            try {
                conn().rollback();
            } catch (SQLException ignored) {
            }
            throw new IllegalStateException("replaceZones failed", e);
        } finally {
            try {
                conn().setAutoCommit(true);
            } catch (SQLException ignored) {
            }
        }
    }

    // ---------- members ----------

    public List<Map<String, Object>> listMembers(String lotId) {
        String sql = "SELECT id, lot_id, name, color, allowed_zones_json, max_spots FROM member_config "
                + "WHERE lot_id = ? ORDER BY id";
        List<Map<String, Object>> rows = new ArrayList<>();
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, lotId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getLong("id"));
                    m.put("lotId", rs.getString("lot_id"));
                    m.put("name", rs.getString("name"));
                    m.put("color", rs.getString("color"));
                    m.put("allowedZonesJson", rs.getString("allowed_zones_json"));
                    m.put("maxSpots", rs.getObject("max_spots"));
                    rows.add(m);
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("listMembers failed", e);
        }
        return rows;
    }

    public void replaceMembers(String lotId, List<Map<String, Object>> items) {
        try {
            conn().setAutoCommit(false);
            try (PreparedStatement del = conn().prepareStatement("DELETE FROM member_config WHERE lot_id = ?")) {
                del.setString(1, lotId);
                del.executeUpdate();
            }
            String insert = "INSERT INTO member_config (lot_id, name, color, allowed_zones_json, max_spots) "
                    + "VALUES (?, ?, ?, ?, ?)";
            try (PreparedStatement ps = conn().prepareStatement(insert)) {
                for (Map<String, Object> item : items) {
                    ps.setString(1, lotId);
                    ps.setString(2, str(item, "name"));
                    ps.setString(3, str(item, "color"));
                    ps.setString(4, str(item, "allowedZonesJson", "allowed_zones_json"));
                    Object max = first(item, "maxSpots", "max_spots");
                    if (max instanceof Number n) {
                        ps.setInt(5, n.intValue());
                    } else {
                        ps.setObject(5, null);
                    }
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            conn().commit();
        } catch (SQLException e) {
            try {
                conn().rollback();
            } catch (SQLException ignored) {
            }
            throw new IllegalStateException("replaceMembers failed", e);
        } finally {
            try {
                conn().setAutoCommit(true);
            } catch (SQLException ignored) {
            }
        }
    }

    // ---------- lookup ----------

    public List<Map<String, Object>> listLookup(String lotId) {
        String sql = "SELECT lot_id, member_id, entry_json, generated_at FROM parking_lookup "
                + "WHERE lot_id = ? ORDER BY member_id";
        List<Map<String, Object>> rows = new ArrayList<>();
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, lotId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("lotId", rs.getString("lot_id"));
                    m.put("memberId", rs.getString("member_id"));
                    m.put("entryJson", rs.getString("entry_json"));
                    m.put("generatedAt", rs.getString("generated_at"));
                    rows.add(m);
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("listLookup failed", e);
        }
        return rows;
    }

    public Optional<Map<String, Object>> getLookup(String lotId, String memberId) {
        String sql = "SELECT lot_id, member_id, entry_json, generated_at FROM parking_lookup "
                + "WHERE lot_id = ? AND member_id = ?";
        try (PreparedStatement ps = conn().prepareStatement(sql)) {
            ps.setString(1, lotId);
            ps.setString(2, memberId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("lotId", rs.getString("lot_id"));
                    m.put("memberId", rs.getString("member_id"));
                    m.put("entryJson", rs.getString("entry_json"));
                    m.put("generatedAt", rs.getString("generated_at"));
                    return Optional.of(m);
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("getLookup failed", e);
        }
        return Optional.empty();
    }

    public void replaceLookup(String lotId, List<Map<String, Object>> entries) {
        try {
            conn().setAutoCommit(false);
            try (PreparedStatement del = conn().prepareStatement("DELETE FROM parking_lookup WHERE lot_id = ?")) {
                del.setString(1, lotId);
                del.executeUpdate();
            }
            String insert = "INSERT INTO parking_lookup (lot_id, member_id, entry_json, generated_at) VALUES (?, ?, ?, ?)";
            try (PreparedStatement ps = conn().prepareStatement(insert)) {
                for (Map<String, Object> e : entries) {
                    ps.setString(1, lotId);
                    ps.setString(2, str(e, "memberId", "member_id"));
                    ps.setString(3, str(e, "entryJson", "entry_json"));
                    ps.setString(4, strOr(e, "generatedAt", strOr(e, "generated_at", nowIso())));
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            conn().commit();
        } catch (SQLException e) {
            try {
                conn().rollback();
            } catch (SQLException ignored) {
            }
            throw new IllegalStateException("replaceLookup failed", e);
        } finally {
            try {
                conn().setAutoCommit(true);
            } catch (SQLException ignored) {
            }
        }
    }

    // ---------- helpers ----------

    private static String nowIso() {
        return java.time.Instant.now().toString();
    }

    private static String str(Map<String, Object> m, String... keys) {
        Object v = first(m, keys);
        return v == null ? null : String.valueOf(v);
    }

    private static String strOr(Map<String, Object> m, String key, String def) {
        Object v = first(m, key);
        return v == null ? def : String.valueOf(v);
    }

    private static String strOr(Map<String, Object> m, String key, String alt, String def) {
        Object v = first(m, key, alt);
        return v == null ? def : String.valueOf(v);
    }

    private static Object first(Map<String, Object> m, String... keys) {
        if (m == null) {
            return null;
        }
        for (String k : keys) {
            if (m.containsKey(k) && m.get(k) != null) {
                return m.get(k);
            }
        }
        return null;
    }

    private static void setDouble(PreparedStatement ps, int idx, Map<String, Object> m, String... keys)
            throws SQLException {
        Object v = first(m, keys);
        if (v == null) {
            ps.setObject(idx, null);
        } else if (v instanceof Number n) {
            ps.setDouble(idx, n.doubleValue());
        } else {
            ps.setDouble(idx, Double.parseDouble(String.valueOf(v)));
        }
    }
}
