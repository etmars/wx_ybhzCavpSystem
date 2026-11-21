/* MapLibre-compatible subset backed by AvpMapWeb dynamic sources. */
(function attach(global) {
  'use strict';

  const SDK = global.AvpMapWeb;
  if (!SDK) throw new Error('AvpMapWeb IIFE must be loaded before avpmap-adapter.js');

  const EMPTY_FC = { type: 'FeatureCollection', features: [] };
  const BAKED_ALIASES = {
    background: 'background',
    'floor-fill': 'floor_fill',
    'road-2005-fill': 'road_2005_union',
    'junction-1005-fill': 'junction_1005',
    'junction-1005-edge': 'junction_1005_edge',
    'lane-bound-line': 'lane_bound',
    'room-2008-fill': 'room_2008',
    'parking-fill': 'parking_fill',
    'parking-edge': 'parking_edge',
    'arrow-1001-fill': 'arrow_1001',
    'wall-1000-extrusion': 'walls_1000',
    'blocker-100202-extrusion': 'blocker_100202',
    'blocker-100202-edge': 'blocker_100202_edge',
    'parking-label': 'parking_label',
    'poi-layer': 'poi',
  };

  const ABOVE_MODEL_SYMBOL_LAYERS = new Set(['user-loc-heading-layer', 'nav-dest-pin-layer', 'nav-waypoint-pin-layer', 'knn-raw-label']);


  function featureCollection(data) {
    if (!data) return EMPTY_FC;
    if (data.type === 'FeatureCollection') return data;
    if (data.type === 'Feature') return { type: 'FeatureCollection', features: [data] };
    return EMPTY_FC;
  }

  function value(expr, feature, fallback) {
    if (!Array.isArray(expr)) return expr == null ? fallback : expr;
    if (expr[0] === 'get') return feature?.properties?.[expr[1]] ?? fallback;
    return fallback;
  }

  function cssColor(input, fallback) {
    if (typeof input !== 'string') return fallback;
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(input)) return input;
    const m = input.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (!m) return fallback;
    const hex = [m[1], m[2], m[3]]
      .map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, '0'))
      .join('');
    const alpha = m[4] == null ? '' : Math.round(Math.max(0, Math.min(1, Number(m[4]))) * 255)
      .toString(16).padStart(2, '0');
    return `#${hex}${alpha}`;
  }

  function imageToCanvas(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (image.data) {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    } else {
      ctx.drawImage(image, 0, 0);
    }
    return canvas;
  }

  class GeoJsonSource {
    constructor(owner, id, spec) {
      this.owner = owner;
      this.id = id;
      this.spec = { ...spec, data: spec.data || EMPTY_FC };
    }
    setData(data) {
      this.spec.data = data || EMPTY_FC;
      this.owner._syncSourceLayers(this.id);
      return this;
    }
  }

  class Map {
    constructor(options) {
      this._events = new global.Map();
      this._sources = new global.Map();
      this._layers = [];
      this._images = new global.Map();
      this._dynamicIds = new global.Map();
      this._loaded = false;
      this._theme = options.theme || SDK.lightTheme;
      this._occupancy = {};
      this._targetSpace = '';
      this._native = new SDK.AvpMap({
        container: options.container,
        theme: this._theme,
        center: options.center,
        zoom: options.zoom,
        bearing: options.bearing,
        pitch: options.pitch,
        interactive: options.interactive !== false,
        logo: options.logo,
      });
      ['dragstart', 'zoomstart', 'zoomend', 'rotatestart', 'pitchstart', 'move', 'moveend',
        'resize', 'render', 'click'].forEach((type) => {
        this._native.on(type, (event) => this._fire(type, event));
      });
    }

    async loadAvpMap(url, structuresBase, readOptions) {
      const data = await this._native.load(url, readOptions);
      this._installBakedLayers(data);
      // 孪生页同样关掉地图里自带的 structure_sign：名牌改由电梯/楼梯实例按模型高度另画
      this._native.setLayerVisible('structure_sign', false);
      this._loaded = true;
      this._applyOccupancy();
      this._syncAllLayers();
      this._fire('load');
      requestAnimationFrame(() => this._fire('idle'));
      this._loadStructures(data, structuresBase).catch((error) => {
        console.warn('[avpmap] structure load failed', error);
      });
      return data;
    }

    async setFloors(floors, structuresBase) {
      await this._native.setFloors(floors);
      const structures = [];
      const seen = new Set();
      (floors || []).forEach((floor) => {
        const list = floor && floor.input && floor.input.structures;
        if (!Array.isArray(list)) return;
        list.forEach((item) => {
          const type = String(item && item.type || '').trim();
          if (!type || seen.has(type)) return;
          seen.add(type);
          structures.push(item);
        });
      });
      await this._loadStructures({ structures }, structuresBase);
      this._loaded = true;
      this._rebuildAtlas();
      this._applyOccupancy();
      this._syncAllLayers();
      return this;
    }

    async loadStructures(data, base) {
      await this._loadStructures(data, base);
      // 标牌文字来自 data.structures，替换后图集必须补画 sign:xxx
      this._rebuildAtlas();
      this._native.requestRender();
    }

    async _loadStructures(data, base) {
      if (!data || !Array.isArray(data.structures)) return;
      const types = [...new Set(data.structures.map((item) => String(item.type || '').trim()).filter(Boolean))];
      await Promise.all(types.map(async (type) => {
        try {
          const buffer = await this._fetchStructureMesh(type, base);
          this._native.setStructureMesh(type, SDK.readStructureMesh(buffer));
        } catch (error) {
          console.warn(`[avpmap] structure ${type} load failed`, error);
        }
      }));
    }

    async _fetchStructureMesh(type, base) {
      const name = `${encodeURIComponent(type)}.mesh`;
      // v2 是带贴图的 SM02（与孪生页同一份 GLB 烘出来的）；旧 SM01 只有顶点色，仅作兜底
      const urls = [`./structures/${encodeURIComponent(type)}.v2.mesh`];
      if (base) urls.push(`${base}/${name}`);
      urls.push(`./structures/${name}`);
      let last = 'structure mesh missing';
      for (const url of urls) {
        const response = await fetch(url);
        if (response.ok) return response.arrayBuffer();
        last = `HTTP ${response.status} ${url}`;
      }
      throw new Error(last);
    }

    _installBakedLayers(data) {
      this._layers = this._layers.filter((layer) => layer.type !== 'baked');
      const known = new Set((data.meshes || []).map((layer) => layer.name));
      Object.entries(BAKED_ALIASES).forEach(([id, name]) => {
        if (name === 'background' || known.has(name) || (data.features && data.features[name])) {
          this._layers.push({ id, type: 'baked', avpLayer: name, layout: {}, paint: {} });
        }
      });
    }

    on(type, handler) {
      if (!this._events.has(type)) this._events.set(type, new Set());
      this._events.get(type).add(handler);
      return this;
    }
    off(type, handler) {
      this._events.get(type)?.delete(handler);
      return this;
    }
    once(type, handler) {
      if (type === 'idle' && this._loaded) {
        requestAnimationFrame(() => handler({ type, target: this }));
        return this;
      }
      const wrapped = (event) => {
        this.off(type, wrapped);
        handler(event);
      };
      return this.on(type, wrapped);
    }
    _fire(type, event) {
      const next = { ...(event || {}), type, target: this };
      (this._events.get(type) || []).forEach((handler) => handler(next));
    }

    addSource(id, spec) {
      if (spec.type !== 'geojson') {
        this._sources.set(id, { id, spec, setData() {} });
        return this;
      }
      this._sources.set(id, new GeoJsonSource(this, id, spec));
      return this;
    }
    getSource(id) { return this._sources.get(id); }
    removeSource(id) {
      this._removeDynamic(id);
      this._sources.delete(id);
      return this;
    }

    addLayer(spec, beforeId) {
      if (!spec || !spec.id || this.getLayer(spec.id)) return this;
      const layer = {
        ...spec,
        layout: { ...(spec.layout || {}) },
        paint: { ...(spec.paint || {}) },
      };
      const index = beforeId ? this._layers.findIndex((item) => item.id === beforeId) : -1;
      if (index >= 0) this._layers.splice(index, 0, layer);
      else this._layers.push(layer);
      this._syncLayer(layer);
      return this;
    }
    getLayer(id) { return this._layers.find((layer) => layer.id === id); }
    removeLayer(id) {
      const index = this._layers.findIndex((layer) => layer.id === id);
      if (index >= 0) this._layers.splice(index, 1);
      this._removeDynamic(id);
      return this;
    }
    moveLayer(id, beforeId) {
      const index = this._layers.findIndex((layer) => layer.id === id);
      if (index < 0) return this;
      const [layer] = this._layers.splice(index, 1);
      const before = beforeId ? this._layers.findIndex((item) => item.id === beforeId) : -1;
      if (before >= 0) this._layers.splice(before, 0, layer);
      else this._layers.push(layer);
      this._scheduleSyncAll();
      return this;
    }
    /** 连续 moveLayer 只重建一次，避免同一帧内把路线 GPU 缓冲重建十几遍 */
    _scheduleSyncAll() {
      if (this._syncAllQueued) return;
      this._syncAllQueued = true;
      Promise.resolve().then(() => {
        this._syncAllQueued = false;
        this._syncAllLayers();
      });
    }
    getStyle() {
      return { layers: this._layers.map((layer) => ({ ...layer })) };
    }

    setPaintProperty(id, key, next) {
      const layer = this.getLayer(id);
      if (!layer) return this;
      layer.paint[key] = next;
      this._syncLayer(layer);
      return this;
    }
    getPaintProperty(id, key) { return this.getLayer(id)?.paint?.[key]; }
    setLayoutProperty(id, key, next) {
      const layer = this.getLayer(id);
      if (!layer) return this;
      layer.layout[key] = next;
      if (layer.type === 'baked' && key === 'visibility') {
        this._native.setLayerVisible(layer.avpLayer, next !== 'none');
      } else {
        this._syncLayer(layer);
      }
      return this;
    }
    getLayoutProperty(id, key) { return this.getLayer(id)?.layout?.[key]; }

    _syncSourceLayers(sourceId) {
      this._layers.filter((layer) => layer.source === sourceId).forEach((layer) => this._syncLayer(layer));
    }
    _syncAllLayers() {
      this._layers.forEach((layer) => this._syncLayer(layer));
    }
    _removeDynamic(layerId) {
      (this._dynamicIds.get(layerId) || []).forEach((id) => this._native.removeSource(id));
      this._dynamicIds.delete(layerId);
    }
    _syncLayer(layer) {
      if (!this._loaded || layer.type === 'baked') return;
      this._removeDynamic(layer.id);
      if (layer.layout?.visibility === 'none') return;
      const source = this._sources.get(layer.source);
      if (!source || !source.spec?.data) return;
      const data = featureCollection(source.spec.data);
      const order = this._layers.indexOf(layer) + 100;
      const dynamicIds = [];
      if (layer.type === 'line') {
        const id = `layer:${layer.id}`;
        this._native.setSource(id, {
          type: 'line',
          data,
          color: cssColor(layer.paint['line-color'], '#3e86ec'),
          opacity: Number(value(layer.paint['line-opacity'], null, 1)),
          width: Number(value(layer.paint['line-width'], null, 4)),
          order,
        });
        dynamicIds.push(id);
      } else if (layer.type === 'symbol' && layer.id === 'user-loc-heading-layer') {
        // 朝向光束对标 Android 的 CONE 标记：贴地扇形，尖在定位点正中心，随俯仰变形；
        // 半径 = 176px 位图 / 3 × iconSize ≈ 69.2px，#3E86EC 的 AA→00 渐变
        const id = `layer:${layer.id}`;
        this._native.setSource(id, {
          type: 'marker',
          shape: 'cone',
          data,
          color: '#3e86ec',
          opacity: 0xAA / 255,
          size: (176 / 3) * Number(value(layer.layout['icon-size'], null, 1.18)),
          headingProperty: Array.isArray(layer.layout['icon-rotate']) ? layer.layout['icon-rotate'][1] : undefined,
          order,
        });
        dynamicIds.push(id);
      } else if (layer.type === 'symbol') {
        const imageExpr = layer.layout['icon-image'];
        const groups = new global.Map();
        data.features.forEach((feature) => {
          const image = String(value(imageExpr, feature, typeof imageExpr === 'string' ? imageExpr : '') || '');
          if (!image) return;
          if (!groups.has(image)) groups.set(image, []);
          groups.get(image).push(feature);
        });
        groups.forEach((features, image) => {
          if (!this._images.has(image)) return;
          const id = `layer:${layer.id}:${image}`;
          this._native.setSource(id, {
            type: 'image',
            data: { type: 'FeatureCollection', features },
            image,
            size: Number(value(layer.layout['icon-size'], null, 1)),
            headingProperty: Array.isArray(layer.layout['icon-rotate']) ? layer.layout['icon-rotate'][1] : undefined,
            mapAligned: layer.layout['icon-rotation-alignment'] === 'map',
            anchor: layer.layout['icon-anchor'] === 'bottom' ? 'bottom' : 'center',
            // 对标 Android：车标光束、终点/途径点牌压在墙体之上；方向箭头在路线上与路线同层（墙体之下）
            aboveModels: ABOVE_MODEL_SYMBOL_LAYERS.has(layer.id),
            order,
          });
          dynamicIds.push(id);
        });
      } else if (layer.type === 'circle') {
        const opacity = Number(value(layer.paint['circle-opacity'], null, 1));
        if (opacity > 0) {
          const radius = Number(value(layer.paint['circle-radius'], null, 8));
          const stroke = Number(value(layer.paint['circle-stroke-width'], null, 0));
          if (stroke > 0) {
            const strokeId = `layer:${layer.id}:stroke`;
            this._native.setSource(strokeId, {
              type: 'marker',
              data,
              color: cssColor(layer.paint['circle-stroke-color'], '#ffffff'),
              // 对标 MapLibre/Android：描边压在圆边上，外圈半径 = r + stroke/2
              size: (radius + stroke / 2) * 2,
              order,
            });
            dynamicIds.push(strokeId);
          }
          const id = `layer:${layer.id}`;
          this._native.setSource(id, {
            type: 'marker',
            data,
            color: cssColor(layer.paint['circle-color'], '#3e86ec'),
            // 有描边时内芯半径 = r - stroke/2（Android 外圈 9.5、内芯 6.5）
            size: (stroke > 0 ? radius - stroke / 2 : radius) * 2,
            order: order + 0.1,
          });
          dynamicIds.push(id);
        }
      }
      this._dynamicIds.set(layer.id, dynamicIds);
    }

    hasImage(id) { return this._images.has(id); }
    addImage(id, image) {
      this._images.set(id, imageToCanvas(image));
      this._rebuildAtlas();
      // 新图只会影响 symbol 层；不要整套重建路线/圆点的 GPU 缓冲
      this._layers.forEach((layer) => {
        if (layer.type === 'symbol') this._syncLayer(layer);
      });
      return this;
    }
    removeImage(id) {
      this._images.delete(id);
      this._rebuildAtlas();
      return this;
    }
    _rebuildAtlas() {
      if (this._atlasQueued) return;
      this._atlasQueued = true;
      requestAnimationFrame(() => {
        this._atlasQueued = false;
        const extras = [...this._images].map(([key, image]) => ({
          key, image, width: image.width, height: image.height,
        }));
        try {
          if (typeof this._native.scheduleAtlas === 'function') {
            this._native.scheduleAtlas(extras);
            return;
          }
          const data = this._native.getData?.();
          if (data && typeof SDK.buildDefaultSpriteAtlas === 'function') {
            const atlas = SDK.buildDefaultSpriteAtlas(data, this._theme, extras);
            if (atlas) {
              this._native.setSpriteAtlas(atlas);
              return;
            }
          }
          if (!extras.length) return;
          this._native.setSpriteAtlas(SDK.buildSpriteAtlas(extras));
        } catch (error) {
          console.warn('[avpmap] sprite atlas rebuild failed', error);
        }
      });
    }

    setTheme(theme) {
      this._theme = theme;
      this._native.setTheme(theme);
      this._rebuildAtlas();
      this._applyOccupancy();
      return this;
    }
    applyOccupancy(statusBySpace, targetSpaceId) {
      this._occupancy = { ...(statusBySpace || {}) };
      if (targetSpaceId != null) this._targetSpace = String(targetSpaceId || '');
      this._applyOccupancy();
      return this;
    }
    setTargetSpace(spaceId) {
      this._targetSpace = String(spaceId || '');
      this._applyOccupancy();
      return this;
    }
    _applyOccupancy() {
      this._native.applyOccupancy(this._occupancy, this._targetSpace);
    }

    getContainer() { return this._native.container; }
    getCanvas() { return this._native.canvas; }
    getData() { return this._native.getData(); }
    getCenter() { return this._native.getCenter(); }
    getZoom() { return this._native.getZoom(); }
    getBearing() { return this._native.getBearing(); }
    getPitch() { return this._native.getPitch(); }
    getPadding() { return this._native.getPadding(); }
    setPadding(padding) { this._native.setPadding(padding); return this; }
    jumpTo(options) { this._native.jumpTo(options); return this; }
    easeTo(options) { this._native.easeTo(options); return this; }
    flyTo(options) { this._native.flyTo(options); return this; }
    project(lngLat) { return this._native.project(lngLat); }
    unproject(point) { return this._native.unproject(point); }
    triggerRepaint() { this._native.requestRender(); return this; }
    setLight() { return this; }
    resize() { this._native.resize(); return this; }
    setFloor(floor, zOffset) { this._native.setFloor(floor, zOffset); return this; }
  }

  global.AvpMapAdapter = { Map };
}(window));
