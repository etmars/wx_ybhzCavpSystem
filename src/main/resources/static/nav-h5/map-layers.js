/** 对齐 Android addRenderLayers / ensureNavRouteLayers / highlightTargetSpace */

function addExtraStyleLayers(style) {
  if (!style.layers.some((l) => l.id === 'poi-layer')) {
    style.layers.push({
      id: 'poi-layer',
      type: 'symbol',
      source: 'parking-source',
      'source-layer': 'poi',
      layout: {
        'icon-image': ['concat', 'poi-', ['get', 'sType']],
        'icon-size': 0.9,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }
  if (!style.layers.some((l) => l.id === 'parking-label')) {
    style.layers.push({
      id: 'parking-label',
      type: 'symbol',
      source: 'parking-source',
      'source-layer': 'parking_label',
      layout: {
        'icon-image': ['get', 'icon_id'],
        'icon-size': 0.72,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
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

/** 对齐 Android：路线插在 parking-edge 之上、坡道层之下 */
function routeStackBeforeId(map) {
  if (map.getLayer('road-2005-ramp-fill')) return 'road-2005-ramp-fill';
  if (map.getLayer('parking-edge')) return 'parking-edge';
  if (map.getLayer('parking-label')) return 'parking-label';
  return undefined;
}

const ROUTE_LINE_LAYOUT = { 'line-cap': 'round', 'line-join': 'round' };

function addRouteLineLayer(map, layer, beforeId) {
  try {
    map.addLayer(layer, beforeId);
  } catch (e) {
    console.warn('addRouteLineLayer fallback', layer.id, e);
    map.addLayer(layer);
  }
}

/** puck 必须在 parking-label 之上（Android ensureUserLocationLayers） */
function puckStackBeforeId(map) {
  if (map.getLayer('parking-label')) return 'parking-label';
  return undefined;
}

function ensureUserPuckOnTop(map) {
  ['user-loc-halo', 'user-loc-heading-layer', 'user-loc-layer'].forEach((id) => {
    if (map.getLayer(id)) {
      try { map.moveLayer(id); } catch (e) { /* ignore */ }
    }
  });
}

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
  const beforeId = puckStackBeforeId(map);
  if (!map.getLayer('user-loc-halo')) {
    const layer = {
      id: 'user-loc-halo',
      type: 'circle',
      source: 'user-loc-source',
      paint: { 'circle-radius': 22, 'circle-color': '#3E86EC', 'circle-opacity': 0.2 },
    };
    if (beforeId) addRouteLineLayer(map, layer, beforeId);
    else map.addLayer(layer);
  }
  if (!map.getLayer('user-loc-heading-layer')) {
    const layer = {
      id: 'user-loc-heading-layer',
      type: 'symbol',
      source: 'user-loc-source',
      layout: {
        'icon-image': 'user-loc-heading',
        'icon-size': 1.18,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    };
    if (map.getLayer('user-loc-halo')) addRouteLineLayer(map, layer, 'user-loc-halo');
    else if (beforeId) addRouteLineLayer(map, layer, beforeId);
    else map.addLayer(layer);
  }
  if (!map.getLayer('user-loc-layer')) {
    const layer = {
      id: 'user-loc-layer',
      type: 'circle',
      source: 'user-loc-source',
      paint: {
        'circle-radius': 8,
        'circle-color': '#3E86EC',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    };
    if (map.getLayer('user-loc-heading-layer')) addRouteLineLayer(map, layer, 'user-loc-heading-layer');
    else if (beforeId) addRouteLineLayer(map, layer, beforeId);
    else map.addLayer(layer);
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
    const beforeId = routeStackBeforeId(map);
    map.addSource('nav-route-source', { type: 'geojson', data: fullLine });
    map.addSource('nav-route-traveled-source', { type: 'geojson', data: EMPTY_FC });
    map.addSource('nav-route-remaining-source', { type: 'geojson', data: fullLine });
    map.addSource('nav-route-end-source', { type: 'geojson', data: endPoint });
    map.addSource('nav-direction-arrows', { type: 'geojson', data: EMPTY_FC });

    addRouteLineLayer(map, {
      id: 'nav-route-casing',
      type: 'line',
      source: 'nav-route-source',
      layout: ROUTE_LINE_LAYOUT,
      paint: { 'line-color': '#F7FBFF', 'line-width': 14, 'line-opacity': 0.98 },
    }, beforeId);
    addRouteLineLayer(map, {
      id: 'nav-route-traveled',
      type: 'line',
      source: 'nav-route-traveled-source',
      layout: ROUTE_LINE_LAYOUT,
      paint: { 'line-color': '#3E5060', 'line-width': 10, 'line-opacity': 0.9 },
    }, 'nav-route-casing');
    addRouteLineLayer(map, {
      id: 'nav-route-line',
      type: 'line',
      source: 'nav-route-remaining-source',
      layout: ROUTE_LINE_LAYOUT,
      paint: { 'line-color': '#3E86EC', 'line-width': 10, 'line-opacity': 0.95 },
    }, 'nav-route-traveled');
    addRouteLineLayer(map, {
      id: 'nav-route-end-layer',
      type: 'circle',
      source: 'nav-route-end-source',
      paint: {
        'circle-radius': 10,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#3E86EC',
        'circle-stroke-width': 3,
      },
    }, 'nav-route-line');
    addRouteLineLayer(map, {
      id: 'nav-direction-arrows-layer',
      type: 'symbol',
      source: 'nav-direction-arrows',
      layout: {
        'icon-image': 'nav-arrow-icon',
        'icon-size': 0.45,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
      },
    }, 'nav-route-line');
  } else {
    map.getSource('nav-route-source').setData(fullLine);
    map.getSource('nav-route-remaining-source').setData(fullLine);
    map.getSource('nav-route-end-source').setData(endPoint);
  }
  ensureUserPuckOnTop(map);
}

function buildDirectionArrows(routePoints, spacingM = 18) {
  const features = [];
  let acc = 0;
  for (let i = 0; i < routePoints.length - 1; i += 1) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    const segLen = Math.sqrt((b.latitude - a.latitude) ** 2 + (b.longitude - a.longitude) ** 2) * 111320;
    if (segLen < 0.01) continue;
    const bearing = ((Math.atan2(b.longitude - a.longitude, b.latitude - a.latitude) * 180) / Math.PI + 360) % 360;
    while (acc >= 0) {
      const t = acc / segLen;
      if (t > 1) break;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [a.longitude + (b.longitude - a.longitude) * t, a.latitude + (b.latitude - a.latitude) * t],
        },
        properties: { bearing },
      });
      acc -= spacingM;
    }
    acc += segLen;
  }
  return features;
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

/** 终点 P 牌 — 对齐 Android ensureNavDestPinLayer */
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
    const beforeId = map.getLayer('nav-route-end-layer') ? 'nav-route-end-layer' : undefined;
    const layer = {
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
    };
    if (beforeId) addRouteLineLayer(map, layer, beforeId);
    else map.addLayer(layer);
    if (map.getLayer('nav-route-end-layer')) {
      map.setLayoutProperty('nav-route-end-layer', 'visibility', 'none');
    }
  } else {
    map.getSource('nav-dest-pin-source').setData(feature);
  }
  ensureUserPuckOnTop(map);
}

function updateRouteProgressByMeters(map, routePoints, traveledMeters, metrics) {
  if (!map || routePoints.length < 2) return;
  const m = metrics || window.NavGeo.buildRouteMetrics(routePoints);
  const total = m.total;
  if (total <= 0) return;
  const traveledLen = Math.max(0, Math.min(traveledMeters, total));
  let acc = 0;
  const traveled = [];
  const remaining = [];
  for (let i = 0; i < routePoints.length - 1; i += 1) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    const seg = window.NavGeo.distanceMeters(a, b);
    if (acc + seg <= traveledLen) {
      traveled.push([a.longitude, a.latitude]);
      if (acc + seg === traveledLen || i === routePoints.length - 2) traveled.push([b.longitude, b.latitude]);
    } else if (acc < traveledLen) {
      const t = (traveledLen - acc) / seg;
      const mx = a.longitude + (b.longitude - a.longitude) * t;
      const my = a.latitude + (b.latitude - a.latitude) * t;
      traveled.push([a.longitude, a.latitude], [mx, my]);
      remaining.push([mx, my], [b.longitude, b.latitude]);
    } else {
      remaining.push([a.longitude, a.latitude], [b.longitude, b.latitude]);
    }
    acc += seg;
  }
  if (traveled.length < 2 && remaining.length >= 2) traveled.push(...remaining.splice(0, 2));
  const traveledSrc = map.getSource('nav-route-traveled-source');
  const remainingSrc = map.getSource('nav-route-remaining-source');
  if (!traveledSrc || !remainingSrc) return;
  traveledSrc.setData(traveled.length >= 2 ? lineFeature(traveled) : EMPTY_FC);
  remainingSrc.setData(remaining.length >= 2 ? lineFeature(remaining) : lineFeature(routePoints.map((p) => [p.longitude, p.latitude])));
}

/** 兼容旧百分比 API */
function updateRouteProgress(map, routePoints, progressPct) {
  const m = window.NavGeo.buildRouteMetrics(routePoints);
  updateRouteProgressByMeters(map, routePoints, (progressPct / 100) * m.total, m);
}

function dist(a, b) {
  return window.NavGeo.distanceMeters(a, b);
}

window.MapLayers = {
  addExtraStyleLayers,
  ensureUserPuckLayers,
  ensureUserPuckOnTop,
  ensureNavRouteLayers,
  buildDirectionArrows,
  highlightTargetSpace,
  ensureDestPinLayer,
  updateRouteProgress,
  updateRouteProgressByMeters,
};
