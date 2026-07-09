import sqlite3

import requests
import urllib3

urllib3.disable_warnings()

MBTILES = r"F:\wx_ybhzCavpSystem\data\maps\gqyq\parking.mbtiles"
LOCAL = "http://127.0.0.1:12380"
PROD = "https://parkinglot.c-avp.com:9065"


def db_tile(z, x, y):
    tms_y = (1 << z) - 1 - y
    conn = sqlite3.connect(MBTILES)
    row = conn.execute(
        "SELECT length(tile_data) FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
        (z, x, tms_y),
    ).fetchone()
    conn.close()
    return row[0] if row else None


def check_tile(name, url, z=None, x=None, y=None, expect_ok=True):
    r = requests.get(url, timeout=15, verify=False)
    raw = requests.get(url, timeout=15, verify=False, headers={"Accept-Encoding": "identity"})
    ct = r.headers.get("Content-Type", "")
    ok = (r.status_code == 200) == expect_ok
    if expect_ok and r.status_code == 200:
        ok = ok and "protobuf" in ct
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    print(f"  {url}")
    print(f"  status={r.status_code} gzip_len={len(raw.content)} ct={ct}")
    if z is not None:
        db_len = db_tile(z, x, y)
        print(f"  mbtiles db gzip_len={db_len} match={db_len == len(raw.content) if db_len else False}")
    elif r.status_code == 404:
        print(f"  body={r.text.strip()}")
    print()
    return ok


print("=== Local :12380 ===")
local_pass = 0
local_pass += check_tile(
    "gqyq z18",
    f"{LOCAL}/tiles/18/215897/99499.pbf?map_id=gqyq",
    18,
    215897,
    99499,
)
local_pass += check_tile(
    "gqyq z16",
    f"{LOCAL}/tiles/16/53974/24874.pbf?map_id=gqyq",
    16,
    53974,
    24874,
)
local_pass += check_tile(
    "missing tile -> 404",
    f"{LOCAL}/tiles/18/0/0.pbf?map_id=gqyq",
    expect_ok=False,
)
r404 = requests.get(f"{LOCAL}/tiles/18/0/0.pbf?map_id=gqyq", timeout=10)
if r404.status_code == 404:
    local_pass += 1
    print("[PASS] missing tile returns 404\n")
else:
    print("[FAIL] missing tile should 404\n")

r = requests.get(f"{LOCAL}/api/maps/index", timeout=10)
print(f"[{'PASS' if r.status_code == 200 else 'FAIL'}] /api/maps/index -> {r.status_code}")
print(f"  {r.text[:200]}\n")
if r.status_code == 200:
    local_pass += 1

print("=== Prod :9065 ===")
for name, path in [
    ("tiles gqyq z18", f"{PROD}/tiles/18/215897/99499.pbf?map_id=gqyq"),
    ("/api/maps/index", f"{PROD}/api/maps/index"),
    ("nav-h5", f"{PROD}/nav-h5/index.html"),
]:
    try:
        resp = requests.get(path, timeout=15, verify=False)
        tag = "PASS" if resp.status_code == 200 else "FAIL"
        print(f"[{tag}] {name} -> {resp.status_code} len={len(resp.content)}")
    except Exception as e:
        print(f"[ERR] {name} -> {e}")
print()

print("=== Old :16161 (should fail) ===")
try:
    old = requests.get(
        "http://parkinglot.c-avp.com:16161/tiles/18/215897/99499.pbf?map_id=gqyq",
        timeout=10,
    )
    print(f"16161 -> {old.status_code}")
except Exception as e:
    print(f"16161 -> {e}")

print(f"\nLocal passed checks: {local_pass}/4")
