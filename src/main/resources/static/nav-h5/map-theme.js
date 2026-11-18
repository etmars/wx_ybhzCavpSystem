/**
 * 换主题只改已有图层的颜色和视口光，不重载瓦片。
 * 对齐 MainActivity.refreshMapTheme + ParkingSpotOccupancy.apply。
 */
(function attach(api) {
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.MapTheme = api;
}((function build() {
  function layerId(base, mapId, primaryMapId) {
    if (window.MapLayers && MapLayers.parkingLayerId) {
      return MapLayers.parkingLayerId(base, mapId, primaryMapId);
    }
    if (!mapId || String(mapId) === String(primaryMapId || '')) return base;
    return `${base}__${mapId}`;
  }

  function sourceId(mapId, primaryMapId) {
    if (window.MapLayers && MapLayers.parkingSourceId) {
      return MapLayers.parkingSourceId(mapId, primaryMapId);
    }
    if (!mapId || String(mapId) === String(primaryMapId || '')) return 'parking-source';
    return `parking-source-${mapId}`;
  }

  function setPaint(map, id, key, value) {
    if (!map.getLayer(id)) return;
    try { map.setPaintProperty(id, key, value); } catch (e) { /* 缺层跳过 */ }
  }

  function applyPaletteTo(map, palette, mapId, primaryMapId) {
    const id = (base) => layerId(base, mapId, primaryMapId);
    if (!mapId || String(mapId) === String(primaryMapId || '')) {
      setPaint(map, 'background', 'background-color', palette.background);
    }
    setPaint(map, id('road-2005-fill'), 'fill-color', palette.road);
    setPaint(map, id('road-2005-fill'), 'fill-opacity', 1);
    setPaint(map, id('junction-1005-fill'), 'fill-color', palette.junctionFill);
    setPaint(map, id('junction-1005-fill'), 'fill-opacity', palette.junctionFillOpacity);
    setPaint(map, id('junction-1005-edge'), 'line-color', palette.junctionEdge);
    setPaint(map, id('floor-fill'), 'fill-color', palette.floor);
    setPaint(map, id('floor-fill'), 'fill-opacity', 1);
    setPaint(map, id('lane-bound-line'), 'line-color', palette.laneBound);
    setPaint(map, id('junction-label'), 'text-color', palette.junctionText);
    setPaint(map, id('junction-label'), 'text-halo-color', palette.junctionHalo);
    setPaint(map, id('room-2008-fill'), 'fill-color', palette.room);
    setPaint(map, id('room-2008-fill'), 'fill-opacity', 1);
    setPaint(map, id('parking-fill'), 'fill-color', palette.parkingFill);
    setPaint(map, id('parking-fill'), 'fill-opacity', palette.parkingFillOpacity);
    setPaint(map, id('parking-edge'), 'line-color', palette.parkingEdge);
    setPaint(map, id('parking-edge'), 'line-opacity', palette.parkingEdgeOpacity);
    setPaint(map, id('arrow-1001-fill'), 'fill-color', palette.arrow);
    setPaint(map, id('wall-1000-extrusion'), 'fill-extrusion-color', palette.wall);
    setPaint(map, id('blocker-100202-extrusion'), 'fill-extrusion-color', palette.blockerFill);
    setPaint(map, id('blocker-100202-edge'), 'line-color', palette.blockerEdge);
    setPaint(map, id('floor-range-layer'), 'fill-color', palette.floorRange);
    setPaint(map, id('floor-base-layer'), 'fill-color', palette.floorBase);
    setPaint(map, id('floor-texture-layer'), 'fill-opacity', palette.floorTextureOpacity);
  }

  function applyViewportLight(map, palette) {
    if (!map || typeof map.setLight !== 'function') return;
    const azimuth = (palette.lightAzimuth * Math.PI) / 180;
    const polar = (palette.lightPolar * Math.PI) / 180;
    try {
      map.setLight({
        anchor: 'viewport',
        color: palette.viewportLight,
        intensity: palette.viewportIntensity,
        position: [
          palette.lightRadial * Math.cos(azimuth) * Math.sin(polar),
          palette.lightRadial * Math.sin(azimuth) * Math.sin(polar),
          palette.lightRadial * Math.cos(polar),
        ],
      });
    } catch (e) { /* ignore */ }
  }

  function ensureOccupancyLayer(map, mapId, primaryMapId) {
    const id = layerId('parking-occupancy', mapId, primaryMapId);
    if (map.getLayer(id)) return id;
    const src = sourceId(mapId, primaryMapId);
    if (!map.getSource(src)) return null;
    const before = layerId('parking-edge', mapId, primaryMapId);
    const spec = {
      id,
      type: 'fill',
      source: src,
      'source-layer': 'parking_fill',
      paint: { 'fill-opacity': 0, 'fill-antialias': true },
    };
    try {
      if (map.getLayer(before)) map.addLayer(spec, before);
      else map.addLayer(spec);
    } catch (e) {
      try { map.addLayer(spec); } catch (e2) { return null; }
    }
    return id;
  }

  function applyOccupancy(map, themeName, lists, targetSpaceId, mapIds, primaryMapId) {
    const occ = window.ParkingSpotOccupancy;
    if (!map || !occ) return;
    const occupied = (lists && lists.occupied) || [];
    const reserved = (lists && lists.reserved) || [];
    if (typeof map.applyOccupancy === 'function' && window.AvpMapWeb) {
      const statusBySpace = {};
      occupied.forEach((id) => { statusBySpace[id] = 1; });
      reserved.forEach((id) => { statusBySpace[id] = 2; });
      map.applyOccupancy(statusBySpace, targetSpaceId || '');
      return;
    }
    const targets = occ.targetKeys(targetSpaceId);
    const color = occ.colorExpr(themeName, occupied, reserved, targets);
    const opacity = occ.opacityExpr(themeName, occupied, reserved, targets);
    (mapIds || [primaryMapId]).forEach((mapId) => {
      const id = ensureOccupancyLayer(map, mapId, primaryMapId);
      if (!id) return;
      setPaint(map, id, 'fill-color', color);
      setPaint(map, id, 'fill-opacity', opacity);
    });
  }

  function applyTheme(map, themeName, mapIds, primaryMapId) {
    if (map && typeof map.setTheme === 'function' && window.AvpMapWeb) {
      const theme = themeName === 'light' ? AvpMapWeb.lightTheme : AvpMapWeb.darkTheme;
      map.setTheme(theme);
      return theme;
    }
    const palette = window.IndoorMapPalette.of(themeName);
    applyViewportLight(map, palette);
    (mapIds && mapIds.length ? mapIds : [primaryMapId]).forEach((mapId) => {
      applyPaletteTo(map, palette, mapId, primaryMapId);
    });
    return palette;
  }

  function resolveTheme(explicit) {
    const v = String(explicit || '').toLowerCase();
    if (v === 'light' || v === 'dark') return v;
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    } catch (e) { /* ignore */ }
    return 'dark';
  }

  return {
    applyPaletteTo,
    applyViewportLight,
    ensureOccupancyLayer,
    applyOccupancy,
    applyTheme,
    resolveTheme,
  };
}())));
