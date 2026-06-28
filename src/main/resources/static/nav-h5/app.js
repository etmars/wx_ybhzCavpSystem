/* eslint-disable */
/**
 * 宜泊慧智 C-AVP H5 导航地图
 * MapLibre GL JS 消费后端 mbtiles 矢量瓦片，对齐 Android addRenderLayers
 */

// 从 URL query 读取小程序传入的参数
function getQuery() {
  const q = {};
  new URLSearchParams(window.location.search).forEach((v, k) => { q[k] = v; });
  return q;
}

const Q = getQuery();
const TILES_BASE = Q.tiles_base || 'https://parkinglot.c-avp.com:9065/tiles';
const MAP_ID = Q.map_id || 'ziguang_1-B2';
const TILES_URL = `${TILES_BASE}/{z}/{x}/{y}.pbf?map_id=${MAP_ID}`;
const CENTER_LON = parseFloat(Q.center_lon) || 0;
const CENTER_LAT = parseFloat(Q.center_lat) || 0;
const MAP_BEARING = parseFloat(Q.map_bearing) || 0;
const GEO_API = Q.geo_api || `https://parkinglot.c-avp.com:9065/api/maps/${MAP_ID}/geometry`;

let routePoints = [];
try { routePoints = JSON.parse(Q.route_points || '[]'); } catch (e) {}
let destination = null;
try { destination = JSON.parse(Q.destination || 'null'); } catch (e) {}
const SPACE_ID = Q.space_id || '';
const SPOT_TITLE = Q.spot_title || (SPACE_ID ? `目标车位 ${SPACE_ID}` : '目标车位');
let TOTAL_LEN = parseFloat(Q.total_len) || 0;
let ETA_SECONDS = parseFloat(Q.eta_seconds) || 0;
const SESSION_ID = Q.session_id || 'default';
const PUCK_API = (Q.puck_api || TILES_BASE.replace('/tiles', '/api/puck'));

// 状态
let map = null;
let navigating = false;
let userPosition = null;
let progress = 0;
let remainMeters = 0;
let lastHeading = 0;
let arrivalTicks = 0;
const ARRIVE_THRESHOLD = 8;
const WALK_SPEED = 1.15;

// ===== 工具函数 =====
function distanceMeters(a, b) {
  const dLat = b.latitude - a.latitude;
  const dLon = b.longitude - a.longitude;
  return Math.sqrt(dLat * dLat + dLon * dLon) * 111320;
}

function formatRemain(m) {
  if (m == null || m < 0) return { value: '--', unit: '' };
  if (m >= 1000) return { value: (m / 1000).toFixed(1), unit: '公里' };
  return { value: String(Math.round(m)), unit: '米' };
}

function formatEtaDuration(s) {
  if (s == null || s < 0) return '';
  if (s < 60) return `约 ${Math.max(1, Math.round(s))} 秒`;
  return `约 ${Math.max(1, Math.round(s / 60))} 分钟`;
}

function formatEtaArrival(s) {
  if (s == null || s < 0) return '';
  const d = new Date(Date.now() + s * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `预计到达 ${hh}:${mm}`;
}

function bearingBetween(from, to) {
  const dLon = to.longitude - from.longitude;
  const dLat = to.latitude - from.latitude;
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
}

function getManeuver(delta) {
  if (delta < 30 || delta > 330) return { type: 'straight', text: '前方直行' };
  if (delta >= 30 && delta < 150) return { type: 'right', text: '前方右转' };
  if (delta >= 210 && delta < 330) return { type: 'left', text: '前方左转' };
  return { type: 'straight', text: '沿当前方向直行可接近目标车位' };
}

function projectOnSegment(p, a, b) {
  const ax = a.longitude, ay = a.latitude;
  const bx = b.longitude, by = b.latitude;
  const px = p.longitude, py = p.latitude;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-14) return { point: { latitude: ay, longitude: ax }, t: 0 };
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { point: { latitude: ay + t * dy, longitude: ax + t * dx }, t };
}

function snapToRoute(position, pts) {
  if (!pts || pts.length < 2) return { point: position, remainMeters: 0, progress: 0, segmentIndex: 0 };
  let bestDist = Infinity, bestPoint = position, bestIdx = 0, traveled = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const proj = projectOnSegment(position, pts[i], pts[i + 1]);
    const d = distanceMeters(position, proj.point);
    if (d < bestDist) {
      bestDist = d; bestPoint = proj.point; bestIdx = i;
      let acc = 0;
      for (let j = 0; j < i; j++) acc += distanceMeters(pts[j], pts[j + 1]);
      acc += distanceMeters(pts[i], proj.point);
      traveled = acc;
    }
  }
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += distanceMeters(pts[i], pts[i + 1]);
  const remain = Math.max(0, total - traveled);
  const prog = total > 0 ? Math.min(100, Math.round((traveled / total) * 100)) : 0;
  return { point: bestPoint, remainMeters: remain, progress: prog, segmentIndex: bestIdx };
}

// ===== MapLibre 初始化 =====
async function initMap() {
  // 用 geometry 接口获取真实中心点
  let center = [CENTER_LON, CENTER_LAT];
  try {
    const res = await fetch(GEO_API);
    const geo = await res.json();
    if (geo.centerLon && geo.centerLat) {
      center = [geo.centerLon, geo.centerLat];
    }
  } catch (e) {
    console.warn('geo api failed, fallback to query center', e);
  }

  // 加载 style JSON 并替换瓦片 URL 占位
  const styleRes = await fetch('./map-style.json');
  const style = await styleRes.json();
  style.sources['parking-source'].tiles = [TILES_URL];

  map = new maplibregl.Map({
    container: 'map',
    style,
    center,
    zoom: 18,
    maxZoom: 19,
    minZoom: 16,
    pitch: 42,
    bearing: MAP_BEARING,
    antialias: true,
    attributionControl: false,
  });

  map.on('load', () => {
    addRouteLayers();
    addUserPuckLayers();
    addDestinationMarker();
    fitToBounds();
  });

  // 暴露给外部定位更新
  window.__map = map;
}

function fitToBounds() {
  if (!map || routePoints.length < 2) return;
  const coords = routePoints.map(p => [p.longitude, p.latitude]);
  if (destination) coords.push([destination.longitude, destination.latitude]);
  if (coords.length >= 2) {
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: { top: 120, bottom: 240, left: 40, right: 40 }, pitch: 42, bearing: MAP_BEARING, maxZoom: 19, duration: 0 });
  }
}

// ===== 路线三层（casing / traveled / remaining）=====
function routeToFeature(points) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: points.map(p => [p.longitude, p.latitude]) }
  };
}

function addRouteLayers() {
  if (!map || routePoints.length < 2) return;
  map.addSource('nav-route', {
    type: 'geojson',
    data: routeToFeature(routePoints)
  });

  // casing 白底
  map.addLayer({
    id: 'nav-route-casing',
    type: 'line',
    source: 'nav-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#F7FBFF', 'line-width': 14, 'line-opacity': 0.98 }
  });
  // traveled 灰
  map.addLayer({
    id: 'nav-route-traveled',
    type: 'line',
    source: 'nav-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#3E5060',
      'line-width': 10,
      'line-opacity': 0.9,
      'line-dasharray': [0, 10]
    }
  });
  // remaining 蓝
  map.addLayer({
    id: 'nav-route-remaining',
    type: 'line',
    source: 'nav-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#3E86EC', 'line-width': 10, 'line-opacity': 0.95 }
  });
}

function updateRouteDash(p) {
  if (!map || !map.getLayer('nav-route-traveled')) return;
  const total = routePoints.reduce((acc, pt, i) => acc + (i > 0 ? distanceMeters(routePoints[i - 1], pt) : 0), 0);
  if (total <= 0) return;
  const traveledLen = (p / 100) * total;
  // 用 dasharray 近似：[已走, 未走]，单位是 line-width 倍数
  const scale = total / 10;
  map.setPaintProperty('nav-route-traveled', 'line-dasharray', [traveledLen / scale, (total - traveledLen) / scale + 0.001]);
}

// ===== 用户定位点（光晕 + 核心圆 + 白环）=====
function addUserPuckLayers() {
  if (!map) return;
  map.addSource('nav-puck', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }
  });

  // 光晕
  map.addLayer({
    id: 'puck-halo',
    type: 'circle',
    source: 'nav-puck',
    paint: { 'circle-radius': 22, 'circle-color': '#3E86EC', 'circle-opacity': 0.2, 'circle-pitch-alignment': 'map' }
  });
  // 白环
  map.addLayer({
    id: 'puck-ring',
    type: 'circle',
    source: 'nav-puck',
    paint: { 'circle-radius': 10, 'circle-color': '#ffffff', 'circle-stroke-width': 0, 'circle-pitch-alignment': 'map' }
  });
  // 核心蓝
  map.addLayer({
    id: 'puck-core',
    type: 'circle',
    source: 'nav-puck',
    paint: { 'circle-radius': 7, 'circle-color': '#3E86EC', 'circle-stroke-width': 0, 'circle-pitch-alignment': 'map' }
  });
}

function updateUserPuck(pos) {
  if (!map || !pos || !map.getSource('nav-puck')) return;
  map.getSource('nav-puck').setData({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [pos.longitude, pos.latitude] },
    properties: {}
  });
}

// ===== 终点 P 牌 =====
let destMarker = null;
function addDestinationMarker() {
  if (!map || !destination) return;
  const el = document.createElement('div');
  el.style.cssText = 'width:40px;height:48px;background:url(./icons/pin-p.svg) no-repeat center/contain;';
  destMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([destination.longitude, destination.latitude])
    .addTo(map);
}

// ===== UI 更新 =====
function updateUI() {
  const r = formatRemain(remainMeters);
  document.getElementById('spotTitle').textContent = SPOT_TITLE;
  document.getElementById('remainValue').textContent = r.value;
  document.getElementById('remainUnit').textContent = r.unit;
  document.getElementById('etaHint').textContent = formatEtaDuration(ETA_SECONDS);
  document.getElementById('progressBar').style.width = progress + '%';
  document.getElementById('etaArrival').textContent = formatEtaArrival(ETA_SECONDS);
}

function updateManeuver(snap) {
  if (!routePoints || routePoints.length < 2) return;
  if (snap.segmentIndex < routePoints.length - 1) {
    const from = routePoints[snap.segmentIndex];
    const to = routePoints[snap.segmentIndex + 1];
    const routeBearing = bearingBetween(from, to);
    let delta = Math.abs(routeBearing - lastHeading);
    const m = getManeuver(delta > 180 ? 360 - delta : delta);
    document.getElementById('maneuverImg').src = `./icons/turn-${m.type}.svg`;
    document.getElementById('maneuverText').textContent = m.text;
    lastHeading = routeBearing;
  }
}

function showArrival() {
  document.getElementById('arrivalText').textContent = `已抵达 ${SPACE_ID || '目标车位'}`;
  document.getElementById('arrivalMask').classList.add('visible');
  navigating = false;
  setNavButton();
}

function setNavButton() {
  const btn = document.getElementById('btnNav');
  if (navigating) {
    btn.textContent = '结束导航';
    btn.classList.add('btn-stop');
  } else {
    btn.textContent = '开始导航';
    btn.classList.remove('btn-stop');
  }
}

// ===== 与小程序通信（后端 puck 中转轮询）=====
function startStoragePolling() {
  setInterval(pollLatestPosition, 500);
}

async function pollLatestPosition() {
  if (!navigating) return;
  const url = `${PUCK_API}/latest?mapId=${MAP_ID}&sessionId=${encodeURIComponent(SESSION_ID)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok && data.latitude != null) {
      onPositionUpdate({ latitude: data.latitude, longitude: data.longitude });
    }
  } catch (e) { /* ignore */ }
}

function onPositionUpdate(pos) {
  userPosition = pos;
  updateUserPuck(pos);

  if (!navigating || routePoints.length < 2) {
    return;
  }

  const snap = snapToRoute(pos, routePoints);
  remainMeters = snap.remainMeters;
  progress = snap.progress;
  ETA_SECONDS = Math.max(0, remainMeters / WALK_SPEED);

  updateRouteDash(progress);
  updateManeuver(snap);
  updateUI();

  if (destination && remainMeters <= ARRIVE_THRESHOLD && progress >= 90) {
    arrivalTicks += 1;
    if (arrivalTicks >= 3) {
      showArrival();
    }
  } else {
    arrivalTicks = 0;
  }
}

// 暴露给小程序通过 wx.miniProgram.postMessage 或 URL 通信使用
window.__onPositionUpdate = onPositionUpdate;
window.__startNavigation = () => { navigating = true; arrivalTicks = 0; setNavButton(); };
window.__stopNavigation = () => { navigating = false; setNavButton(); };

// ===== 事件绑定 =====
function bindEvents() {
  document.getElementById('btnBack').addEventListener('click', () => {
    if (window.wx && wx.miniProgram) {
      wx.miniProgram.navigateBack({ delta: 1 });
    } else {
      history.back();
    }
  });

  document.getElementById('btnNav').addEventListener('click', () => {
    if (navigating) {
      navigating = false;
      // 通知小程序停止定位
      postToMiniProgram({ type: 'stopNav' });
    } else {
      navigating = true;
      arrivalTicks = 0;
      postToMiniProgram({ type: 'startNav' });
    }
    setNavButton();
  });

  document.getElementById('btnRecenter').addEventListener('click', () => {
    fitToBounds();
  });

  document.getElementById('btnArrivalDone').addEventListener('click', () => {
    document.getElementById('arrivalMask').classList.remove('visible');
    postToMiniProgram({ type: 'arrivalDone' });
  });
}

function postToMiniProgram(msg) {
  // web-view 内通过 wx.miniProgram.postMessage 仅在特定时机触发，
  // 这里作为回传通道占位，实际小程序端通过拦截 web-view 的 message 事件接收
  if (window.wx && wx.miniProgram && wx.miniProgram.postMessage) {
    wx.miniProgram.postMessage({ data: msg });
  }
}

// ===== 启动 =====
window.addEventListener('load', async () => {
  updateUI();
  setNavButton();
  bindEvents();
  await initMap();
  startStoragePolling();
});
