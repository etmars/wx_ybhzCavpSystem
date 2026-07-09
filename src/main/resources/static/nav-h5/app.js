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
const SEED_TEST_ROUTE = Q.seed_test_route === '1';

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


function parseRoutePoint(p) {
  if (Array.isArray(p) && p.length >= 2) {
    const longitude = Number(p[0]);
    const latitude = Number(p[1]);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      return { longitude, latitude };
    }
    return null;
  }
  const latitude = Number(p.latitude != null ? p.latitude : p.lat);
  const longitude = Number(p.longitude != null ? p.longitude : (p.lon != null ? p.lon : p.lng));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function applyRoutePoints(arr) {
  if (!Array.isArray(arr) || !arr.length) return false;
  const points = arr.map(parseRoutePoint).filter(Boolean);
  if (points.length < 2) return false;
  routePoints = points;
  destination = routePoints[routePoints.length - 1];
  if (!TOTAL_LEN && routePoints.length >= 2) {
    TOTAL_LEN = routePoints.reduce((acc, pt, i) => acc + (i > 0 ? distanceMeters(routePoints[i - 1], pt) : 0), 0);
  }
  if (!ETA_SECONDS && TOTAL_LEN) ETA_SECONDS = TOTAL_LEN / WALK_SPEED;
  remainMeters = TOTAL_LEN;
  return true;
}

async function seedTestRouteIfNeeded() {
  if (!SEED_TEST_ROUTE || !ROUTE_API) return;
  const body = {
    sessionId: SESSION_ID,
    mapId: MAP_ID,
    spaceId: SPACE_ID || 'B121',
    totalLen: 213.72,
    estTotalTime: 53.4,
    pointsPos: [
      { longitude: 116.4917772, latitude: 39.7295389 },
      { longitude: 116.4917853, latitude: 39.7295424 },
      { longitude: 116.4914705, latitude: 39.7305063 },
    ],
  };
  const res = await fetch(ROUTE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (window.NavDebug) NavDebug.log('seed_test_route POST', { status: res.status, ok: res.ok });
}

async function loadRouteFromSession() {
  if (!ROUTE_API || !SESSION_ID) return false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const url = `${ROUTE_API}?sessionId=${encodeURIComponent(SESSION_ID)}`;
      if (window.NavDebug) NavDebug.log(`route GET attempt ${attempt + 1}`, url);
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (window.NavDebug) NavDebug.log('route GET http fail', { status: res.status, data });
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      if (!data.ok || !data.pointsPos) {
        if (window.NavDebug) NavDebug.log('route GET no data', data);
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      if (window.NavDebug) NavDebug.log('route GET ok', { points: data.pointsPos.length, totalLen: data.totalLen });
      if (data.totalLen != null && !TOTAL_LEN) TOTAL_LEN = data.totalLen;
      if (data.estTotalTime != null && !ETA_SECONDS) ETA_SECONDS = data.estTotalTime;
      remainMeters = TOTAL_LEN;
      const applied = applyRoutePoints(data.pointsPos);
      if (window.NavDebug) NavDebug.log('applyRoutePoints', { applied, parsed: routePoints.length });
      if (applied) return true;
    } catch (e) {
      if (window.NavDebug) NavDebug.logError('loadRouteFromSession', e);
      else console.warn('session route failed', e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function resolveRoute() {
  await seedTestRouteIfNeeded();
  return loadRouteFromSession();
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
    try {
      if (window.NavDebug) NavDebug.log('map load', { SESSION_ID, ROUTE_API, MAP_ID });
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
        if (window.NavDebug) NavDebug.reportRouteState(map, routePoints, { hasRoute: true });
        map.resize();
        fitToBounds();
        map.once('idle', () => {
          map.resize();
          fitToBounds();
          if (window.NavDebug) NavDebug.reportRouteState(map, routePoints, { afterIdle: true });
        });
      } else {
        if (window.NavDebug) NavDebug.log('route missing', { SESSION_ID, total_len: TOTAL_LEN });
        map.flyTo({ center: mapCenter, zoom: 18, pitch: 42, bearing: MAP_BEARING, duration: 0 });
        document.getElementById('maneuverText').textContent = '路线加载失败，请返回重试';
      }
      updateUI();
      postToMiniProgram({ type: 'h5Ready', routeOk: hasRoute });
      if (AUTO_START && hasRoute) startNavigation();
    } catch (e) {
      if (window.NavDebug) NavDebug.logError('map.on(load)', e);
      else console.error(e);
      document.getElementById('maneuverText').textContent = `地图初始化错误: ${e.message || e}`;
    }
  });

  map.on('error', (e) => {
    if (window.NavDebug) NavDebug.logError('map error', e.error || e);
  });

  window.__map = map;
}

function fitToBounds() {
  if (!map || routePoints.length < 2) return;
  const coords = routePoints.map((p) => [p.longitude, p.latitude]);
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
