import requests, urllib3
urllib3.disable_warnings()
# mbtiles 里实际瓦片 z=18: x=131170, tms_y=131065 -> y=(1<<18)-1-131065=131078
cases = [
    (18, 131170, 131065),   # 原始 tms_y，先验证服务器用的 TMS 还是 XYZ
    (18, 131170, 131078),   # 转成 XYZ
    (16, 32792, 32766),
]
for z, x, y in cases:
    url = f'https://parkinglot.c-avp.com:9065/tiles/{z}/{x}/{y}.pbf?map_id=ziguang_1-B2'
    try:
        r = requests.get(url, verify=False, timeout=10)
        print(f'z={z} x={x} y={y} -> {r.status_code} len={len(r.content)} ct={r.headers.get("Content-Type")}')
    except Exception as e:
        print(f'z={z} x={x} y={y} err {e}')
