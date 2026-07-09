/* eslint-disable */
/**
 * 宜泊慧智 C-AVP H5 导航地图 — MapLibre GL JS，对齐 Android MainActivity
 */

function getQuery() {
  const q = {};
  new URLSearchParams(window.location.search).forEach((v, k) => { q[k] = v; });
  return q;
}

const Q = getQuery();
const TILES_BASE = Q.tiles_base || 'https://parkinglot.c-avp.com:9065/tiles';
const MAP_ID = Q.map_id || 'gqyq';
const TILES_USE_MAP_ID = Q.tiles_use_map_id !== '0';
const TILES_URL = TILES_USE_MAP_ID
  ? `${TILES_BASE}/{z}/{x}/{y}.pbf?map_id=${MAP_ID}`
  : `${TILES_BASE}/{z}/{x}/{y}.pbf`;
const MAP_BEARING = parseFloat(Q.map_bearing) || 0;
const GEO_API = Q.geo_api || `https://parkinglot.c-avp.com:9065/api/maps/${MAP_ID}/geometry`;
const ROUTE_API = Q.route_api || 'https://parkinglot.c-avp.com:9065/api/nav/route';
const GROUTE_API = Q.groute_api || 'https://parkinglot.c-avp.com:9065/api/avp/groute-live';
const GROUTE_FALLBACK_API = Q.groute_fallback_api || '';
const VEHICLE_ID = Q.vehicle_id || 'I1000110';
const PUCK_API = Q.puck_api || 'https://parkinglot.c-avp.com:9065/api/puck';
const NAV_FLOW = Q.nav_flow || 'PARKING_ENTRY';
const AUTO_START = Q.auto_start === '1';

const SPACE_ID = Q.space_id || '';
let SPOT_TITLE = Q.spot_title || (
  NAV_FLOW === 'PICKUP_EXIT' ? `目标出口 ${SPACE_ID}` : `目标车位 ${SPACE_ID}`
);
let TOTAL_LEN = parseFloat(Q.total_len) || 0;
let ETA_SECONDS = parseFloat(Q.est_total_time) || 0;
const SESSION_ID = Q.session_id || 'default';

let routePoints = [];
let destination = null;
let map = null;
let mapCenter = null;
let navigating = false;
let userPosition = null;
let progress = 0;
let remainMeters = 0;
let lastHeading = 0;
let arrivalTicks = 0;
const ARRIVE_THRESHOLD = 8;
const WALK_SPEED = 1.15;

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
  return `预计到达 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
  return { type: 'straight', text: '沿当前方向直行可接近目标' };
}

function projectOnSegment(p, a, b) {
  const ax = a.longitude; const ay = a.latitude;
  const bx = b.longitude; const by = b.latitude;
  const px = p.longitude; const py = p.latitude;
  const dx = bx - ax; const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-14) return { point: { latitude: ay, longitude: ax }, t: 0 };
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { point: { latitude: ay + t * dy, longitude: ax + t * dx }, t };
}

function snapToRoute(position, pts) {
  if (!pts || pts.length < 2) return { point: position, remainMeters: 0, progress: 0, segmentIndex: 0 };
  let bestDist = Infinity; let bestPoint = position; let bestIdx = 0; let traveled = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const proj = projectOnSegment(position, pts[i], pts[i + 1]);
    const d = distanceMeters(position, proj.point);
    if (d < bestDist) {
      bestDist = d; bestPoint = proj.point; bestIdx = i;
      let acc = 0;
      for (let j = 0; j < i; j += 1) acc += distanceMeters(pts[j], pts[j + 1]);
      acc += distanceMeters(pts[i], proj.point);
      traveled = acc;
    }
  }
  let total = 0;
  for (let i = 0; i < pts.length - 1; i += 1) total += distanceMeters(pts[i], pts[i + 1]);
  const remain = Math.max(0, total - traveled);
  const prog = total > 0 ? Math.min(100, Math.round((traveled / total) * 100)) : 0;
  return { point: bestPoint, remainMeters: remain, progress: prog, segmentIndex: bestIdx };
}

function getRouteJsonRaw() {
  if (Q.points_pos_json) return Q.points_pos_json;
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    return new URLSearchParams(hash).get('route');
  } catch (e) {
    return null;
  }
}

function routeMatchesMapCenter(points) {
  if (!mapCenter || !points || !points.length) return true;
  const [cx, cy] = mapCenter;
  const p = points[0];
  return Math.abs(p.latitude - cy) <= 0.05 && Math.abs(p.longitude - cx) <= 0.05;
}

function applyRoutePoints(arr) {
  if (!Array.isArray(arr) || !arr.length) return false;
  const points = arr.map((p) => ({
    latitude: p.latitude != null ? p.latitude : p.lat,
    longitude: p.longitude != null ? p.longitude : p.lon,
  }));
  if (!routeMatchesMapCenter(points)) {
    console.warn('route rejected: coordinates mismatch map area', points[0], mapCenter);
    return false;
  }
  routePoints = points;
  destination = routePoints[routePoints.length - 1];
  if (!TOTAL_LEN && routePoints.length >= 2) {
    TOTAL_LEN = routePoints.reduce((acc, pt, i) => acc + (i > 0 ? distanceMeters(routePoints[i - 1], pt) : 0), 0);
  }
  if (!ETA_SECONDS && TOTAL_LEN) ETA_SECONDS = TOTAL_LEN / WALK_SPEED;
  remainMeters = TOTAL_LEN;
  return routePoints.length >= 2;
}

function applyGrouteRoot(root) {
  const info = (root && root.infoData) || {};
  const pathList = info.pathList || [];
  const pointsPos = (pathList[0] && pathList[0].pointsPos) || [];
  if (!Array.isArray(pointsPos) || !pointsPos.length) return false;
  if (info.spaceId) {
    SPOT_TITLE = NAV_FLOW === 'PICKUP_EXIT'
      ? `目标出口 ${info.spaceId}`
      : `目标车位 ${info.spaceId}`;
  }
  if (info.totalLen != null && !TOTAL_LEN) TOTAL_LEN = info.totalLen;
  if (info.estTotalTime != null && !ETA_SECONDS) ETA_SECONDS = info.estTotalTime;
  remainMeters = TOTAL_LEN;
  return applyRoutePoints(pointsPos);
}

async function fetchGrouteFrom(url) {
  const res = await fetch(`${url}?vehicleId=${encodeURIComponent(VEHICLE_ID)}`);
  if (!res.ok) return false;
  const root = await res.json();
  return applyGrouteRoot(root);
}

async function loadRouteFromGroute() {
  const urls = [GROUTE_API, GROUTE_FALLBACK_API].filter(Boolean);
  for (let i = 0; i < urls.length; i += 1) {
    try {
      if (await fetchGrouteFrom(urls[i])) return true;
    } catch (e) {
      console.warn('groute failed', urls[i], e);
    }
  }
  return false;
}

function parseRouteFromQuery() {
  const raw = getRouteJsonRaw();
  if (!raw) return false;
  try {
    return applyRoutePoints(JSON.parse(raw));
  } catch (e) {
    console.warn('parseRouteFromQuery failed', e);
    return false;
  }
}

async function loadRouteFromSession() {
  if (!ROUTE_API || !SESSION_ID) return false;
  try {
    const res = await fetch(`${ROUTE_API}?sessionId=${encodeURIComponent(SESSION_ID)}`);
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.ok || !data.pointsPos) return false;
    if (data.totalLen != null && !TOTAL_LEN) TOTAL_LEN = data.totalLen;
    if (data.estTotalTime != null && !ETA_SECONDS) ETA_SECONDS = data.estTotalTime;
    remainMeters = TOTAL_LEN;
    return applyRoutePoints(data.pointsPos);
  } catch (e) {
    console.warn('session route failed', e);
    return false;
  }
}

async function resolveRoute() {
  if (await loadRouteFromSession()) return true;
  if (parseRouteFromQuery()) return true;
  return loadRouteFromGroute();
}

async function initMap() {
  let center = [116.4914516, 39.7300906];
  try {
    const res = await fetch(GEO_API);
    const geo = await res.json();
    if (geo.centerLon != null && geo.centerLat != null) center = [geo.centerLon, geo.centerLat];
  } catch (e) {
    console.warn('geo api failed', e);
  }
  mapCenter = center;

  const styleRes = await fetch('./map-style.json');
  const style = await styleRes.json();
  style.sources['parking-source'].tiles = [TILES_URL];
  MapLayers.addExtraStyleLayers(style);

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

  map.on('load', async () => {
    MapLayersUtil.registerPoiIcons(map);
    MapLayersUtil.registerNavArrowIcon(map);
    MapLayers.ensureUserPuckLayers(map);

    const hasRoute = await resolveRoute();

    if (hasRoute) {
      MapLayers.ensureNavRouteLayers(map, routePoints);
      const arrows = MapLayers.buildDirectionArrows(routePoints);
      if (map.getSource('nav-direction-arrows')) {
        map.getSource('nav-direction-arrows').setData({ type: 'FeatureCollection', features: arrows });
      }
      if (NAV_FLOW === 'PARKING_ENTRY' && SPACE_ID) {
        MapLayers.highlightTargetSpace(map, SPACE_ID);
      }
      fitToBounds();
    } else {
      map.flyTo({ center: mapCenter, zoom: 18, pitch: 42, bearing: MAP_BEARING, duration: 0 });
      document.getElementById('maneuverText').textContent = '路线加载失败，请返回重试';
    }
    updateUI();
    postToMiniProgram({ type: 'h5Ready', routeOk: hasRoute });
    if (AUTO_START && hasRoute) startNavigation();
  });

  window.__map = map;
}

function fitToBounds() {
  if (!map || routePoints.length < 2) return;
  const coords = routePoints.map((p) => [p.longitude, p.latitude]);
  if (mapCenter) {
    const [cx, cy] = mapCenter;
    const far = coords.some(([x, y]) => Math.abs(x - cx) > 0.02 || Math.abs(y - cy) > 0.02);
    if (far) {
      console.warn('route out of map area, keep map center');
      map.flyTo({ center: mapCenter, zoom: 18, pitch: 42, bearing: MAP_BEARING, duration: 0 });
      return;
    }
  }
  const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(bounds, { padding: { top: 120, bottom: 240, left: 40, right: 40 }, pitch: 42, bearing: MAP_BEARING, maxZoom: 19, duration: 0 });
}

function updateUserPuck(pos, bearing) {
  if (!map || !pos || !map.getSource('user-loc-source')) return;
  map.getSource('user-loc-source').setData({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [pos.longitude, pos.latitude] },
    properties: { bearing: bearing || lastHeading },
  });
}

function updateUI() {
  const r = formatRemain(remainMeters);
  document.getElementById('spotTitle').textContent = SPOT_TITLE;
  document.getElementById('remainValue').textContent = r.value;
  document.getElementById('remainUnit').textContent = r.unit;
  document.getElementById('etaHint').textContent = formatEtaDuration(ETA_SECONDS);
  document.getElementById('progressBar').style.width = `${progress}%`;
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
  document.getElementById('arrivalText').textContent = `已抵达 ${SPACE_ID || '目标'}`;
  document.getElementById('arrivalMask').classList.add('visible');
  navigating = false;
  setNavButton();
}

function setNavButton() {
  const btn = document.getElementById('btnNav');
  btn.textContent = navigating ? '结束导航' : '开始导航';
  btn.classList.toggle('btn-stop', navigating);
}

function startNavigation() {
  navigating = true;
  arrivalTicks = 0;
  setNavButton();
  postToMiniProgram({ type: 'startNav' });
}

function stopNavigation() {
  navigating = false;
  setNavButton();
  postToMiniProgram({ type: 'stopNav' });
}

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
  if (!navigating || routePoints.length < 2) {
    updateUserPuck(pos, lastHeading);
    return;
  }
  const snap = snapToRoute(pos, routePoints);
  remainMeters = snap.remainMeters;
  progress = snap.progress;
  ETA_SECONDS = Math.max(0, remainMeters / WALK_SPEED);
  MapLayers.updateRouteProgress(map, routePoints, progress);
  updateUserPuck(snap.point, lastHeading);
  updateManeuver(snap);
  updateUI();
  if (destination && remainMeters <= ARRIVE_THRESHOLD && progress >= 90) {
    arrivalTicks += 1;
    if (arrivalTicks >= 3) showArrival();
  } else {
    arrivalTicks = 0;
  }
}

window.__onPositionUpdate = onPositionUpdate;
window.__startNavigation = startNavigation;
window.__stopNavigation = stopNavigation;

function bindEvents() {
  document.getElementById('btnBack').addEventListener('click', () => {
    if (window.wx && wx.miniProgram) wx.miniProgram.navigateBack({ delta: 1 });
    else history.back();
  });
  document.getElementById('btnNav').addEventListener('click', () => {
    if (navigating) stopNavigation();
    else startNavigation();
  });
  document.getElementById('btnRecenter').addEventListener('click', fitToBounds);
  document.getElementById('btnArrivalDone').addEventListener('click', () => {
    document.getElementById('arrivalMask').classList.remove('visible');
    postToMiniProgram({ type: 'arrivalDone' });
  });
}

function postToMiniProgram(msg) {
  if (window.wx && wx.miniProgram && wx.miniProgram.postMessage) {
    wx.miniProgram.postMessage({ data: msg });
  }
}

window.addEventListener('load', async () => {
  updateUI();
  setNavButton();
  bindEvents();
  await initMap();
  startStoragePolling();
});
