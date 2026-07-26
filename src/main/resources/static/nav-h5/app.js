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
const WAYPOINT = (Q.waypoint_lon && Q.waypoint_lat)
  ? {
    lon: parseFloat(Q.waypoint_lon),
    lat: parseFloat(Q.waypoint_lat),
    label: Q.waypoint_label || '途径点',
    index: parseInt(Q.waypoint_index || '1', 10) || 1,
  }
  : null;
const ACTIVE_LEN = parseInt(Q.active_len || '0', 10) || 0;
const DEST_IS_FINAL = Q.dest_is_final === '1';

let routePoints = [];
let previewPoints = [];
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
/** 程序化相机移动的标记：MapLibre 的 rotatestart/zoomstart/pitchstart 对 easeTo 同样会触发 */
const CAMERA_EVENT_DATA = { navAuto: true };

function markUserMapInteracting(e) {
  if (e && e.navAuto) return;
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
  const all = arr.map(parseRoutePoint).filter(Boolean);
  if (all.length < 2) return false;
  // active_len：当前导航段点数；之后同图续段作为灰色虚线预览
  if (ACTIVE_LEN > 1 && ACTIVE_LEN < all.length) {
    routePoints = all.slice(0, ACTIVE_LEN);
    previewPoints = all.slice(ACTIVE_LEN - 1);
  } else {
    routePoints = all;
    previewPoints = [];
  }
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

/**
 * 让蓝点固定停在屏幕下方，前方路径留出上方视野。
 * MapLibre 把中心点摆在「扣掉 padding 后」区域的中心，所以是加 top padding 把点压低：
 * (top + h) / 2 = ratio * h  →  top = (2 * ratio - 1) * h。
 */
function navCameraPadding() {
  const el = (map && map.getContainer) ? map.getContainer() : null;
  const h = el ? el.clientHeight : 0;
  // 容器还没布局时不要把 padding 清零，否则蓝点会先跳回屏幕中央
  if (!h) return (map && map.getPadding) ? map.getPadding() : { top: 0, bottom: 0, left: 0, right: 0 };
  const ratio = Math.min(0.9, Math.max(0.5, T.NAV_PUCK_SCREEN_RATIO || 0.68));
  return {
    top: Math.max(0, Math.round((2 * ratio - 1) * h)),
    bottom: 0,
    left: 0,
    right: 0,
  };
}

function applyNavCameraPadding() {
  if (!map) return;
  map.setPadding(navCameraPadding(), CAMERA_EVENT_DATA);
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
    padding: navCameraPadding(),
    duration: force ? 0 : T.NAV_CAMERA_EASE_MS,
  }, CAMERA_EVENT_DATA);
}

/**
 * 预览相机方位：route-up，让起点前方路径竖直向上。
 * MapLibre 的 bearing 就是「哪个方位朝屏幕上方」，且与路线点同处一个渲染坐标系，
 * 因此直接用路线前向方位，不能再叠加 MAP_BEARING（那会把路径转回图北朝上）。
 */
function previewCameraBearing() {
  if (routePoints.length < 2) return MAP_BEARING;
  const br = window.NavGeo.routeForwardBearingAtProgress(routePoints, 0, routeMetrics);
  return Number.isFinite(br) ? br : MAP_BEARING;
}

function focusPreviewCamera() {
  if (!map || routePoints.length < 1) return;
  const start = routePoints[0];
  map.jumpTo({
    center: [start.longitude, start.latitude],
    zoom: T.PREVIEW_ZOOM,
    pitch: T.NAV_PITCH,
    bearing: previewCameraBearing(),
    padding: navCameraPadding(),
  }, CAMERA_EVENT_DATA);
}

function seedPuckAtRouteStart() {
  if (!map || !routePoints.length) return;
  const start = routePoints[0];
  const br = routePoints.length >= 2
    ? window.NavGeo.bearingDegrees(routePoints[0], routePoints[1])
    : 0;
  MapLayers.ensureUserPuckLayers(map, [start.longitude, start.latitude], headingForMapIcon(br));
  if (!lastDisplay || !lastDisplay.location) {
    lastDisplay = {
      location: { longitude: start.longitude, latitude: start.latitude },
      heading: br,
      progressMeters: 0,
      navigating: false,
    };
  }
}

/** 对齐 Android：ICON_ROTATION_ALIGNMENT_MAP 直接吃真北方位，不做 viewport 换算 */
function headingForMapIcon(trueNorthHeading) {
  return ((trueNorthHeading || 0) % 360 + 360) % 360;
}

function updateUserPuck(loc, bearing) {
  if (!map || !loc || !map.getSource('user-loc-source')) return;
  map.getSource('user-loc-source').setData({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [loc.longitude, loc.latitude] },
    properties: { bearing: headingForMapIcon(bearing) },
  });
}

function applyDisplayState(display, forceCamera) {
  if (!display || !display.location) return;
  lastDisplay = display;
  updateUserPuck(display.location, display.heading);
  if (MapLayers && typeof MapLayers.updateKnnRawMarker === 'function') {
    MapLayers.updateKnnRawMarker(
      map,
      display.knnRawLocation,
      !!display.showKnnRaw,
    );
  }
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
  // 预览态也保持同样的偏移，蓝点不会在起步瞬间跳一下
  if (navigating !== wasNav) applyNavCameraPadding();
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
      bearing: previewCameraBearing(),
      padding: navCameraPadding(),
      duration: 300,
    }, CAMERA_EVENT_DATA);
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

  // 带版本参数，避免微信 web-view / CDN 一直吃到旧 map-style（无路面标线）
  const styleRes = await fetch(`./map-style.json?v=hdroad5`);
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
        if (previewPoints.length >= 2 && typeof MapLayers.ensureRoutePreviewLayer === 'function') {
          MapLayers.ensureRoutePreviewLayer(map, previewPoints);
        }
        if (NAV_FLOW === 'PARKING_ENTRY' && SPACE_ID) {
          MapLayers.highlightTargetSpace(map, SPACE_ID);
        }
        // 途径点橙色数字牌；终点 P 牌仅当预览段确实终止于目标车位
        if (WAYPOINT) {
          MapLayers.ensureWaypointPinLayer(map, WAYPOINT);
        }
        if (DEST_IS_FINAL && destination && SPACE_ID) {
          MapLayers.ensureDestPinLayer(map, destination, SPACE_ID);
        }
        seedPuckAtRouteStart();
        map.resize();
        applyNavCameraPadding();
        focusPreviewCamera();
        map.once('idle', () => {
          map.resize();
          applyNavCameraPadding();
          focusPreviewCamera();
          seedPuckAtRouteStart();
          if (WAYPOINT) MapLayers.ensureWaypointPinLayer(map, WAYPOINT);
        });
        if (window.NavDebug) NavDebug.reportRouteState(map, routePoints, {
          hasRoute: true,
          previewLen: previewPoints.length,
          activeLen: routePoints.length,
        });
      } else {
        map.flyTo({
          center: mapCenter,
          zoom: T.PREVIEW_ZOOM,
          pitch: T.NAV_PITCH,
          bearing: MAP_BEARING,
          duration: 0,
        }, CAMERA_EVENT_DATA);
      }
      postToMiniProgram({ type: 'h5Ready', routeOk: hasRoute });
      onDisplayFromHash(true);
    } catch (e) {
      if (window.NavDebug) NavDebug.logError('map.on(load)', e);
      showMapLoadError(e);
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

/** 无条件显示 map.on('load') 异常，便于定位蓝点/标牌不渲染 */
function showMapLoadError(err) {
  const msg = (err && (err.message || err.stack)) ? String(err.message || err.stack) : String(err || 'unknown');
  console.error('[nav-h5] map.on(load) failed', err);
  let el = document.getElementById('navLoadError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'navLoadError';
    el.style.cssText = [
      'position:fixed',
      'left:8px',
      'right:8px',
      'bottom:88px',
      'z-index:10000',
      'background:rgba(180,20,20,0.92)',
      'color:#fff',
      'font:12px/1.4 sans-serif',
      'padding:10px 12px',
      'border-radius:8px',
      'white-space:pre-wrap',
      'word-break:break-all',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(el);
  }
  el.textContent = `地图加载异常：${msg.slice(0, 400)}`;
}

window.addEventListener('load', async () => {
  window.addEventListener('hashchange', () => onDisplayFromHash(false));
  // 旋转/尺寸变化后 padding 按新高度重算，否则蓝点偏移比例会失真
  window.addEventListener('resize', () => {
    if (!map) return;
    map.resize();
    applyNavCameraPadding();
  });
  await initMap();
});
