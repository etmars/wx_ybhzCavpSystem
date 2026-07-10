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
const T = window.NavTuning;
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
const API_BASE = Q.api_base || window.location.origin;
const VEHICLE_ID = Q.vehicle_id || 'I1000110';
const NAV_FLOW = Q.nav_flow || 'PARKING_ENTRY';
const AUTO_START = Q.auto_start === '1';

const SPACE_ID = Q.space_id || '';
let SPOT_TITLE = Q.spot_title || (
  NAV_FLOW === 'PICKUP_EXIT' ? `目标出口 ${SPACE_ID}` : `目标车位 ${SPACE_ID}`
);
let TOTAL_LEN = parseFloat(Q.total_len) || 0;
let remainMeters = 0;
let progress = 0;
let ETA_SECONDS = parseFloat(Q.est_total_time) || 0;
let SERVER_TOTAL_LEN = TOTAL_LEN;
let SERVER_ETA_SECONDS = ETA_SECONDS;
const SESSION_ID = Q.session_id || 'default';
const SEED_TEST_ROUTE = Q.seed_test_route === '1';

let routePoints = [];
let destination = null;
let map = null;
let mapCenter = null;
let navigating = false;
let navEngine = null;
let avpReporter = null;
let speedBumpTracker = null;
let renderTimer = null;
let lastCameraTarget = null;
let lastCameraBearing = null;

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

function getManeuver(delta) {
  if (delta < 30 || delta > 330) return { type: 'straight', text: '前方直行' };
  if (delta >= 30 && delta < 150) return { type: 'right', text: '前方右转' };
  if (delta >= 210 && delta < 330) return { type: 'left', text: '前方左转' };
  return { type: 'straight', text: '沿当前方向直行可接近目标' };
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
    TOTAL_LEN = window.NavGeo.buildRouteMetrics(routePoints).total;
  }
  if (!ETA_SECONDS && TOTAL_LEN) ETA_SECONDS = TOTAL_LEN / T.WALK_SPEED_MPS;
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
      if (!res.ok || !data.ok || !data.pointsPos) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      if (data.totalLen != null && !TOTAL_LEN) TOTAL_LEN = data.totalLen;
      if (data.estTotalTime != null && !ETA_SECONDS) ETA_SECONDS = data.estTotalTime;
      if (data.totalLen != null) SERVER_TOTAL_LEN = data.totalLen;
      if (data.estTotalTime != null) SERVER_ETA_SECONDS = data.estTotalTime;
  if (data.totalLen != null) SERVER_TOTAL_LEN = data.totalLen;
  if (data.estTotalTime != null) SERVER_ETA_SECONDS = data.estTotalTime;
      const applied = applyRoutePoints(data.pointsPos);
      if (applied) return true;
    } catch (e) {
      if (window.NavDebug) NavDebug.logError('loadRouteFromSession', e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function resolveRoute() {
  await seedTestRouteIfNeeded();
  return loadRouteFromSession();
}

function applyNavCameraPadding() {
  if (!map) return;
  map.setPadding({ top: 0, bottom: T.NAV_PADDING_BOTTOM, left: 0, right: 0 });
}

function clearNavCameraPadding() {
  if (!map) return;
  map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
}

function updateNavCamera(loc, cameraBearing, force) {
  if (!map || !loc || !navigating) return;
  const display = navEngine ? navEngine.getDisplayState() : null;
  if (display && display.navParked && !force) return;
  const br = (display && display.smoothCameraBearing != null)
    ? display.smoothCameraBearing
    : cameraBearing;
  const target = [loc.longitude, loc.latitude];
  let moveM = Infinity;
  if (lastCameraTarget) {
    moveM = window.NavGeo.distanceMeters(
      { latitude: lastCameraTarget[1], longitude: lastCameraTarget[0] },
      loc,
    );
  }
  let brDelta = 180;
  if (lastCameraBearing != null) {
    brDelta = window.NavGeo.headingDiffDeg(lastCameraBearing, br);
  }
  if (!force && moveM < T.NAV_CAMERA_MIN_MOVE_M && brDelta < T.NAV_CAMERA_MIN_BEARING_DELTA_DEG) {
    return;
  }
  lastCameraTarget = target;
  lastCameraBearing = br;
  map.easeTo({
    center: target,
    zoom: T.NAV_ZOOM,
    pitch: T.NAV_PITCH,
    bearing: br,
    duration: force ? 0 : T.NAV_CAMERA_EASE_MS,
  });
}

function focusPreviewCamera() {
  if (!map || routePoints.length < 1) return;
  const start = routePoints[0];
  map.jumpTo({
    center: [start.longitude, start.latitude],
    zoom: T.PREVIEW_ZOOM,
    pitch: T.NAV_PITCH,
    bearing: MAP_BEARING,
  });
}

function seedPuckAtRouteStart() {
  if (!map || !routePoints.length || !navEngine) return;
  const start = routePoints[0];
  const br = routePoints.length >= 2
    ? window.NavGeo.bearingDegrees(routePoints[0], routePoints[1])
    : 0;
  navEngine.seedAtRouteStart(br);
  MapLayers.ensureUserPuckLayers(map, [start.longitude, start.latitude], br);
}

function updateUserPuck(loc, bearing) {
  if (!map || !loc || !map.getSource('user-loc-source')) return;
  map.getSource('user-loc-source').setData({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [loc.longitude, loc.latitude] },
    properties: { bearing: bearing || 0 },
  });
}

function updateManeuverFromState(display) {
  if (!display) return;
  const nt = display.nextTurn;
  if (nt) {
    const type = nt.dir > 0 ? 'right' : (nt.dir < 0 ? 'left' : 'straight');
    document.getElementById('maneuverImg').src = `./icons/turn-${type}.svg`;
    document.getElementById('maneuverText').textContent = nt.text;
    const td = document.getElementById('turnDistance');
    if (td) {
      if (nt.dir !== 0 && nt.distanceMeters != null) {
        const r = formatRemain(nt.distanceMeters);
        td.textContent = `${r.value}${r.unit}`;
        td.style.display = '';
      } else {
        td.textContent = '';
        td.style.display = 'none';
      }
    }
    return;
  }
  if (!routePoints || routePoints.length < 2 || !display.location) return;
  const probe = display.progressMeters + T.NAV_TURN_LOOKAHEAD_M;
  const br1 = window.NavGeo.routeSegmentBearingAtDistance(routePoints, display.progressMeters);
  const br2 = window.NavGeo.routeSegmentBearingAtDistance(routePoints, probe);
  let delta = Math.abs(window.NavGeo.signedBearingDeltaDeg(br1, br2));
  const m = getManeuver(delta > 180 ? 360 - delta : delta);
  document.getElementById('maneuverImg').src = `./icons/turn-${m.type}.svg`;
  document.getElementById('maneuverText').textContent = m.text;
}

function applyDisplayState(display, forceCamera) {
  if (!display || !display.location) return;
  updateUserPuck(display.location, display.heading);
  MapLayers.updateRouteProgressByMeters(
    map,
    routePoints,
    display.progressMeters,
    navEngine.getState().metrics,
  );
  remainMeters = display.remainMetersServer != null ? display.remainMetersServer : display.remainMeters;
  progress = display.progressPct;
  if (navigating && display.etaSec != null && Number.isFinite(display.etaSec)) {
    ETA_SECONDS = display.etaSec;
  } else if (!navigating) {
    ETA_SECONDS = SERVER_ETA_SECONDS || Math.max(0, remainMeters / T.WALK_SPEED_MPS);
  }
  updateManeuverFromState(display);
  updateUI();
  if (navigating) {
    updateNavCamera(display.location, display.cameraBearing, forceCamera);
  }
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

function showArrival() {
  document.getElementById('arrivalText').textContent = `已抵达 ${SPACE_ID || '目标'}`;
  document.getElementById('arrivalMask').classList.add('visible');
  navigating = false;
  if (navEngine) {
    const display = navEngine.getDisplayState();
    if (avpReporter) avpReporter.sendTerminal(display);
    navEngine.freezeAfterArrival();
  }
  if (avpReporter) avpReporter.stop();
  stopRenderLoop();
  clearNavCameraPadding();
  setNavButton();
}

function setNavButton() {
  const btn = document.getElementById('btnNav');
  btn.textContent = navigating ? '结束导航' : '开始导航';
  btn.classList.toggle('btn-stop', navigating);
}

function startRenderLoop() {
  stopRenderLoop();
  renderTimer = setInterval(() => {
    if (!navEngine || !navigating) return;
    const result = navEngine.tick(Date.now());
    applyDisplayState(result, false);
    if (result.arrived) showArrival();
  }, T.NAV_DOT_INTERVAL_MS);
}

function stopRenderLoop() {
  if (renderTimer) {
    clearInterval(renderTimer);
    renderTimer = null;
  }
}

function startNavigation() {
  navigating = true;
  if (navEngine) {
    const br = routePoints.length >= 2
      ? window.NavGeo.bearingDegrees(routePoints[0], routePoints[1])
      : 0;
    navEngine.startNavigation(br);
  }
  if (!avpReporter && window.AvpLocationReporter) {
    avpReporter = window.AvpLocationReporter.create({
      vehicleId: VEHICLE_ID,
      apiBase: API_BASE,
    });
  }
  if (avpReporter) {
    avpReporter.start(() => (navEngine ? navEngine.getDisplayState() : null));
  }
  applyNavCameraPadding();
  setNavButton();
  startRenderLoop();
  const display = navEngine ? navEngine.getDisplayState() : null;
  if (display) applyDisplayState(display, true);
  postToMiniProgram({ type: 'startNav' });
}

function stopNavigation() {
  navigating = false;
  if (navEngine && avpReporter) {
    avpReporter.maybeSendTerminalOnStop(
      () => navEngine.getDisplayState(),
      navEngine.shouldSendTerminalOnStop(),
    );
  }
  if (navEngine) navEngine.stopNavigation();
  if (avpReporter) avpReporter.stop();
  stopRenderLoop();
  clearNavCameraPadding();
  setNavButton();
  postToMiniProgram({ type: 'stopNav' });
}

async function loadSpeedBumpsForRoute() {
  if (!window.NavSpeedBumps || !routePoints.length) return;
  try {
    speedBumpTracker = window.NavSpeedBumps.createSpeedBumpTracker();
    const bumps = await window.NavSpeedBumps.fetchSpeedBumps(API_BASE, MAP_ID);
    speedBumpTracker.setRoute(
      routePoints,
      window.NavGeo.buildRouteMetrics(routePoints),
      bumps,
      T.BUMP_GEO_GATE_M || 8,
    );
    if (navEngine) navEngine.attachSpeedBumpTracker(speedBumpTracker);
  } catch (e) {
    console.warn('speed bumps load failed', e);
  }
}

function recenterCamera() {
  if (!navEngine || !map) return;
  if (navigating) {
    lastCameraTarget = null;
    lastCameraBearing = null;
    const display = navEngine.getDisplayState();
    applyDisplayState(display, true);
    return;
  }
  if (routePoints.length >= 1) {
    const start = routePoints[0];
    map.easeTo({
      center: [start.longitude, start.latitude],
      zoom: Math.max(T.NAV_ZOOM - 0.5, 18.5),
      pitch: T.NAV_PITCH,
      bearing: MAP_BEARING,
      duration: 300,
    });
  }
}

async function initMap() {
  await window.NavTuning.fetchRemote(API_BASE, MAP_ID);

  let center = [116.4914516, 39.7300906];
  try {
    const res = await fetch(GEO_API);
    const geo = await res.json();
    if (geo.centerLon != null && geo.centerLat != null) center = [geo.centerLon, geo.centerLat];
  } catch (e) {
    console.warn('geo api failed', e);
  }
  mapCenter = center;

  navEngine = window.NavEngine.create({
    mapNorthBearingDeg: MAP_BEARING,
    navFlow: NAV_FLOW,
    mapId: MAP_ID,
  });

  const styleRes = await fetch('./map-style.json');
  const style = await styleRes.json();
  style.sources['parking-source'].tiles = [TILES_URL];
  MapLayers.addExtraStyleLayers(style);

  map = new maplibregl.Map({
    container: 'map',
    style,
    center,
    zoom: T.PREVIEW_ZOOM,
    maxZoom: 21,
    minZoom: 16,
    pitch: T.NAV_PITCH,
    bearing: MAP_BEARING,
    antialias: true,
    attributionControl: false,
  });

  map.on('load', async () => {
    try {
      MapLayersUtil.registerPoiIcons(map);
      MapLayersUtil.registerNavArrowIcon(map);
      MapLayersUtil.registerUserHeadingIcon(map);

      const hasRoute = await resolveRoute();

      if (hasRoute) {
        navEngine.setRoute(routePoints);
        navEngine.setServerMetrics(SERVER_TOTAL_LEN || TOTAL_LEN, SERVER_ETA_SECONDS || ETA_SECONDS);
        TOTAL_LEN = navEngine.getState().metrics.total || TOTAL_LEN;
        remainMeters = SERVER_TOTAL_LEN || TOTAL_LEN;
        await loadSpeedBumpsForRoute();
        MapLayers.ensureNavRouteLayers(map, routePoints);
        const arrows = MapLayers.buildDirectionArrows(routePoints);
        if (map.getSource('nav-direction-arrows')) {
          map.getSource('nav-direction-arrows').setData({ type: 'FeatureCollection', features: arrows });
        }
        if (NAV_FLOW === 'PARKING_ENTRY' && SPACE_ID) {
          MapLayers.highlightTargetSpace(map, SPACE_ID);
        }
        if (destination && SPACE_ID) {
          MapLayers.ensureDestPinLayer(map, destination, SPACE_ID);
        }
        seedPuckAtRouteStart();
        map.resize();
        focusPreviewCamera();
        map.once('idle', () => {
          map.resize();
          focusPreviewCamera();
          seedPuckAtRouteStart();
        });
        if (window.NavDebug) NavDebug.reportRouteState(map, routePoints, { hasRoute: true });
      } else {
        map.flyTo({ center: mapCenter, zoom: T.PREVIEW_ZOOM, pitch: T.NAV_PITCH, bearing: MAP_BEARING, duration: 0 });
        document.getElementById('maneuverText').textContent = '路线加载失败，请返回重试';
      }
      updateUI();
      postToMiniProgram({ type: 'h5Ready', routeOk: hasRoute });
      if (AUTO_START && hasRoute) startNavigation();
    } catch (e) {
      if (window.NavDebug) NavDebug.logError('map.on(load)', e);
      document.getElementById('maneuverText').textContent = `地图初始化错误: ${e.message || e}`;
    }
  });

  window.__map = map;
}

function onPositionUpdate(data) {
  if (!navEngine || !data || data.latitude == null) return;
  navEngine.onKnnMeasurement(
    { latitude: data.latitude, longitude: data.longitude },
    {
      bearing: data.bearing,
      imuSpeedMps: data.imuSpeedMps,
      confidence: data.confidence,
      beaconCount: data.beaconCount,
      angularSpeedRadS: data.angularSpeedRadS,
      parked: data.parked,
      bumpDetected: data.bumpDetected,
      bumpTs: data.bumpTs,
      histConfidence: data.histConfidence,
      softDisplay: data.softDisplay,
      gateRejected: data.gateRejected,
      rotationOnly: data.rotationOnly,
      navLocSuccessCount: data.navLocSuccessCount,
      imuLaunchConfirmed: data.imuLaunchConfirmed,
      now: data.ts || Date.now(),
    },
  );
  if (!navigating) {
    const display = navEngine.getDisplayState();
    applyDisplayState(display, false);
    return;
  }
  if (!renderTimer) startRenderLoop();
}

async function pollLatestPosition() {
  if (!routePoints.length) return;
  const url = `${PUCK_API}/latest?mapId=${MAP_ID}&sessionId=${encodeURIComponent(SESSION_ID)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok && data.latitude != null) onPositionUpdate(data);
  } catch (e) { /* ignore */ }
}

function startStoragePolling() {
  setInterval(pollLatestPosition, 500);
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
  document.getElementById('btnRecenter').addEventListener('click', recenterCamera);
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
