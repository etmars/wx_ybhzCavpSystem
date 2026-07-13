-- 停车场配置库 schema（SQLite）

CREATE TABLE IF NOT EXISTS parking_lot (
    lot_id      TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    anchor_lat  REAL,
    anchor_lon  REAL,
    map_bearing REAL DEFAULT 0,
    scale       REAL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parking_lot_map (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id     TEXT NOT NULL,
    map_id     TEXT NOT NULL,
    floor      TEXT,
    map_type   TEXT NOT NULL CHECK (map_type IN ('osm', 'od')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (lot_id) REFERENCES parking_lot(lot_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS parking_lot_dispatch (
    lot_id          TEXT PRIMARY KEY,
    provider        TEXT NOT NULL CHECK (provider IN ('internal', 'tsinghua')),
    provider_params TEXT,
    FOREIGN KEY (lot_id) REFERENCES parking_lot(lot_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS parking_lot_device (
    lot_id      TEXT PRIMARY KEY,
    access_mode TEXT NOT NULL CHECK (access_mode IN ('http', 'mqtt')),
    endpoint    TEXT,
    vendor      TEXT,
    FOREIGN KEY (lot_id) REFERENCES parking_lot(lot_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS parking_lot_destination (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id     TEXT NOT NULL,
    dest_type  TEXT NOT NULL,
    url        TEXT,
    enabled    INTEGER NOT NULL DEFAULT 1,
    params_json TEXT,
    FOREIGN KEY (lot_id) REFERENCES parking_lot(lot_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS parking_zone (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id           TEXT NOT NULL,
    name             TEXT NOT NULL,
    color            TEXT,
    bounds_json      TEXT,
    priority         INTEGER NOT NULL DEFAULT 0,
    spot_names_json  TEXT,
    FOREIGN KEY (lot_id) REFERENCES parking_lot(lot_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS member_config (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id             TEXT NOT NULL,
    name               TEXT NOT NULL,
    color              TEXT,
    allowed_zones_json TEXT,
    max_spots          INTEGER,
    FOREIGN KEY (lot_id) REFERENCES parking_lot(lot_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS parking_lookup (
    lot_id       TEXT NOT NULL,
    member_id    TEXT NOT NULL,
    entry_json   TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    PRIMARY KEY (lot_id, member_id),
    FOREIGN KEY (lot_id) REFERENCES parking_lot(lot_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_parking_lot_map_lot ON parking_lot_map(lot_id);
CREATE INDEX IF NOT EXISTS idx_parking_lot_destination_lot ON parking_lot_destination(lot_id);
CREATE INDEX IF NOT EXISTS idx_parking_zone_lot ON parking_zone(lot_id);
CREATE INDEX IF NOT EXISTS idx_member_config_lot ON member_config(lot_id);
