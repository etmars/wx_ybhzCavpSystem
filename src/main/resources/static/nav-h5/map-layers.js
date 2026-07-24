/** 对齐 Android addRenderLayers / ensureNavRouteLayers / ensureUserLocationLayers */

/** 货梯 sType=3、客梯 sType=4 — 约为通用 POI 的 1/6 */
const POI_ELEVATOR_STYPE = ['any',
  ['==', ['to-number', ['get', 'sType']], 3],
  ['==', ['to-number', ['get', 'sType']], 4],
];

/** 不出入口类图标：出入口 sType=10、出口=29、入口=30 */
const POI_LAYER_FILTER = ['!', ['in', ['to-number', ['get', 'sType']], ['literal', [10, 29, 30]]]];

const POI_ICON_SIZE_EXPR = [
  'interpolate', ['linear'], ['zoom'],
  16, ['case', POI_ELEVATOR_STYPE, 0.075, 0.45],
  18, ['case', POI_ELEVATOR_STYPE, 0.092, 0.55],
  20, ['case', POI_ELEVATOR_STYPE, 0.108, 0.65],
  22, ['case', POI_ELEVATOR_STYPE, 0.125, 0.75],
];

function insertStyleLayerAfter(style, layer, afterId) {
  const idx = style.layers.findIndex((l) => l.id === afterId);
  if (idx >= 0) {
    style.layers.splice(idx + 1, 0, layer);
  } else {
    style.layers.push(layer);
  }
}

function insertStyleLayerBefore(style, layer, beforeId) {
  const idx = style.layers.findIndex((l) => l.id === beforeId);
  if (idx >= 0) {
    style.layers.splice(idx, 0, layer);
  } else {
    style.layers.push(layer);
  }
}

function addExtraStyleLayers(style) {
  // 对齐 Android：箭头 -> POI -> 障碍物 -> 墙体 -> 车位标签（POI 在墙下以便被遮挡）
  if (!style.layers.some((l) => l.id === 'poi-layer')) {
    const poiLayer = {
      id: 'poi-layer',
      type: 'symbol',
      source: 'parking-source',
      'source-layer': 'poi',
      filter: POI_LAYER_FILTER,
      layout: {
        'icon-image': ['concat', 'poi-', ['get', 'sType']],
        'icon-size': POI_ICON_SIZE_EXPR,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-pitch-alignment': 'map',
      },
    };
    if (style.layers.some((l) => l.id === 'blocker-100202-extrusion')) {
      insertStyleLayerBefore(style, poiLayer, 'blocker-100202-extrusion');
    } else if (style.layers.some((l) => l.id === 'wall-1000-extrusion')) {
      insertStyleLayerBefore(style, poiLayer, 'wall-1000-extrusion');
    } else {
      insertStyleLayerAfter(style, poiLayer, 'arrow-1001-fill');
    }
  }
  if (!style.layers.some((l) => l.id === 'parking-label')) {
    const parkingLabelLayer = {
      id: 'parking-label',
      type: 'symbol',
      source: 'parking-source',
      'source-layer': 'parking_label',
      layout: {
        'icon-image': ['get', 'icon_id'],
        'icon-size': 0.22,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };
    insertStyleLayerAfter(style, parkingLabelLayer, 'wall-1000-extrusion');
  }
}

function lineFeature(coords) {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords },
  };
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

/** MapLibre GL JS 等价 Android Style.addLayerAbove */
function addLayerAbove(map, layer, aboveId) {
  if (!aboveId || !map.getLayer(aboveId)) {
    map.addLayer(layer);
    return;
  }
  const layers = map.getStyle().layers;
  const idx = layers.findIndex((l) => l.id === aboveId);
  if (idx < 0 || idx >= layers.length - 1) {
    map.addLayer(layer);
  } else {
    map.addLayer(layer, layers[idx + 1].id);
  }
}

function moveLayerAbove(map, layerId, aboveId) {
  if (!map.getLayer(layerId) || !map.getLayer(aboveId)) return;
  const layers = map.getStyle().layers;
  const idx = layers.findIndex((l) => l.id === aboveId);
  if (idx < 0) return;
  if (idx >= layers.length - 1) {
    try { map.moveLayer(layerId); } catch (e) { /* ignore */ }
  } else {
    try { map.moveLayer(layerId, layers[idx + 1].id); } catch (e) { /* ignore */ }
  }
}

/** 路线箭头 icon-size — 64px 位图在 10px 线宽上需缩小 */
const NAV_ROUTE_ARROW_ICON_SIZE = 0.38;

const ROUTE_LINE_LAYOUT = { 'line-cap': 'round', 'line-join': 'round' };
/** 已走段：round；未走段必须 butt —— round 帽会以切分点为圆心向后伸出半个线宽，
 * 看起来像定位球后方始终拖着一截未变灰的亮色尾迹（与 Android 一致）。 */
const ROUTE_TRAVELED_LAYOUT = { 'line-cap': 'round', 'line-join': 'round' };
const ROUTE_REMAINING_LAYOUT = { 'line-cap': 'butt', 'line-join': 'round' };

/** POI 须在墙体之下，对齐 Android addRenderLayers 图层顺序 */
function restackPoiLayers(map) {
  if (!map.getLayer('poi-layer')) return;
  if (map.getLayer('arrow-1001-fill')) {
    moveLayerAbove(map, 'poi-layer', 'arrow-1001-fill');
  }
  if (map.getLayer('blocker-100202-extrusion')) {
    const layers = map.getStyle().layers;
    const blockerIdx = layers.findIndex((l) => l.id === 'blocker-100202-extrusion');
    const poiIdx = layers.findIndex((l) => l.id === 'poi-layer');
    if (blockerIdx >= 0 && poiIdx > blockerIdx) {
      try { map.moveLayer('poi-layer', 'blocker-100202-extrusion'); } catch (e) { /* ignore */ }
    }
  }
  if (map.getLayer('parking-label') && map.getLayer('wall-1000-extrusion')) {
    moveLayerAbove(map, 'parking-label', 'wall-1000-extrusion');
  }
}

/** 路线必须在 arrow-1001-fill(sType=1001) 之上，顺序对齐 ensureNavLayers + renderPreplannedRoute */
function restackNavRouteLayers(map) {
  if (!map.getLayer('arrow-1001-fill')) return;
  [
    ['nav-route-casing', 'arrow-1001-fill'],
    ['nav-route-traveled', 'nav-route-casing'],
    ['nav-route-line', 'nav-route-traveled'],
    ['nav-route-end-layer', 'nav-route-line'],
    ['nav-direction-arrows-layer', 'nav-route-line'],
  ].forEach(([layerId, aboveId]) => moveLayerAbove(map, layerId, aboveId));
}

function restackUserPuckLayers(map) {
  if (!map.getLayer('parking-label')) return;
  // 对齐 Android：halo → 光束 → 实心圆点（core 盖住锥体根部，向前扇形仍可见）
  [
    ['user-loc-halo', 'parking-label'],
    ['user-loc-heading-layer', 'user-loc-halo'],
    ['user-loc-layer', 'user-loc-heading-layer'],
  ].forEach(([layerId, aboveId]) => moveLayerAbove(map, layerId, aboveId));
}

function ensureUserPuckOnTop(map) {
  restackUserPuckLayers(map);
  restackNavRouteLayers(map);
  // 蓝点先置顶，再把 KNN 橙点盖在蓝点之上——两坐标常几乎重合，橙点在下会被完全挡住
  ['user-loc-halo', 'user-loc-heading-layer', 'user-loc-layer'].forEach((id) => {
    if (map.getLayer(id)) {
      try { map.moveLayer(id); } catch (e) { /* ignore */ }
    }
  });
  ['knn-raw-halo', 'knn-raw-layer', 'knn-raw-label'].forEach((id) => {
    if (map.getLayer(id)) {
      try { map.moveLayer(id); } catch (e) { /* ignore */ }
    }
  });
}

const KNN_RAW_COLOR = '#FF7A00';

/**
 * 确保 KNN 原始定位点图层存在（橙点 + 标签，与蓝色导航 puck 区分）
 */
function ensureKnnRawMarkerLayers(map) {
  if (!map) return;
  if (!map.getSource('knn-raw-source')) {
    map.addSource('knn-raw-source', { type: 'geojson', data: EMPTY_FC });
  }
  if (!map.getLayer('knn-raw-halo')) {
    addLayerAbove(map, {
      id: 'knn-raw-halo',
      type: 'circle',
      source: 'knn-raw-source',
      paint: {
        'circle-radius': 18,
        'circle-color': KNN_RAW_COLOR,
        'circle-opacity': 0.28,
        'circle-stroke-width': 0,
        'circle-pitch-alignment': 'viewport',
        'circle-pitch-scale': 'viewport',
      },
    }, 'parking-label');
  }
  if (!map.getLayer('knn-raw-layer')) {
    addLayerAbove(map, {
      id: 'knn-raw-layer',
      type: 'circle',
      source: 'knn-raw-source',
      paint: {
        'circle-radius': 8,
        'circle-color': KNN_RAW_COLOR,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5,
        'circle-opacity': 1,
        'circle-pitch-alignment': 'viewport',
        'circle-pitch-scale': 'viewport',
      },
    }, 'knn-raw-halo');
  }
  if (!map.getLayer('knn-raw-label')) {
    addLayerAbove(map, {
      id: 'knn-raw-label',
      type: 'symbol',
      source: 'knn-raw-source',
      layout: {
        'text-field': 'KNN',
        'text-size': 12,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-pitch-alignment': 'viewport',
        'text-rotation-alignment': 'viewport',
      },
      paint: {
        'text-color': KNN_RAW_COLOR,
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    }, 'knn-raw-layer');
  }
}

/**
 * 更新 / 隐藏 KNN 原始定位点。show=false 或无坐标时清空。
 */
function updateKnnRawMarker(map, loc, show) {
  if (!map) return;
  ensureKnnRawMarkerLayers(map);
  const src = map.getSource('knn-raw-source');
  if (!src) return;
  if (!show || !loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
    src.setData(EMPTY_FC);
    return;
  }
  src.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [loc.longitude, loc.latitude] },
      properties: {},
    }],
  });
  ensureUserPuckOnTop(map);
}

const PUCK_HALO_COLOR = 'rgba(62, 134, 236, 0.2)'; // Android puck_halo #333E86EC (AARRGGBB)

/** 与 Android iconSize(1.18f) 一致；pitch 用 viewport 时视觉长度才与圆点对齐 */
const USER_HEADING_ICON_SIZE = 1.18;
const PUCK_CIRCLE_PAINT = {
  'circle-pitch-alignment': 'viewport',
  'circle-pitch-scale': 'map',
};

function ensureUserPuckLayers(map, seedLngLat, seedBearing) {
  const coords = seedLngLat || [0, 0];
  const bearing = seedBearing || 0;
  const seed = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: { bearing },
  };
  if (!map.getSource('user-loc-source')) {
    map.addSource('user-loc-source', { type: 'geojson', data: seed });
  } else {
    map.getSource('user-loc-source').setData(seed);
  }

  // 对齐 ensureUserLocationLayers：halo → heading 光束 → 实心圆点
  if (!map.getLayer('user-loc-halo')) {
    addLayerAbove(map, {
      id: 'user-loc-halo',
      type: 'circle',
      source: 'user-loc-source',
      paint: {
        'circle-radius': 22,
        'circle-color': PUCK_HALO_COLOR,
        'circle-opacity': 1,
        'circle-stroke-width': 0,
        ...PUCK_CIRCLE_PAINT,
      },
    }, 'parking-label');
  }
  if (!map.getLayer('user-loc-heading-layer')) {
    addLayerAbove(map, {
      id: 'user-loc-heading-layer',
      type: 'symbol',
      source: 'user-loc-source',
      layout: {
        'icon-image': 'user-loc-heading',
        'icon-size': USER_HEADING_ICON_SIZE,
        'icon-anchor': 'center',
        'icon-rotate': ['get', 'bearing'],
        // 对齐 Android ICON_ROTATION_ALIGNMENT_MAP：bearing 为真北
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    }, 'user-loc-halo');
  }
  if (!map.getLayer('user-loc-layer')) {
    addLayerAbove(map, {
      id: 'user-loc-layer',
      type: 'circle',
      source: 'user-loc-source',
      paint: {
        'circle-radius': 8,
        'circle-color': '#3E86EC',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
        'circle-opacity': 1,
        ...PUCK_CIRCLE_PAINT,
      },
    }, 'user-loc-heading-layer');
  }
  if (map.getLayer('user-loc-halo')) {
    map.setPaintProperty('user-loc-halo', 'circle-color', PUCK_HALO_COLOR);
    map.setPaintProperty('user-loc-halo', 'circle-pitch-alignment', 'viewport');
  }
  if (map.getLayer('user-loc-layer')) {
    map.setPaintProperty('user-loc-layer', 'circle-pitch-alignment', 'viewport');
  }
  if (!map.hasImage('user-loc-heading') && window.MapLayersUtil?.registerUserHeadingIcon) {
    window.MapLayersUtil.registerUserHeadingIcon(map);
  }
  if (map.getLayer('user-loc-heading-layer')) {
    map.setLayoutProperty('user-loc-heading-layer', 'icon-pitch-alignment', 'map');
    map.setLayoutProperty('user-loc-heading-layer', 'icon-rotation-alignment', 'map');
    map.setLayoutProperty('user-loc-heading-layer', 'icon-size', USER_HEADING_ICON_SIZE);
  }
  ensureUserPuckOnTop(map);
}

function ensureNavRouteLayers(map, routePoints) {
  if (!routePoints || routePoints.length < 2) return;
  const fullCoords = routePoints.map((p) => [p.longitude, p.latitude]);
  const fullLine = lineFeature(fullCoords);
  const endPoint = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: fullCoords[fullCoords.length - 1] },
  };

  if (!map.getSource('nav-route-source')) {
    map.addSource('nav-route-source', { type: 'geojson', data: fullLine });
    map.addSource('nav-route-traveled-source', { type: 'geojson', data: EMPTY_FC });
    map.addSource('nav-route-remaining-source', { type: 'geojson', data: fullLine });
    map.addSource('nav-route-end-source', { type: 'geojson', data: endPoint });
    map.addSource('nav-direction-arrows', { type: 'geojson', data: EMPTY_FC });

    const routeBase = map.getLayer('arrow-1001-fill') ? 'arrow-1001-fill' : 'parking-edge';
    addLayerAbove(map, {
      id: 'nav-route-casing',
      type: 'line',
      source: 'nav-route-source',
      layout: ROUTE_LINE_LAYOUT,
      paint: { 'line-color': '#F7FBFF', 'line-width': 14, 'line-opacity': 0.98 },
    }, routeBase);
    addLayerAbove(map, {
      id: 'nav-route-traveled',
      type: 'line',
      source: 'nav-route-traveled-source',
      layout: ROUTE_TRAVELED_LAYOUT,
      paint: { 'line-color': 'rgba(62, 80, 96, 0.6)', 'line-width': 10, 'line-opacity': 1 },
    }, 'nav-route-casing');
    addLayerAbove(map, {
      id: 'nav-route-line',
      type: 'line',
      source: 'nav-route-remaining-source',
      layout: ROUTE_REMAINING_LAYOUT,
      paint: { 'line-color': '#3E86EC', 'line-width': 10, 'line-opacity': 1 },
    }, 'nav-route-traveled');
    addLayerAbove(map, {
      id: 'nav-route-end-layer',
      type: 'circle',
      source: 'nav-route-end-source',
      paint: {
        'circle-radius': 0,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#3E86EC',
        'circle-stroke-width': 0,
        'circle-opacity': 0,
      },
    }, 'nav-route-line');
    addLayerAbove(map, {
      id: 'nav-direction-arrows-layer',
      type: 'symbol',
      source: 'nav-direction-arrows',
      layout: {
        'icon-image': 'nav-arrow-icon',
        'icon-size': NAV_ROUTE_ARROW_ICON_SIZE,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    }, 'nav-route-line');
  } else {
    map.getSource('nav-route-source').setData(fullLine);
    map.getSource('nav-route-remaining-source').setData(fullLine);
    map.getSource('nav-route-end-source').setData(endPoint);
  }
  restackNavRouteLayers(map);
  updateDirectionArrows(map, routePoints);
  updateNavRouteArrowIconSize(map);
  if (map.getLayer('nav-route-line')) {
    map.setLayoutProperty('nav-route-line', 'line-cap', 'butt');
  }
  if (map.getLayer('nav-route-traveled')) {
    map.setLayoutProperty('nav-route-traveled', 'line-cap', 'round');
  }
  ensureUserPuckOnTop(map);
}

/** 对齐 updateParkingLabelSizeByZoom，H5 web-view 略小于 Android 但比旧版稍大 */
function updateParkingLabelSizeByZoom(map) {
  if (!map || !map.getLayer('parking-label')) return;
  const z = map.getZoom();
  const minZoom = 16;
  const maxZoom = 20;
  const minSize = 0.28;
  const maxSize = 0.46;
  const t = Math.max(0, Math.min(1, (z - minZoom) / (maxZoom - minZoom)));
  const size = minSize + (maxSize - minSize) * t;
  map.setLayoutProperty('parking-label', 'icon-size', size);
}

function updateNavRouteArrowIconSize(map) {
  if (!map || !map.getLayer('nav-direction-arrows-layer')) return;
  map.setLayoutProperty('nav-direction-arrows-layer', 'icon-size', NAV_ROUTE_ARROW_ICON_SIZE);
}

/** 对齐 MainActivity.renderPreplannedRoute */
function buildDirectionArrows(routePoints, maxArrows = 14) {
  const features = [];
  if (!routePoints || routePoints.length < 2) return features;
  const G = window.NavGeo;
  const stepCount = Math.min(maxArrows, routePoints.length - 1);
  for (let k = 1; k < stepCount; k += 1) {
    const idx = Math.min(
      routePoints.length - 2,
      Math.floor((k * (routePoints.length - 1)) / stepCount),
    );
    const a = routePoints[idx];
    const b = routePoints[idx + 1];
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          (a.longitude + b.longitude) / 2,
          (a.latitude + b.latitude) / 2,
        ],
      },
      properties: { bearing: G.bearingDegrees(a, b) },
    });
  }
  return features;
}

function updateDirectionArrows(map, routePoints) {
  if (!map || !map.getSource('nav-direction-arrows')) return;
  const pts = Array.isArray(routePoints) ? routePoints : [];
  map.getSource('nav-direction-arrows').setData({
    type: 'FeatureCollection',
    features: buildDirectionArrows(pts),
  });
}

function highlightTargetSpace(map, spaceId) {
  if (!spaceId || !map.getSource('parking-source')) return;
  const layerId = 'target-space-layer';
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  map.addLayer({
    id: layerId,
    type: 'fill',
    source: 'parking-source',
    'source-layer': 'parking_fill',
    filter: ['all', ['==', ['get', 'name'], spaceId]],
    paint: { 'fill-color': '#FFFFFF', 'fill-opacity': 0.45 },
  }, 'parking-fill');
}

function ensureDestPinLayer(map, destination, spaceId) {
  if (!map || !destination) return;
  const label = spaceId || '';
  const iconId = window.MapLayersUtil.registerDestPinIcon(map, label);
  const feature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [destination.longitude, destination.latitude] },
    properties: { icon_id: iconId },
  };
  if (!map.getSource('nav-dest-pin-source')) {
    map.addSource('nav-dest-pin-source', { type: 'geojson', data: feature });
    addLayerAbove(map, {
      id: 'nav-dest-pin-layer',
      type: 'symbol',
      source: 'nav-dest-pin-source',
      layout: {
        'icon-image': ['get', 'icon_id'],
        'icon-size': 0.55,
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    }, 'parking-label');
    if (map.getLayer('nav-route-end-layer')) {
      map.setLayoutProperty('nav-route-end-layer', 'visibility', 'none');
    }
  } else {
    map.getSource('nav-dest-pin-source').setData(feature);
  }
  ensureUserPuckOnTop(map);
}

/** 途径点标牌层（橙色，区别终点蓝色 P 牌）。waypoint: { lon, lat, label } */
function ensureWaypointPinLayer(map, waypoint) {
  if (!map || !waypoint) return;
  const lon = Number(waypoint.lon != null ? waypoint.lon : waypoint.longitude);
  const lat = Number(waypoint.lat != null ? waypoint.lat : waypoint.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const iconId = window.MapLayersUtil.registerWaypointPinIcon(map, waypoint.label || '途径点');
  const feature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { icon_id: iconId },
  };
  if (!map.getSource('nav-waypoint-pin-source')) {
    map.addSource('nav-waypoint-pin-source', { type: 'geojson', data: feature });
    addLayerAbove(map, {
      id: 'nav-waypoint-pin-layer',
      type: 'symbol',
      source: 'nav-waypoint-pin-source',
      layout: {
        'icon-image': ['get', 'icon_id'],
        'icon-size': 0.55,
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    }, 'parking-label');
  } else {
    map.getSource('nav-waypoint-pin-source').setData(feature);
  }
  ensureUserPuckOnTop(map);
}

function updateRouteProgressByMeters(map, routePoints, traveledMeters, metrics) {
  if (!map || routePoints.length < 2) return;
  const G = window.NavGeo;
  const m = metrics || G.buildRouteMetrics(routePoints);
  const total = m.total;
  if (total <= 0) return;
  const clamped = Math.max(0, Math.min(traveledMeters, total));
  // 与 Android 一致：按真实进度切分，不做灰线后退。
  // 尾迹问题靠未走段 line-cap=butt 解决。
  const splitPt = G.pointAtRouteDistance(routePoints, clamped, m);
  if (!splitPt) return;

  const traveled = [];
  const remaining = [];
  let inserted = false;
  for (let i = 0; i < routePoints.length; i += 1) {
    const cum = m.cumulative[i] || 0;
    const p = routePoints[i];
    if (cum < clamped - 1e-6) {
      traveled.push([p.longitude, p.latitude]);
    } else {
      if (!inserted) {
        traveled.push([splitPt.longitude, splitPt.latitude]);
        remaining.push([splitPt.longitude, splitPt.latitude]);
        inserted = true;
      }
      remaining.push([p.longitude, p.latitude]);
    }
  }
  if (!inserted) {
    traveled.length = 0;
    routePoints.forEach((p) => traveled.push([p.longitude, p.latitude]));
    const last = routePoints[routePoints.length - 1];
    remaining.length = 0;
    remaining.push([last.longitude, last.latitude]);
  }

  const traveledSrc = map.getSource('nav-route-traveled-source');
  const remainingSrc = map.getSource('nav-route-remaining-source');
  if (!traveledSrc || !remainingSrc) return;
  traveledSrc.setData(traveled.length >= 2 ? lineFeature(traveled) : EMPTY_FC);
  remainingSrc.setData(remaining.length >= 2 ? lineFeature(remaining) : lineFeature(routePoints.map((p) => [p.longitude, p.latitude])));
  if (remaining.length >= 2) {
    const remainingPts = remaining.map(([lon, lat]) => ({ longitude: lon, latitude: lat }));
    updateDirectionArrows(map, remainingPts);
  } else {
    updateDirectionArrows(map, routePoints);
  }
}

function updateRouteProgress(map, routePoints, progressPct) {
  const m = window.NavGeo.buildRouteMetrics(routePoints);
  updateRouteProgressByMeters(map, routePoints, (progressPct / 100) * m.total, m);
}

window.MapLayers = {
  addExtraStyleLayers,
  addLayerAbove,
  restackPoiLayers,
  ensureUserPuckLayers,
  ensureUserPuckOnTop,
  ensureKnnRawMarkerLayers,
  updateKnnRawMarker,
  ensureNavRouteLayers,
  buildDirectionArrows,
  updateDirectionArrows,
  updateParkingLabelSizeByZoom,
  updateNavRouteArrowIconSize,
  highlightTargetSpace,
  ensureDestPinLayer,
  ensureWaypointPinLayer,
  updateRouteProgress,
  updateRouteProgressByMeters,
};
