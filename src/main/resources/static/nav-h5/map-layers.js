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

function moveRouteLayersToTop(map) {
  ['nav-route-casing', 'nav-route-traveled', 'nav-route-line', 'nav-route-end-layer', 'nav-direction-arrows-layer']
    .forEach((id) => {
      if (map.getLayer(id)) map.moveLayer(id);
    });
}

function ensureUserPuckLayers(map) {
  if (!map.getSource('user-loc-source')) {
    map.addSource('user-loc-source', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { bearing: 0 } },
    });
  }
  if (!map.getLayer('user-loc-halo')) {
    map.addLayer({
      id: 'user-loc-halo',
      type: 'circle',
      source: 'user-loc-source',
      paint: { 'circle-radius': 22, 'circle-color': '#3E86EC', 'circle-opacity': 0.2 },
    });
  }
  if (!map.getLayer('user-loc-heading-layer')) {
    map.addLayer({
      id: 'user-loc-heading-layer',
      type: 'symbol',
      source: 'user-loc-source',
      layout: {
        'icon-image': 'nav-arrow-icon',
        'icon-size': 0.55,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
      },
    });
  }
  if (!map.getLayer('user-loc-layer')) {
    map.addLayer({
      id: 'user-loc-layer',
      type: 'circle',
      source: 'user-loc-source',
      paint: {
        'circle-radius': 8,
        'circle-color': '#3E86EC',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
  }
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
    }, beforeId);
    addRouteLineLayer(map, {
      id: 'nav-route-line',
      type: 'line',
      source: 'nav-route-remaining-source',
      layout: ROUTE_LINE_LAYOUT,
      paint: { 'line-color': '#3E86EC', 'line-width': 10, 'line-opacity': 0.95 },
    }, beforeId);
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
    }, beforeId);
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
    }, beforeId);

    moveRouteLayersToTop(map);
  } else {
    map.getSource('nav-route-source').setData(fullLine);
    map.getSource('nav-route-remaining-source').setData(fullLine);
    map.getSource('nav-route-end-source').setData(endPoint);
    moveRouteLayersToTop(map);
  }
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

function updateRouteProgress(map, routePoints, progressPct) {
  if (!map || routePoints.length < 2) return;
  const total = routePoints.reduce((acc, pt, i) => acc + (i > 0 ? dist(routePoints[i - 1], pt) : 0), 0);
  if (total <= 0) return;
  const traveledLen = (progressPct / 100) * total;
  let acc = 0;
  const traveled = [];
  const remaining = [];
  for (let i = 0; i < routePoints.length - 1; i += 1) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    const seg = dist(a, b);
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
  if (traveled.length < 2) traveled.push(...remaining.splice(0, 2));
  const traveledSrc = map.getSource('nav-route-traveled-source');
  const remainingSrc = map.getSource('nav-route-remaining-source');
  if (!traveledSrc || !remainingSrc) return;
  traveledSrc.setData(traveled.length >= 2 ? lineFeature(traveled) : EMPTY_FC);
  remainingSrc.setData(remaining.length >= 2 ? lineFeature(remaining) : lineFeature(routePoints.map((p) => [p.longitude, p.latitude])));
}

function dist(a, b) {
  const dLat = b.latitude - a.latitude;
  const dLon = b.longitude - a.longitude;
  return Math.sqrt(dLat * dLat + dLon * dLon) * 111320;
}

window.MapLayers = {
  addExtraStyleLayers,
  ensureUserPuckLayers,
  ensureNavRouteLayers,
  buildDirectionArrows,
  highlightTargetSpace,
  updateRouteProgress,
};
