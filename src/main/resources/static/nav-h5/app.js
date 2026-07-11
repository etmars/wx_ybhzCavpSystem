/* eslint-disable */
/**
 * 宜泊慧智 C-AVP H5 — MapLibre 纯渲染层（UI 在小程序 cover-view）
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
const API_BASE = Q.api_base || window.location.origin;
const NAV_FLOW = Q.nav_flow || 'PARKING_ENTRY';
const AUTO_START = Q.auto_start === '1';

const SPACE_ID = Q.space_id || '';
const SESSION_ID = Q.session_id || 'default';
const SEED_TEST_ROUTE = Q.seed_test_route === '1';

let routePoints = [];
let routeMetrics = { cumulative: [0], total: 0 };
let destination = null;
let map = null;
let mapCenter = null;
let navigating = false;
let lastDisplay = null;
let lastCameraTarget = null;
let lastCameraBearing = null;
let userMapInteracting = false;
let userInteractTimer = null;
let parkingLabelRaf = 0;

const USER_INTERACT_RESUME_MS = 3000;

function markUserMapInteracting() {
  userMapInteracting = true;
  if (userInteractTimer) clearTimeout(userInteractTimer);
  userInteractTimer = setTimeout(() => {
    userMapInteracting = false;
    userInteractTimer = null;
    lastCameraTarget = null;
    lastCameraBearing = null;
  }, USER_INTERACT_RESUME_MS);
}

function scheduleParkingLabelRefresh() {
  if (parkingLabelRaf) return;
  parkingLabelRaf = requestAnimationFrame(() => {
    parkingLabelRaf = 0;
    if (!map) return;
    MapLayers.updateParkingLabelSizeByZoom(map);
    if (lastDisplay && lastDisplay.location) {
      updateUserPuck(lastDisplay.location, lastDisplay.heading);
    }
  });
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
  routeMetrics = window.NavGeo.buildRouteMetrics(routePoints);
  destination = routePoints[routePoints.length - 1];
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
  await fetch(ROUTE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function loadRouteFromSession() {
  if (!ROUTE_API || !SESSION_ID) return false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const url = `${ROUTE_API}?sessionId=${encodeURIComponent(SESSION_ID)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.pointsPos) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      if (applyRoutePoints(data.pointsPos)) return true;
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

function updateNavCamera(loc, cameraBearing, force, navParked) {
  if (!map || !loc || !navigating) return;
  if (navParked && !force) return;
  if (userMapInteracting && !force) return;
  const br = cameraBearing;
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
  if (!map || !routePoints.length) return;
  const start = routePoints[0];
  const br = routePoints.length >= 2
    ? window.NavGeo.bearingDegrees(routePoints[0], routePoints[1])
    : 0;
  MapLayers.ensureUserPuckLayers(map, [start.longitude, start.latitude], headingForScreenIcon(br));
}

function headingForScreenIcon(mapRelHeading) {
  const h = mapRelHeading || 0;
  const mapBr = map ? (map.getBearing() || 0) : 0;
  return ((h - mapBr) % 360 + 360) % 360;
}

function updateUserPuck(loc, bearing) {
  if (!map || !loc || !map.getSource('user-loc-source')) return;
  map.getSource('user-loc-source').setData({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [loc.longitude, loc.latitude] },
    properties: { bearing: headingForScreenIcon(bearing) },
  });
}

function applyDisplayState(display, forceCamera) {
  if (!display || !display.location) return;
  lastDisplay = display;
  updateUserPuck(display.location, display.heading);
  MapLayers.updateRouteProgressByMeters(
    map,
    routePoints,
    display.progressMeters,
    routeMetrics,
  );
  if (navigating) {
    updateNavCamera(display.location, display.cameraBearing, forceCamera, display.navParked);
  }
}

function syncNavStateFromDisplay(display) {
  if (!display) return;
  const wasNav = navigating;
  navigating = !!display.navigating;
  if (navigating && !wasNav) {
    applyNavCameraPadding();
  } else if (!navigating && wasNav) {
    clearNavCameraPadding();
  }
}

function recenterCamera() {
  if (!map) return;
  if (navigating && lastDisplay && lastDisplay.location) {
    lastCameraTarget = null;
    lastCameraBearing = null;
    applyDisplayState(lastDisplay, true);
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

function onDisplayFromHash(forceCamera) {
  if (!window.DisplayBridge) return;
  const meta = window.DisplayBridge.decodeDisplayMeta(window.location.hash);
  const display = meta.display;
  const force = !!forceCamera || meta.recenter;
  if (meta.recenter) recenterCamera();
  if (!display) return;
  syncNavStateFromDisplay(display);
  applyDisplayState(display, force);
}

async function loadParkingLabelIcons(mapInstance) {
  try {
    const url = `${API_BASE}/api/maps/${encodeURIComponent(MAP_ID)}/label-index`;
    const res = await fetch(url);
    if (!res.ok) return;
    const labelMap = await res.json();
    MapLayersUtil.registerParkingLabelIcons(mapInstance, labelMap);
  } catch (e) {
    console.warn('loadParkingLabelIcons failed', e);
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
      MapLayers.restackPoiLayers(map);
      await loadParkingLabelIcons(map);
      MapLayers.updateParkingLabelSizeByZoom(map);

      const hasRoute = await resolveRoute();

      if (hasRoute) {
        MapLayers.ensureNavRouteLayers(map, routePoints);
        MapLayers.updateDirectionArrows(map, routePoints);
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
      }
      postToMiniProgram({ type: 'h5Ready', routeOk: hasRoute });
      onDisplayFromHash(true);
    } catch (e) {
      if (window.NavDebug) NavDebug.logError('map.on(load)', e);
    }
  });

  map.on('dragstart', markUserMapInteracting);
  map.on('zoomstart', markUserMapInteracting);
  map.on('rotatestart', markUserMapInteracting);
  map.on('pitchstart', markUserMapInteracting);
  map.on('move', scheduleParkingLabelRefresh);
  map.on('moveend', scheduleParkingLabelRefresh);

  window.__map = map;
}

function postToMiniProgram(msg) {
  if (window.wx && wx.miniProgram && wx.miniProgram.postMessage) {
    wx.miniProgram.postMessage({ data: msg });
  }
}

window.addEventListener('load', async () => {
  window.addEventListener('hashchange', () => onDisplayFromHash(false));
  await initMap();
});
