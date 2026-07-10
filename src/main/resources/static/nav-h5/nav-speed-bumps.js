/** 对齐 NavSpeedBumps + recomputeRouteSpeedBumps */
(function () {
  const G = window.NavGeo;

  function parseFeatures(geojson) {
    const feats = geojson && geojson.features ? geojson.features : [];
    return feats.map((f, i) => {
      const coords = f.geometry && f.geometry.type === 'LineString'
        ? f.geometry.coordinates
        : (f.geometry && f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : null);
      if (!coords || coords.length < 2) return null;
      const points = coords.map((c) => ({ longitude: c[0], latitude: c[1] }));
      let lat = 0; let lon = 0;
      points.forEach((p) => { lat += p.latitude; lon += p.longitude; });
      return {
        id: (f.properties && f.properties.id) || `sb_${i}`,
        center: { latitude: lat / points.length, longitude: lon / points.length },
        polygon: points,
      };
    }).filter(Boolean);
  }

  function projectBumpToRouteMeters(bump, route, metrics, gateM) {
    const proj = G.projectPointOnRoute(bump.center, route, metrics);
    if (!proj || proj.distanceMeters > gateM) return null;
    return proj.progressMeters;
  }

  function createSpeedBumpTracker() {
    let routeBumpMeters = [];
    let consumedIdx = -1;

    function setRoute(route, metrics, bumps, gateM = 8) {
      routeBumpMeters = [];
      consumedIdx = -1;
      if (!route || route.length < 2 || !bumps || !bumps.length) return;
      bumps.forEach((b) => {
        const m = projectBumpToRouteMeters(b, route, metrics, gateM);
        if (m != null) routeBumpMeters.push(m);
      });
      routeBumpMeters.sort((a, b) => a - b);
    }

    function nextBumpAfter(progressM, extraM = 12) {
      for (let i = consumedIdx + 1; i < routeBumpMeters.length; i += 1) {
        const m = routeBumpMeters[i];
        if (m >= progressM - 2 && m <= progressM + extraM + 8) return { idx: i, meters: m };
      }
      return null;
    }

    function consumeThrough(progressM, extraM = 12) {
      let anchor = null;
      while (consumedIdx + 1 < routeBumpMeters.length) {
        const m = routeBumpMeters[consumedIdx + 1];
        if (m > progressM + extraM) break;
        consumedIdx += 1;
        anchor = m;
      }
      return anchor;
    }

    function onBumpDetected(currentProgressM, geoGateM = 8, matchExtraM = 12) {
      const hit = nextBumpAfter(currentProgressM, matchExtraM);
      if (!hit) return null;
      if (Math.abs(hit.meters - currentProgressM) <= geoGateM + matchExtraM) {
        consumedIdx = hit.idx;
        return hit.meters;
      }
      return null;
    }

    return {
      setRoute,
      onBumpDetected,
      consumeThrough,
      get bumpMeters() { return routeBumpMeters.slice(); },
    };
  }

  async function fetchSpeedBumps(apiBase, mapId) {
    const url = `${apiBase.replace(/\/$/, '')}/api/maps/${encodeURIComponent(mapId)}/speed-bumps`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const geojson = await res.json();
    return parseFeatures(geojson);
  }

  window.NavSpeedBumps = { createSpeedBumpTracker, fetchSpeedBumps, parseFeatures };
}());
