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
const TILES_V = (Q.tiles_v || '').trim();
const MAP_IDS = (() => {
  const raw = String(Q.map_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ids = [];
  const seen = new Set();
  [MAP_ID].concat(raw).forEach((id) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  });
  return ids;
})();
const MAP_IDS_QUERY = String(Q.map_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
const TILES_VS = String(Q.tiles_vs || '').split(',').map((s) => s.trim());
function tilesUrlForMap(mapId) {
  const base = TILES_USE_MAP_ID
    ? `${TILES_BASE}/{z}/{x}/{y}.pbf?map_id=${encodeURIComponent(mapId)}`
    : `${TILES_BASE}/{z}/{x}/{y}.pbf`;
  let v = '';
  const idx = MAP_IDS_QUERY.indexOf(mapId);
  if (idx >= 0 && TILES_VS[idx]) v = TILES_VS[idx];
  if (!v && String(mapId) === String(MAP_ID)) v = TILES_V;
  if (!v) return base;
  return `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(v)}`;
}
const TILES_URL = tilesUrlForMap(MAP_ID);
const MAP_BEARING = parseFloat(Q.map_bearing) || 0;
const GEO_API = Q.geo_api || `https://parkinglot.c-avp.com:9065/api/maps/${MAP_ID}/geometry`;
const ROUTE_API = Q.route_api || 'https://parkinglot.c-avp.com:9065/api/nav/route';
const API_BASE = Q.api_base || window.location.origin;
const NAV_FLOW = Q.nav_flow || 'PARKING_ENTRY';
const AUTO_START = Q.auto_start === '1';
const STRUCTURE_3D_ENABLED = Q.structures_3d !== '0';
const STRUCTURE_DEFER_MS = Math.max(0, parseInt(Q.structures_defer_ms || '800', 10) || 0);
const STRUCTURE_MAX_POINTS = Math.max(1, parseInt(Q.structures_max_points || '36', 10) || 36);

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
let ACTIVE_LEN = parseInt(Q.active_len || '0', 10) || 0;
const DEST_IS_FINAL = Q.dest_is_final === '1';
/** 该停车场 OSM 地图数量；>1 才渲染 sType=1005 交界层。缺省/0 保持显示（兼容旧链接）。 */
const LOT_MAP_COUNT = parseInt(Q.lot_map_count || '0', 10) || 0;
const PARKING_LOT_ID = (Q.parking_lot_id || '').trim();

let routePoints = [];
let previewPoints = [];
/** 同图完整折线（当前蓝 + 灰预览），续航切段时从衔接点切开 */
let allRoutePoints = [];
let routeMetrics = { cumulative: [0], total: 0 };
/** 刚完成同图续航换线：用于丢掉上一段残留的大 prog，避免新蓝线被立刻「走完」消失 */
let promoteGuardUntilMs = 0;
let destination = null;
let map = null;
let mapCenter = null;
let activeMapId = MAP_ID;
let navigating = false;
let lastDisplay = null;
let lastCameraTarget = null;
let lastCameraBearing = null;
let userMapInteracting = false;
let userInteractTimer = null;
let parkingLabelRaf = 0;

// 渲染位姿补间：小程序经 web-view hash 推送 DisplayState，帧率只有 ~10Hz 且抖动大，
// 直接落位会让蓝点一跳一跳。这里按「上一次到帧的间隔」把位姿补到每个动画帧。
let renderPose = null;
let poseTween = null;
let poseRaf = 0;
let lastPoseRecvMs = 0;
let lastRouteProgressDrawMs = 0;
let cachedPadding = null;
let cachedPaddingHeight = -1;
let structureLoadTimer = null;

const USER_INTERACT_RESUME_MS = 3000;
const POSE_TWEEN_MIN_MS = 60;
const POSE_TWEEN_MAX_MS = 700;
/** 超过这个位移不补间：重定位/换段属于真跳变，滑过去反而是错的 */
const POSE_TWEEN_MAX_JUMP_M = 25;
/** 折线进度是按里程重切 O(n) 折线，不需要跟蓝点同帧率 */
const ROUTE_PROGRESS_MIN_MS = 120;
/** 程序化相机移动的标记：MapLibre 的 rotatestart/zoomstart/pitchstart 对 easeTo 同样会触发 */
const CAMERA_EVENT_DATA = { navAuto: true };

/** 镜头/蓝点被拉回诊断：只打可疑事件，带简短调用栈 */
function fmtLL(p) {
  if (!p) return '-';
  const lat = p.latitude != null ? p.latitude : p.lat;
  const lon = p.longitude != null ? p.longitude : p.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '-';
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

function routeEnds(pts) {
  if (!pts || !pts.length) return 'empty';
  return `n=${pts.length} 0=${fmtLL(pts[0])} last=${fmtLL(pts[pts.length - 1])}`;
}

function camDiag(tag, detail) {
  let stack = '';
  try {
    stack = (new Error()).stack
      .split('\n')
      .slice(2, 5)
      .map((l) => l.trim().replace(/^at\s+/, ''))
      .join(' ← ');
  } catch (e) { /* ignore */ }
  const pose = renderPose
    ? `pose=${fmtLL(renderPose)} prog=${Number(renderPose.prog || 0).toFixed(1)}`
    : 'pose=-';
  const cam = lastCameraTarget
    ? `cam=${lastCameraTarget[1].toFixed(6)},${lastCameraTarget[0].toFixed(6)}`
    : 'cam=-';
  const blue0 = routePoints[0] ? `blue0=${fmtLL(routePoints[0])}` : 'blue0=-';
  console.info(
    `[CamDiag] ${tag} | nav=${navigating} ${pose} ${cam} ${blue0}`
    + ` blueN=${routePoints.length} grayN=${previewPoints.length} allN=${allRoutePoints.length}`
    + (detail ? ` | ${detail}` : '')
    + (stack ? ` | ${stack}` : ''),
  );
}

/** 相机中心相对蓝线起点：中途却靠近起点 = 拉回 */
function logIfCameraYank(reason, centerLon, centerLat) {
  if (!routePoints.length || !Number.isFinite(centerLon) || !Number.isFinite(centerLat)) return;
  const start = routePoints[0];
  const dist0 = window.NavGeo.distanceMeters(
    { latitude: centerLat, longitude: centerLon },
    start,
  );
  const poseProg = renderPose ? Number(renderPose.prog || 0) : 0;
  const poseDist0 = renderPose
    ? window.NavGeo.distanceMeters(
      { latitude: renderPose.lat, longitude: renderPose.lon },
      start,
    )
    : NaN;
  // 蓝点已离开起点，相机却钉在起点附近
  if (poseProg > 8 && dist0 < 12) {
    camDiag('YANK_TO_START',
      `why=${reason} camDist0=${dist0.toFixed(1)} poseDist0=${Number.isFinite(poseDist0) ? poseDist0.toFixed(1) : '-'}`
      + ` center=${centerLat.toFixed(6)},${centerLon.toFixed(6)}`);
  }
}

function nowMs() {
  return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
}

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
    if (renderPose) {
      updateUserPuck({ latitude: renderPose.lat, longitude: renderPose.lon }, renderPose.hdg);
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
  allRoutePoints = all.slice();
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
  console.info(
    `[CamDiag] applyRoutePoints all=${all.length} activeLen=${ACTIVE_LEN}`
    + ` blue=${routePoints.length} gray=${previewPoints.length}`,
  );
  return true;
}

/** 在折线上找距衔接点最近的下标；超过 maxM 视为未命中 */
function indexNearJunction(pts, junction, maxM) {
  if (!junction || !pts || !pts.length) return -1;
  const limit = Number.isFinite(maxM) ? maxM : 40;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    const d = window.NavGeo.distanceMeters(pts[i], junction);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return (best >= 0 && bestD <= limit) ? best : -1;
}

/**
 * 把「从衔接点起的剩余折线」设为蓝/灰，并刷新图层。
 * 绝不能再拿已走完的旧 active 当蓝线。
 */
function applyAheadAsNavRoute(aheadAll, nextActiveLen, junction) {
  if (!aheadAll || aheadAll.length < 2) return false;
  const al = Math.max(0, Math.floor(Number(nextActiveLen) || 0));
  allRoutePoints = aheadAll.slice();
  ACTIVE_LEN = (al > 1 && al < aheadAll.length) ? al : aheadAll.length;
  if (ACTIVE_LEN > 1 && ACTIVE_LEN < aheadAll.length) {
    routePoints = aheadAll.slice(0, ACTIVE_LEN);
    previewPoints = aheadAll.slice(ACTIVE_LEN - 1);
  } else {
    routePoints = aheadAll.slice();
    previewPoints = [];
    ACTIVE_LEN = routePoints.length;
  }
  routeMetrics = window.NavGeo.buildRouteMetrics(routePoints);
  destination = routePoints[routePoints.length - 1];

  if (map) {
    MapLayers.ensureNavRouteLayers(map, routePoints);
    MapLayers.updateDirectionArrows(map, routePoints);
    if (typeof MapLayers.updateRouteProgressByMeters === 'function') {
      MapLayers.updateRouteProgressByMeters(map, routePoints, 0, routeMetrics);
    }
    if (previewPoints.length >= 2) {
      MapLayers.ensureRoutePreviewLayer(map, previewPoints);
    } else if (typeof MapLayers.clearRoutePreviewLayer === 'function') {
      MapLayers.clearRoutePreviewLayer(map);
    }
  }

  const brMap = routePoints.length >= 2
    ? window.NavGeo.bearingDegrees(routePoints[0], routePoints[1])
    : 0;
  const brTn = ((brMap + MAP_BEARING) % 360 + 360) % 360;
  let anchor = routePoints[0];
  if (junction && Number.isFinite(junction.latitude) && Number.isFinite(junction.longitude)) {
    anchor = { latitude: junction.latitude, longitude: junction.longitude };
  }
  const prev = renderPose
    ? { latitude: renderPose.lat, longitude: renderPose.lon }
    : null;
  const distPrev = prev ? window.NavGeo.distanceMeters(prev, anchor) : Infinity;
  cancelPoseTween();
  if (renderPose && Number.isFinite(distPrev) && distPrev <= 40) {
    renderPose.prog = 0;
    renderPose.hdg = brTn;
  } else if (renderPose) {
    renderPose.lon = anchor.longitude;
    renderPose.lat = anchor.latitude;
    renderPose.hdg = brTn;
    renderPose.prog = 0;
  } else if (anchor) {
    renderPose = {
      lon: anchor.longitude,
      lat: anchor.latitude,
      hdg: brTn,
      cam: previewCameraBearing(),
      prog: 0,
    };
  }
  // 换线后无论 freeze/挪点，都保证蓝点图层存在并贴到当前位姿
  if (map && renderPose) {
    MapLayers.ensureUserPuckLayers(
      map,
      [renderPose.lon, renderPose.lat],
      headingForMapIcon(renderPose.hdg),
    );
  }
  if (lastDisplay) {
    lastDisplay.progressMeters = 0;
    lastDisplay.navigating = true;
  }
  navigating = true;
  promoteGuardUntilMs = nowMs() + 2500;
  camDiag('applyAhead',
    `alIn=${al} alOut=${ACTIVE_LEN} junc=${fmtLL(junction)}`
    + ` ahead=${routeEnds(aheadAll)} blue=${routeEnds(routePoints)} gray=${routeEnds(previewPoints)}`
    + ` total=${routeMetrics.total.toFixed(1)}m guard=2500ms`);
  return true;
}

/**
 * 同图「继续导航」：前方剩余（灰线 / 整线从衔接点切开）→ 蓝线。
 * 已走段不得再当蓝线。
 */
function promotePreviewToBlue(nextActiveLen, junction) {
  let ahead = null;
  let src = '';

  // 1) 优先用已有灰线预览
  if (previewPoints && previewPoints.length >= 2) {
    ahead = previewPoints.slice();
    src = 'gray';
  }

  // 2) 灰线丢了：从同图完整折线按衔接点切开
  if (!ahead && allRoutePoints.length >= 2 && junction) {
    const idx = indexNearJunction(allRoutePoints, junction, 40);
    if (idx >= 0 && idx < allRoutePoints.length - 1) {
      ahead = allRoutePoints.slice(idx);
      src = `all@${idx}`;
    }
  }

  // 3) 拼接当前蓝+灰再切
  if (!ahead && junction) {
    const merged = routePoints.concat(
      (previewPoints && previewPoints.length > 1) ? previewPoints.slice(1) : [],
    );
    const idx = indexNearJunction(merged, junction, 40);
    if (idx >= 0 && idx < merged.length - 1) {
      ahead = merged.slice(idx);
      src = `merge@${idx}`;
    }
  }

  // 已换过线：当前蓝线已从衔接点起，勿再 fail→reload 把线打没
  if ((!ahead || ahead.length < 2) && junction && routePoints.length >= 2) {
    const d0 = window.NavGeo.distanceMeters(routePoints[0], junction);
    if (d0 <= 40) {
      camDiag('promoteBlue ALREADY',
        `blue0 near junc ${d0.toFixed(1)}m ${routeEnds(routePoints)}`);
      if (map) {
        MapLayers.ensureNavRouteLayers(map, routePoints);
        if (typeof MapLayers.updateRouteProgressByMeters === 'function') {
          MapLayers.updateRouteProgressByMeters(map, routePoints, 0, routeMetrics);
        }
      }
      promoteGuardUntilMs = nowMs() + 2500;
      navigating = true;
      return true;
    }
  }

  if (!ahead || ahead.length < 2) {
    camDiag('promoteBlue FAIL', 'no ahead polyline');
    return false;
  }

  const ok = applyAheadAsNavRoute(ahead, nextActiveLen, junction);
  camDiag('promoteBlue',
    `src=${src} ahead→blue al=${ACTIVE_LEN} bluePts=${routePoints.length}`
    + ` grayLeft=${previewPoints.length}`);
  return ok;
}

/**
 * 同图切段兜底：拉 session。若仍是旧整线，从衔接点切开再用，勿整段 REJECT 后停在旧蓝线。
 */
async function reloadRouteInPlace(nextActiveLen, junction) {
  const al = Math.max(0, Math.floor(Number(nextActiveLen) || 0));
  if (!ROUTE_API || !SESSION_ID) {
    camDiag('reloadRoute FAIL', 'no api/session');
    return false;
  }
  let raw = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const url = `${ROUTE_API}?sessionId=${encodeURIComponent(SESSION_ID)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.pointsPos) {
        raw = (data.pointsPos || []).map(parseRoutePoint).filter(Boolean);
        if (raw.length >= 2) break;
      }
    } catch (e) {
      if (window.NavDebug) NavDebug.logError('reloadRouteInPlace', e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!raw || raw.length < 2) {
    camDiag('reloadRoute FAIL', `al=${al} fetch`);
    return false;
  }

  let ahead = raw;
  const ref = (junction && Number.isFinite(junction.latitude))
    ? junction
    : (renderPose ? { latitude: renderPose.lat, longitude: renderPose.lon } : null);
  if (ref) {
    const d0 = window.NavGeo.distanceMeters(ref, raw[0]);
    if (d0 > 40) {
      const idx = indexNearJunction(raw, ref, 40);
      if (idx < 0 || idx >= raw.length - 1) {
        camDiag('reloadRoute REJECT',
          `start ${d0.toFixed(1)}m from junction, no cut idx`);
        return false;
      }
      ahead = raw.slice(idx);
      camDiag('reloadRoute CUT',
        `oldStart ${d0.toFixed(1)}m → slice@${idx} left=${ahead.length}`);
    }
  }

  const ok = applyAheadAsNavRoute(ahead, al, ref || junction);
  camDiag('reloadRoute OK',
    `al=${ACTIVE_LEN} bluePts=${routePoints.length} grayPts=${previewPoints.length}`);
  return ok;
}

function promotePreviewRoute(nextActiveLen) {
  return promotePreviewToBlue(nextActiveLen, null);
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
  if (h === cachedPaddingHeight && cachedPadding) return cachedPadding;
  const ratio = Math.min(0.9, Math.max(0.5, T.NAV_PUCK_SCREEN_RATIO || 0.68));
  cachedPaddingHeight = h;
  cachedPadding = {
    top: Math.max(0, Math.round((2 * ratio - 1) * h)),
    bottom: 0,
    left: 0,
    right: 0,
  };
  return cachedPadding;
}

function applyNavCameraPadding() {
  if (!map) return;
  map.setPadding(navCameraPadding(), CAMERA_EVENT_DATA);
}

function updateNavCamera(loc, cameraBearing, force, navParked, smooth) {
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
  // 补间帧本身就是平滑源，再套最小位移门限 + 600ms easeTo 会把它重新切成一跳一跳
  const minMove = smooth ? 0.02 : T.NAV_CAMERA_MIN_MOVE_M;
  const minBearing = smooth ? 0.05 : T.NAV_CAMERA_MIN_BEARING_DELTA_DEG;
  if (!force && moveM < minMove && brDelta < minBearing) return;

  // 相对路线起点的距离：若相机中心突然更靠近起点且位移大，就是「被拉回」
  if (routePoints.length && lastCameraTarget && moveM >= 3) {
    const start = routePoints[0];
    const prevDist = window.NavGeo.distanceMeters(
      { latitude: lastCameraTarget[1], longitude: lastCameraTarget[0] },
      start,
    );
    const nextDist = window.NavGeo.distanceMeters(loc, start);
    if (nextDist + 2 < prevDist) {
      camDiag('cameraTowardStart',
        `move=${moveM.toFixed(1)}m prevDist0=${prevDist.toFixed(1)} nextDist0=${nextDist.toFixed(1)}`
        + ` force=${!!force} smooth=${!!smooth}`);
    }
  }

  lastCameraTarget = target;
  lastCameraBearing = br;
  const camera = {
    center: target,
    zoom: T.NAV_ZOOM,
    pitch: T.NAV_PITCH,
    bearing: br,
    padding: navCameraPadding(),
  };
  if (force || moveM >= 8) {
    logIfCameraYank(
      force ? 'updateNavCamera.force' : 'updateNavCamera.move',
      loc.longitude,
      loc.latitude,
    );
  }
  // 补间帧是逐帧调用，走 easeTo(duration:0) 会每帧空转一遍动画机制；jumpTo 才是瞬时相机的正解
  if (force || smooth) map.jumpTo(camera, CAMERA_EVENT_DATA);
  else map.easeTo({ ...camera, duration: T.NAV_CAMERA_EASE_MS }, CAMERA_EVENT_DATA);
}

/**
 * 预览相机方位：route-up，让起点前方路径竖直向上。
 * MapLibre 的 bearing 与路线点同处图纸 CRS（+lat=图北），直接用路线前向角。
 * map_bearing（如 ziguang=327°）是罗盘真北偏移，叠进去会把路径拧斜。
 */
function previewCameraBearing() {
  if (routePoints.length < 2) return 0;
  const br = window.NavGeo.routeForwardBearingAtProgress(routePoints, 0, routeMetrics);
  return Number.isFinite(br) ? br : 0;
}

/**
 * 起点相机：与导航态 updateNavCamera 用同一套 zoom/pitch/bearing/padding，
 * 否则「继续导航」那一下视角会突然跳一档。
 */
function routeStartCameraOptions() {
  const start = routePoints[0];
  return {
    center: [start.longitude, start.latitude],
    zoom: T.NAV_ZOOM,
    pitch: T.NAV_PITCH,
    bearing: previewCameraBearing(),
    padding: navCameraPadding(),
  };
}

function focusPreviewCamera() {
  if (!map || routePoints.length < 1) return;
  // 导航已起步或蓝点已离开起点：禁止再 jump 回 routePoints[0]
  if (navigating || (renderPose && renderPose.prog > 0.5)) {
    camDiag('focusPreview BLOCKED',
      `reason=${navigating ? 'navigating' : 'prog>0.5'}`);
    return;
  }
  const opt = routeStartCameraOptions();
  camDiag('focusPreview APPLY',
    `jumpTo routeStart ${fmtLL(routePoints[0])}`);
  logIfCameraYank('focusPreview', opt.center[0], opt.center[1]);
  map.jumpTo(opt, CAMERA_EVENT_DATA);
  lastCameraTarget = opt.center;
  lastCameraBearing = opt.bearing;
}

function seedPuckAtRouteStart() {
  if (!map || !routePoints.length) return;
  // resolveRoute 等待期间 hash 可能已把 navigating/prog 拉起来：
  // 禁止把位姿打回起点，但仍必须创建 user-loc 图层，否则 updateUserPuck 会空转，蓝点永久消失。
  if (navigating || (renderPose && renderPose.prog > 0.5)) {
    const lon = renderPose ? renderPose.lon : routePoints[0].longitude;
    const lat = renderPose ? renderPose.lat : routePoints[0].latitude;
    const hdg = renderPose ? renderPose.hdg : 0;
    MapLayers.ensureUserPuckLayers(map, [lon, lat], headingForMapIcon(hdg));
    camDiag('seedPuck ENSURE',
      `reason=${navigating ? 'navigating' : 'prog>0.5'} at=${fmtLL({ latitude: lat, longitude: lon })}`);
    return;
  }
  camDiag('seedPuck APPLY', 'renderPose→0');
  const start = routePoints[0];
  const brMap = routePoints.length >= 2
    ? window.NavGeo.bearingDegrees(routePoints[0], routePoints[1])
    : 0;
  const brTn = ((brMap + MAP_BEARING) % 360 + 360) % 360;
  MapLayers.ensureUserPuckLayers(map, [start.longitude, start.latitude], headingForMapIcon(brTn));
  cancelPoseTween();
  renderPose = {
    lon: start.longitude,
    lat: start.latitude,
    hdg: brTn,
    cam: previewCameraBearing(),
    prog: 0,
  };
  if (!lastDisplay || !lastDisplay.location) {
    lastDisplay = {
      location: { longitude: start.longitude, latitude: start.latitude },
      heading: brTn,
      progressMeters: 0,
      navigating: false,
    };
  }
}

/** display.heading 为真北；icon-rotate(ALIGNMENT_MAP) 相对图纸北，须减 map_bearing */
function headingForMapIcon(trueNorthHeading) {
  return (((trueNorthHeading || 0) - MAP_BEARING) % 360 + 360) % 360;
}

function updateUserPuck(loc, bearing) {
  if (!map || !loc) return;
  if (!map.getSource('user-loc-source')) {
    MapLayers.ensureUserPuckLayers(
      map,
      [loc.longitude, loc.latitude],
      headingForMapIcon(bearing),
    );
    return;
  }
  map.getSource('user-loc-source').setData({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [loc.longitude, loc.latitude] },
    properties: { bearing: headingForMapIcon(bearing) },
  });
}

function cancelPoseTween() {
  if (poseRaf) {
    cancelAnimationFrame(poseRaf);
    poseRaf = 0;
  }
  poseTween = null;
}

function drawPose(pose, force, navParked, smoothCamera) {
  const prevProg = renderPose ? Number(renderPose.prog || 0) : -1;
  renderPose = pose;
  const loc = { latitude: pose.lat, longitude: pose.lon };
  updateUserPuck(loc, pose.hdg);
  const t = nowMs();
  if (force || t - lastRouteProgressDrawMs >= ROUTE_PROGRESS_MIN_MS) {
    lastRouteProgressDrawMs = t;
    // prog 回零却仍画在「旧蓝线」上 = 已走段被重新涂蓝
    if (prevProg > 5 && pose.prog < 1 && routePoints.length) {
      camDiag('ROUTE_PAINT_RESET',
        `prevProg=${prevProg.toFixed(1)}→${Number(pose.prog || 0).toFixed(1)}`
        + ` ${routeEnds(routePoints)} gray=${routeEnds(previewPoints)}`);
    }
    MapLayers.updateRouteProgressByMeters(map, routePoints, pose.prog, routeMetrics);
  }
  if (navigating) updateNavCamera(loc, pose.cam, force, navParked, smoothCamera);
}

function stepPoseTween() {
  poseRaf = 0;
  if (!poseTween) return;
  const from = poseTween.from;
  const to = poseTween.to;
  const t = Math.min(1, (nowMs() - poseTween.startMs) / poseTween.durationMs);
  drawPose({
    lon: from.lon + (to.lon - from.lon) * t,
    lat: from.lat + (to.lat - from.lat) * t,
    hdg: window.NavGeo.lerpBearingDeg(from.hdg, to.hdg, t),
    cam: window.NavGeo.lerpBearingDeg(from.cam, to.cam, t),
    prog: from.prog + (to.prog - from.prog) * t,
  }, false, poseTween.navParked, true);
  if (t >= 1) {
    poseTween = null;
    return;
  }
  poseRaf = requestAnimationFrame(stepPoseTween);
}

function startPoseTween(to, durationMs, navParked) {
  // from 取「上一帧真正画出去的位姿」，补间被新帧打断时才不会回跳
  poseTween = {
    from: renderPose,
    to,
    startMs: nowMs(),
    durationMs,
    navParked,
  };
  if (!poseRaf) poseRaf = requestAnimationFrame(stepPoseTween);
}

function applyDisplayState(display, forceCamera) {
  if (!display || !display.location) return;
  lastDisplay = display;
  if (MapLayers && typeof MapLayers.updateKnnRawMarker === 'function') {
    MapLayers.updateKnnRawMarker(
      map,
      display.knnRawLocation,
      !!display.showKnnRaw,
    );
  }
  const target = {
    lon: Number(display.location.longitude),
    lat: Number(display.location.latitude),
    hdg: Number(display.heading) || 0,
    cam: Number(display.cameraBearing) || 0,
    prog: Number(display.progressMeters) || 0,
  };
  if (!Number.isFinite(target.lon) || !Number.isFinite(target.lat)) return;

  // 续航后上一段残留大 prog 套到新短线上会把 remaining 切到终点 → 蓝线闪一下消失
  const routeTotal = routeMetrics && routeMetrics.total > 0 ? routeMetrics.total : 0;
  if (routeTotal > 0 && target.prog > routeTotal + 5) {
    camDiag('progSTALE',
      `${target.prog.toFixed(1)} > total ${routeTotal.toFixed(1)} → 0`);
    target.prog = 0;
  } else if (promoteGuardUntilMs && nowMs() < promoteGuardUntilMs && routeTotal > 0) {
    if (target.prog > Math.max(8, routeTotal * 0.35)) {
      camDiag('progGUARD',
        `${target.prog.toFixed(1)} too large in guard → 0 (total ${routeTotal.toFixed(1)})`);
      target.prog = 0;
    }
  }

  const recvMs = nowMs();
  const gapMs = lastPoseRecvMs > 0 ? recvMs - lastPoseRecvMs : 0;
  lastPoseRecvMs = recvMs;
  const jumpM = renderPose
    ? window.NavGeo.distanceMeters(
      { latitude: renderPose.lat, longitude: renderPose.lon },
      display.location,
    )
    : Infinity;
  const prevProg = renderPose ? renderPose.prog : -1;
  const progDelta = prevProg >= 0 ? target.prog - prevProg : 0;

  // 进度回退或大跳变：必打日志（这就是「被拉回」的直接证据）
  if (prevProg >= 0 && (progDelta < -0.5 || jumpM > 5)) {
    camDiag('applyDisplay',
      `prevProg=${prevProg.toFixed(1)}→${target.prog.toFixed(1)} dProg=${progDelta.toFixed(1)}`
      + ` jumpM=${Number.isFinite(jumpM) ? jumpM.toFixed(1) : 'inf'}`
      + ` force=${!!forceCamera} gapMs=${Math.round(gapMs)}`
      + ` dispNav=${!!display.navigating} rc=${!!display.recenter}`);
  }

  if (forceCamera || !renderPose || jumpM > POSE_TWEEN_MAX_JUMP_M) {
    if (forceCamera || jumpM > POSE_TWEEN_MAX_JUMP_M) {
      camDiag('snapPose',
        `force=${!!forceCamera} jumpM=${Number.isFinite(jumpM) ? jumpM.toFixed(1) : 'inf'}`
        + ` prog=${target.prog.toFixed(1)}`);
    }
    cancelPoseTween();
    drawPose(target, forceCamera, display.navParked, false);
    return;
  }
  const durationMs = Math.max(
    POSE_TWEEN_MIN_MS,
    Math.min(gapMs || POSE_TWEEN_MIN_MS, POSE_TWEEN_MAX_MS),
  );
  startPoseTween(target, durationMs, display.navParked);
}

function syncNavStateFromDisplay(display) {
  if (!display) return;
  const wasNav = navigating;
  navigating = !!display.navigating;
  if (navigating !== wasNav) {
    camDiag('navFlag', `was=${wasNav} → ${navigating}`);
    applyNavCameraPadding();
  }
}

function recenterCamera(preferDisplay) {
  if (!map) return;
  const d = preferDisplay || lastDisplay;
  if (d && d.location) {
    camDiag('recenter→display',
      `prog=${Number(d.progressMeters || 0).toFixed(1)} nav=${!!d.navigating}`);
    lastCameraTarget = null;
    lastCameraBearing = null;
    applyDisplayState(d, true);
    return;
  }
  if (navigating || (renderPose && renderPose.prog > 0.5)) {
    camDiag('recenter→start BLOCKED',
      `reason=${navigating ? 'navigating' : 'prog>0.5'}`);
    return;
  }
  camDiag('recenter→start APPLY', 'easeTo routeStart 300ms');
  if (routePoints.length >= 1) {
    map.easeTo({ ...routeStartCameraOptions(), duration: 300 }, CAMERA_EVENT_DATA);
  }
}

function resolveHashMapId(meta) {
  if (!meta) return '';
  const sm = String(meta.switchMap || '').trim();
  if (sm) return sm;
  return String(meta.activeMap || '').trim();
}

function onDisplayFromHash(forceCamera) {
  if (!window.DisplayBridge) return;
  const rawHash = window.location.hash || '';
  const meta = window.DisplayBridge.decodeDisplayMeta(rawHash);
  const junc = (Number.isFinite(meta.jlat) && Number.isFinite(meta.jlon))
    ? { latitude: meta.jlat, longitude: meta.jlon }
    : null;

  const wantMap = resolveHashMapId(meta);

  if (meta.promoteBlue || meta.promote || meta.reloadRoute || meta.switchMap || meta.activeMap || forceCamera) {
    camDiag('hashRecv',
      `force=${!!forceCamera} promoteBlue=${!!meta.promoteBlue} promote=${!!meta.promote}`
      + ` reload=${!!meta.reloadRoute} switchMap=${meta.switchMap || '-'} activeMap=${meta.activeMap || '-'}`
      + ` al=${meta.promoteActiveLen || 0}`
      + ` junc=${fmtLL(junc)} hasDisp=${!!meta.display}`
      + ` prog=${meta.display ? Number(meta.display.progressMeters || 0).toFixed(1) : '-'}`
      + ` hashHead=${rawHash.slice(0, 120)}`);
  }

  if (wantMap && String(wantMap) !== String(activeMapId)) {
    switchVisibleMap(wantMap);
  }

  const runPromote = async () => {
    camDiag('hashPromoteBlue',
      `al=${meta.promoteActiveLen || '-'} grayWas=${previewPoints.length}`
      + ` allPts=${allRoutePoints.length} blueWas=${routeEnds(routePoints)}`
      + ` grayWasEnds=${routeEnds(previewPoints)} switch=${meta.switchMap || '-'}`);
    let ok = false;
    if (meta.switchMap) {
      ok = await reloadRouteInPlace(meta.promoteActiveLen, junc);
    } else {
      ok = promotePreviewToBlue(meta.promoteActiveLen, junc);
      if (!ok) ok = await reloadRouteInPlace(meta.promoteActiveLen, junc);
    }
    if (ok && map && routePoints.length >= 2) {
      MapLayers.updateRouteProgressByMeters(map, routePoints, 0, routeMetrics);
    }
    camDiag('hashPromoteBlue done',
      `ok=${ok} blue=${routeEnds(routePoints)} gray=${routeEnds(previewPoints)}`
      + ` total=${(routeMetrics.total || 0).toFixed(1)}`);
    return ok;
  };

  const applyDisplay = () => {
    const display = meta.display;
    const force = !!forceCamera || meta.recenter;
    if (meta.recenter || forceCamera) {
      camDiag('hash',
        `forceCam=${!!forceCamera} rc=${!!meta.recenter}`
        + ` hasDisp=${!!display}`
        + ` prog=${display ? Number(display.progressMeters || 0).toFixed(1) : '-'}`
        + ` hashLen=${(window.location.hash || '').length}`);
    }
    if (display) syncNavStateFromDisplay(display);
    if (meta.recenter) recenterCamera(display);
    if (!display) return;
    applyDisplayState(display, force);
  };

  if (meta.promoteBlue || meta.promote || meta.reloadRoute || meta.switchMap) {
    // 必须先换线再贴位姿，否则 prog=0 会把「已走旧段」整段涂回蓝色
    Promise.resolve(runPromote()).then((ok) => {
      if (!ok) {
        camDiag('hashPromoteBlue SKIP display', '换线失败，避免 prog=0 涂旧蓝线');
        return;
      }
      applyDisplay();
    }).catch((e) => {
      console.warn('promoteBlue failed', e);
    });
    return;
  }
  applyDisplay();
}

async function loadParkingLabelIcons(mapInstance, mapId) {
  const mid = mapId || MAP_ID;
  try {
    const url = `${API_BASE}/api/maps/${encodeURIComponent(mid)}/label-index`;
    const res = await fetch(url);
    if (!res.ok) return;
    const labelMap = await res.json();
    MapLayersUtil.registerParkingLabelIcons(mapInstance, labelMap);
  } catch (e) {
    console.warn('loadParkingLabelIcons failed', mid, e);
  }
}

async function loadStructurePoints(mapInstance, mapId) {
  if (!STRUCTURE_3D_ENABLED || !window.Structure3D || !mapInstance) return;
  const mid = mapId || activeMapId || MAP_ID;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null;
  try {
    const url = `${API_BASE}/api/maps/${encodeURIComponent(mid)}/special-points`;
    const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const raw = Array.isArray(body) ? body : body && body.data;
    const points = (Array.isArray(raw) ? raw : [])
      .filter((point) => point && String(point.mapId || point.map_id || mid) === String(mid))
      .slice(0, STRUCTURE_MAX_POINTS);
    const count = Structure3D.ensureStructureLayer(mapInstance, maplibregl, points, {
      onModelError(type, error) {
        postToMiniProgram({
          type: 'structure3dError',
          modelType: type,
          message: String((error && error.message) || error || 'GLB load failed').slice(0, 160),
        });
      },
    });
    console.info(`[structure-3d] map=${mid} points=${count}`);
    postToMiniProgram({ type: 'structure3dReady', mapId: mid, count });
  } catch (error) {
    console.warn('[structure-3d] 点位加载失败', error);
    postToMiniProgram({
      type: 'structure3dError',
      message: String((error && error.message) || error || 'special-points failed').slice(0, 160),
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function scheduleStructureLoad(mapInstance) {
  if (!STRUCTURE_3D_ENABLED || !window.Structure3D) return;
  if (structureLoadTimer) clearTimeout(structureLoadTimer);
  structureLoadTimer = setTimeout(() => {
    structureLoadTimer = null;
    loadStructurePoints(mapInstance, activeMapId);
  }, STRUCTURE_DEFER_MS);
}

function ensureExtraParkingMaps() {
  if (!map || !window.MapLayers || !MapLayers.addHiddenParkingMap) return;
  const extras = MAP_IDS.filter((id) => id && String(id) !== String(MAP_ID));
  console.info(`[CamDiag] ensureExtraParkingMaps primary=${MAP_ID} extras=${extras.join(',') || '-'}`);
  extras.forEach((id) => {
    const src = MapLayers.addHiddenParkingMap(map, {
      mapId: id,
      tilesUrl: tilesUrlForMap(id),
      primaryMapId: MAP_ID,
    });
    const n = MapLayers.parkingLayersForMap
      ? MapLayers.parkingLayersForMap(map, id, MAP_ID).length
      : -1;
    console.info(`[CamDiag] preloaded map=${id} source=${src || '-'} layers=${n}`);
    loadParkingLabelIcons(map, id);
  });
  if (typeof MapLayers.ensureUserPuckOnTop === 'function') {
    MapLayers.ensureUserPuckOnTop(map);
  }
}

function switchVisibleMap(nextMapId) {
  const want = String(nextMapId || '').trim();
  if (!want || !map || want === String(activeMapId)) return;
  const prev = activeMapId;
  // 切到未预挂载的图：现场补源（兼容旧链接无 map_ids）
  if (String(want) !== String(MAP_ID)
    && window.MapLayers
    && MapLayers.parkingSourceId
    && !map.getSource(MapLayers.parkingSourceId(want, MAP_ID))) {
    if (MapLayers.addHiddenParkingMap) {
      MapLayers.addHiddenParkingMap(map, {
        mapId: want,
        tilesUrl: tilesUrlForMap(want),
        primaryMapId: MAP_ID,
      });
      loadParkingLabelIcons(map, want);
      camDiag('switchMap addSource', want);
    }
  }
  let nHide = 0;
  let nShow = 0;
  if (MapLayers.setParkingMapVisible) {
    nHide = MapLayers.setParkingMapVisible(map, prev, false, MAP_ID) || 0;
    nShow = MapLayers.setParkingMapVisible(map, want, true, MAP_ID) || 0;
  }
  // 兜底：克隆层未就绪时再补挂一次 hidden source
  if (nShow === 0 && String(want) !== String(MAP_ID) && MapLayers.addHiddenParkingMap) {
    MapLayers.addHiddenParkingMap(map, {
      mapId: want,
      tilesUrl: tilesUrlForMap(want),
      primaryMapId: MAP_ID,
    });
    loadParkingLabelIcons(map, want);
    nHide = MapLayers.setParkingMapVisible(map, prev, false, MAP_ID) || nHide;
    nShow = MapLayers.setParkingMapVisible(map, want, true, MAP_ID) || 0;
    if (nShow === 0) {
      console.warn(`[switchMap] showLayers still 0 map=${want} prev=${prev}`);
    }
  }
  activeMapId = want;
  try { sessionStorage.setItem(`navActiveMap:${SESSION_ID}`, want); } catch (e) { /* ignore */ }
  if (NAV_FLOW === 'PARKING_ENTRY' && SPACE_ID && MapLayers.highlightTargetSpace) {
    const src = MapLayers.parkingSourceId(want, MAP_ID);
    const above = MapLayers.parkingLayerId('parking-fill', want, MAP_ID);
    MapLayers.highlightTargetSpace(map, SPACE_ID, src, above);
  }
  if (typeof MapLayers.ensureUserPuckOnTop === 'function') {
    MapLayers.ensureUserPuckOnTop(map);
  }
  if (window.Structure3D && Structure3D.removeStructureLayer) {
    try { Structure3D.removeStructureLayer(map); } catch (e) { /* ignore */ }
  }
  loadStructurePoints(map, want);
  camDiag('switchMap', `${prev} → ${want} hideLayers=${nHide} showLayers=${nShow}`);
}

const JUNCTION_1005_LAYER_IDS = [
  'junction-1005-fill',
  'junction-1005-edge',
  'junction-label',
];

function setJunction1005Visible(mapInstance, visible) {
  if (!mapInstance || !mapInstance.getStyle) return;
  const vis = visible ? 'visible' : 'none';
  const layers = (mapInstance.getStyle().layers || []);
  layers.forEach((layer) => {
    if (!layer || !layer.id) return;
    const hit = JUNCTION_1005_LAYER_IDS.some((id) => (
      layer.id === id || layer.id.indexOf(`${id}__`) === 0
    ));
    if (hit && mapInstance.getLayer(layer.id)) {
      mapInstance.setLayoutProperty(layer.id, 'visibility', vis);
    }
  });
}

/** 单图场站不渲染 sType=1005（楼层交界面/边/标注）；多图才显示。 */
async function applyJunction1005Visibility(mapInstance) {
  let count = LOT_MAP_COUNT;
  if (!count && PARKING_LOT_ID) {
    try {
      const url = `${API_BASE}/api/maps?parking_lot_id=${encodeURIComponent(PARKING_LOT_ID)}`;
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json();
        const arr = Array.isArray(body) ? body : (body && body.data);
        count = Array.isArray(arr) ? arr.length : 0;
      }
    } catch (e) {
      console.warn('lot map count fetch failed', e);
    }
  }
  if (!count) return;
  setJunction1005Visible(mapInstance, count > 1);
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
  // 已知单图时在创建 Map 前关掉 1005，避免首帧闪一下交界面
  if (LOT_MAP_COUNT === 1 && Array.isArray(style.layers)) {
    JUNCTION_1005_LAYER_IDS.forEach((id) => {
      const layer = style.layers.find((l) => l && l.id === id);
      if (layer) {
        layer.layout = Object.assign({}, layer.layout || {}, { visibility: 'none' });
      }
    });
  }

  map = new maplibregl.Map({
    container: 'map',
    style,
    center,
    zoom: T.NAV_ZOOM,
    maxZoom: 21,
    minZoom: 16,
    pitch: T.NAV_PITCH,
    // 图纸 CRS：bearing 0 = 图北朝上。MAP_BEARING 是罗盘偏移，不能当初始相机角。
    bearing: 0,
    antialias: true,
    attributionControl: false,
  });

  map.on('load', async () => {
    try {
      MapLayersUtil.registerPoiIcons(map);
      MapLayersUtil.registerNavArrowIcon(map);
      MapLayersUtil.registerUserHeadingIcon(map);
      MapLayers.restackPoiLayers(map);
      ensureExtraParkingMaps();
      await loadParkingLabelIcons(map);
      await applyJunction1005Visibility(map);
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
        // 跨图后瓦片慢：idle 常落在已走一大段之后。此处禁止任何 jumpTo/easeTo，
        // 否则会把镜头拽回本图 route[0]，下一帧 hash 再追蓝点。
        map.once('idle', () => {
          const c = map.getCenter && map.getCenter();
          camDiag('map.idle',
            `noJump hasDisp=${!!(lastDisplay && lastDisplay.location)}`
            + ` hasPose=${!!renderPose} nav=${navigating}`
            + ` center=${c ? `${c.lat.toFixed(6)},${c.lng.toFixed(6)}` : '-'}`);
          if (c) logIfCameraYank('map.idle.center', c.lng, c.lat);
          map.resize();
          applyNavCameraPadding();
          if (WAYPOINT) MapLayers.ensureWaypointPinLayer(map, WAYPOINT);
        });
        camDiag('map.load',
          `routePts=${routePoints.length} mapId=${MAP_ID} ${routeEnds(routePoints)}`
          + ` gray=${routeEnds(previewPoints)}`);
        if (window.NavDebug) NavDebug.reportRouteState(map, routePoints, {
          hasRoute: true,
          previewLen: previewPoints.length,
          activeLen: routePoints.length,
        });
      } else {
        map.flyTo({
          center: mapCenter,
          zoom: T.NAV_ZOOM,
          pitch: T.NAV_PITCH,
          bearing: 0,
          duration: 0,
        }, CAMERA_EVENT_DATA);
      }
      postToMiniProgram({ type: 'h5Ready', routeOk: hasRoute });
      onDisplayFromHash(true);
      // 不阻塞路线与蓝点首屏；复用 MapLibre 的 WebGL context 延后挂载结构物。
      scheduleStructureLoad(map);
    } catch (e) {
      if (window.NavDebug) NavDebug.logError('map.on(load)', e);
      showMapLoadError(e);
    }
  });

  map.on('dragstart', markUserMapInteracting);
  map.on('zoomstart', markUserMapInteracting);
  map.on('rotatestart', markUserMapInteracting);
  map.on('pitchstart', markUserMapInteracting);
  // 标牌尺寸只跟 zoom 走。绑 move 会被每帧的相机更新打中，
  // 导致 setLayoutProperty 每帧重建 symbol bucket。
  map.on('zoom', scheduleParkingLabelRefresh);
  map.on('zoomend', scheduleParkingLabelRefresh);
  map.getCanvas().addEventListener('webglcontextlost', () => {
    console.warn('[structure-3d] WebGL context lost');
    postToMiniProgram({ type: 'structure3dContextLost', mapId: MAP_ID });
  });
  map.getCanvas().addEventListener('webglcontextrestored', () => {
    console.info('[structure-3d] WebGL context restored');
    postToMiniProgram({ type: 'structure3dContextRestored', mapId: MAP_ID });
  });

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
