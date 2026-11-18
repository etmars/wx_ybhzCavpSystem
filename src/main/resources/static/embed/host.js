(function startHostedMap(global) {
  'use strict';

  const CHANNEL = 'avpmap-embed';
  const VERSION = 1;
  const query = new URLSearchParams(global.location.search);
  const token = query.get('token') || '';
  const assetBase = (query.get('asset_base') || '/api/embed/maps').replace(/\/$/, '');
  const routeApi = query.get('route_api') || '/api/nav/route';
  let mapId = query.get('map_id') || '';
  let map;
  let route;
  let progress = { segmentIndex: 0, distanceM: 0 };
  let destination = null;
  let waypoints = [];
  let userLocation = null;
  let followMode = 'none';
  let userStyle = { showBeam: true, showAccuracy: false, color: '#207fed' };
  let targetSpaceId = '';
  let occupancy = {};
  let parentOrigin = '';
  const keyCache = new Map();

  try {
    parentOrigin = query.get('parent_origin') || (document.referrer ? new URL(document.referrer).origin : '');
  } catch (_) {
    parentOrigin = '';
  }

  const fc = (features) => ({ type: 'FeatureCollection', features });
  const point = (id, value, properties) => ({
    type: 'Feature',
    id,
    properties: properties || {},
    geometry: { type: 'Point', coordinates: [Number(value.lon), Number(value.lat)] },
  });
  const line = (points, properties) => ({
    type: 'Feature',
    properties: properties || {},
    geometry: { type: 'LineString', coordinates: points },
  });

  function headers() {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function keyProvider(keyId, requestedMapId) {
    const id = requestedMapId || mapId;
    const cacheKey = `${id}:${keyId}`;
    if (!keyCache.has(cacheKey)) {
      keyCache.set(cacheKey, (async () => {
        const response = await fetch(
          `${assetBase}/${encodeURIComponent(id)}/avpmap-key?key_id=${keyId}`,
          { headers: headers(), cache: 'no-store' },
        );
        if (!response.ok) throw new Error(`avpmap key HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload.cek) throw new Error('avpmap key response missing cek');
        const raw = atob(payload.cek);
        const key = Uint8Array.from(raw, (char) => char.charCodeAt(0));
        if (key.byteLength !== 32) throw new Error(`invalid CEK length ${key.byteLength}`);
        return key;
      })());
    }
    return keyCache.get(cacheKey);
  }

  function post(type, payload, replyTo, error) {
    if (!global.parent || global.parent === global || !parentOrigin) return;
    global.parent.postMessage({ channel: CHANNEL, v: VERSION, type, payload, replyTo, error }, parentOrigin);
  }

  function emit(name, data) {
    post('event', { name, data });
  }

  function currentSegment() {
    if (!route || !Array.isArray(route.segments)) return null;
    return route.segments.find((segment) => !segment.mapId || !mapId || String(segment.mapId) === String(mapId))
      || route.segments[progress.segmentIndex]
      || route.segments[0];
  }

  function distanceMeters(a, b) {
    const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
    const dx = (b[0] - a[0]) * 111319.49 * Math.cos(lat);
    const dy = (b[1] - a[1]) * 111319.49;
    return Math.hypot(dx, dy);
  }

  function splitAtDistance(points, distance) {
    if (!points || points.length < 2) return [points || [], []];
    const traveled = [points[0]];
    let left = Math.max(0, Number(distance) || 0);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = distanceMeters(a, b);
      if (left >= length) {
        traveled.push(b);
        left -= length;
        continue;
      }
      const t = length ? left / length : 0;
      const cut = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      traveled.push(cut);
      return [traveled, [cut, ...points.slice(i)]];
    }
    return [traveled, [points[points.length - 1]]];
  }

  function renderRoute() {
    const segment = currentSegment();
    const points = segment && Array.isArray(segment.points) ? segment.points : [];
    if (points.length < 2) {
      map.removeSource('route-traveled');
      map.removeSource('route-remaining');
      return;
    }
    const [traveled, remaining] = splitAtDistance(points, progress.distanceM);
    map.setSource('route-traveled', {
      type: 'line', data: fc(traveled.length > 1 ? [line(traveled)] : []),
      color: '#8b96a8', opacity: 0.9, width: 5, order: 40,
    });
    map.setSource('route-remaining', {
      type: 'line', data: fc(remaining.length > 1 ? [line(remaining)] : []),
      color: '#207fed', opacity: 1, width: 7, order: 41,
    });
  }

  function renderUser() {
    map.setSource('user-location', {
      type: 'marker',
      data: fc(userLocation ? [point('self', userLocation, { heading: userLocation.heading || 0 })] : []),
      color: userStyle.color || '#207fed',
      size: 18,
      headingProperty: 'heading',
      order: 100,
    });
    if (userLocation && followMode !== 'none') {
      map.easeTo({
        center: [userLocation.lon, userLocation.lat],
        bearing: followMode === 'heading-up' ? Number(userLocation.heading || 0) : 0,
        duration: 180,
      });
    }
  }

  function renderMarkers() {
    const items = [];
    if (destination) items.push(point('destination', destination, { role: 'destination' }));
    waypoints.forEach((value, index) => items.push(point(`waypoint-${index}`, value, { role: 'waypoint' })));
    map.setSource('route-markers', {
      type: 'marker', data: fc(items), color: '#ffb020', size: 20, order: 90,
    });
  }

  async function loadMap(nextMapId) {
    mapId = String(nextMapId || mapId || '');
    if (!mapId) throw new Error('map_id is required');
    const response = await fetch(`${assetBase}/${encodeURIComponent(mapId)}/avpmap`, { headers: headers() });
    if (!response.ok) throw new Error(`avpmap HTTP ${response.status}`);
    await map.load(response, { mapId, keyProvider });
    map.setTheme(query.get('theme') === 'light' ? global.AvpMapWeb.lightTheme : global.AvpMapWeb.darkTheme);
    map.applyOccupancy(occupancy, targetSpaceId);
    renderRoute();
    renderUser();
    renderMarkers();
  }

  async function execute(type, payload) {
    switch (type) {
      case 'setUserLocation':
        userLocation = payload;
        if (payload && payload.mapId && String(payload.mapId) !== mapId) await loadMap(payload.mapId);
        renderUser();
        return;
      case 'setUserStyle': userStyle = { ...userStyle, ...(payload || {}) }; renderUser(); return;
      case 'setFollowMode': followMode = payload && payload.mode || 'none'; renderUser(); emit('followChange', followMode); return;
      case 'recenter': renderUser(); return;
      case 'setRoute': route = payload; progress = { segmentIndex: 0, distanceM: 0 }; renderRoute(); return;
      case 'setRouteProgress': progress = { ...progress, ...(payload || {}) }; renderRoute(); return;
      case 'previewRoute':
        route = payload && payload.route;
        progress = { segmentIndex: 0, distanceM: 0 };
        renderRoute();
        if (payload && payload.options && payload.options.fit) {
          const pts = currentSegment() && currentSegment().points || [];
          if (pts.length) map.fitBounds(boundsOf(pts), { padding: { left: 32, right: 32, top: 32, bottom: 32 } });
        }
        return;
      case 'clearRoute': route = null; renderRoute(); return;
      case 'fetchRoute': {
        const response = await fetch(`${routeApi}?session_id=${encodeURIComponent(payload.sessionId)}`, { headers: headers() });
        if (!response.ok) throw new Error(`route HTTP ${response.status}`);
        const body = await response.json();
        route = body.route || body;
        renderRoute();
        return body;
      }
      case 'setDestination': destination = payload; renderMarkers(); return;
      case 'setWaypoints': waypoints = Array.isArray(payload) ? payload : []; renderMarkers(); return;
      case 'highlightSpace': targetSpaceId = payload && payload.spaceId || ''; map.applyOccupancy(occupancy, targetSpaceId); return;
      case 'setOccupancy': occupancy = payload || {}; map.applyOccupancy(occupancy, targetSpaceId); return;
      case 'setMarkers':
        map.setSource('external-markers', { type: 'marker', data: fc((payload || []).map((v, i) => point(v.id || i, v, v))), color: '#ffb020', size: 18, order: 80 });
        return;
      case 'setPolyline':
        map.setSource(`external-line-${payload.id || 'default'}`, { type: 'line', data: fc([line(payload.points || [])]), color: payload.color || '#207fed', width: payload.width || 5, order: 30 });
        return;
      case 'setFloor':
        if (payload && payload.mapId && String(payload.mapId) !== mapId) await loadMap(payload.mapId);
        map.setFloor(payload && payload.floor);
        emit('floorChange', { mapId, floor: payload && payload.floor });
        return;
      case 'getFloors': {
        const floors = [...new Set((map.getData().structures || []).map((item) => item.floor).filter(Boolean))];
        return { mapId, floors };
      }
      case 'flyTo': map.flyTo(payload || {}); return;
      case 'fitBounds': map.fitBounds(payload.bounds, payload.options || {}); return;
      case 'setCamera': map.easeTo({ ...(payload || {}), duration: 180 }); return;
      default: throw Object.assign(new Error(`unknown command: ${type}`), { code: 'UNKNOWN_COMMAND' });
    }
  }

  function boundsOf(points) {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const value of points) {
      west = Math.min(west, value[0]); east = Math.max(east, value[0]);
      south = Math.min(south, value[1]); north = Math.max(north, value[1]);
    }
    return [[west, south], [east, north]];
  }

  async function onMessage(event) {
    if (event.source !== global.parent || !parentOrigin || event.origin !== parentOrigin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.v !== VERSION || !message.id) return;
    try {
      const result = await execute(message.type, message.payload);
      post('reply', result, message.id);
    } catch (error) {
      post('reply', null, message.id, { code: error.code || 'COMMAND_FAILED', message: String(error.message || error) });
    }
  }

  async function boot() {
    if (!global.AvpMapWeb || !global.AvpMapWeb.isSupported()) throw new Error('WebGL2 is not supported');
    map = new global.AvpMapWeb.AvpMap({
      container: '#map',
      interactive: true,
      theme: query.get('theme') === 'light' ? global.AvpMapWeb.lightTheme : global.AvpMapWeb.darkTheme,
      zoom: 19,
      pitch: 35,
    });
    map.on('click', (event) => emit('click', {
      lngLat: event.lngLat,
      feature: event.features && event.features[0] || null,
    }));
    map.on('move', () => emit('cameraChange', map.getCamera()));
    map.on('dragstart', () => {
      if (followMode !== 'none') {
        followMode = 'none';
        emit('followChange', followMode);
      }
    });
    global.addEventListener('message', onMessage);
    await loadMap(mapId);
    post('ready', { mapId, protocolVersion: VERSION });
  }

  boot().catch((error) => {
    document.getElementById('error').textContent = `地图加载失败：${String(error.message || error)}`;
    post('event', { name: 'error', data: { message: String(error.message || error) } });
  });
})(window);
