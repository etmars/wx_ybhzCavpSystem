(function attachAvpMapEmbed(global) {
  'use strict';

  const PROTOCOL_VERSION = 1;
  const CHANNEL = 'avpmap-embed';

  class EmbedClient {
    constructor(container, options) {
      if (!container) throw new Error('AvpMap.create: container is required');
      if (!options || !options.url) throw new Error('AvpMap.create: options.url is required');
      this.options = options;
      this.origin = new URL(options.url, global.location.href).origin;
      this.pending = new Map();
      this.queue = [];
      this.handlers = new Map();
      this.sequence = 0;
      this.readyState = false;
      this.locationFrame = 0;
      this.nextLocation = null;

      const url = new URL(options.url, global.location.href);
      if (options.mapId) url.searchParams.set('map_id', options.mapId);
      if (options.token) url.searchParams.set('token', options.token);
      if (options.theme) url.searchParams.set('theme', options.theme);
      url.searchParams.set('parent_origin', global.location.origin);

      this.iframe = document.createElement('iframe');
      this.iframe.src = url.href;
      this.iframe.title = options.title || 'AVP Map';
      this.iframe.allow = 'fullscreen';
      this.iframe.style.cssText = 'width:100%;height:100%;border:0;display:block';
      container.appendChild(this.iframe);

      this.onMessage = this.onMessage.bind(this);
      global.addEventListener('message', this.onMessage);
      this.ready = new Promise((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;
      });
    }

    on(type, handler) {
      let set = this.handlers.get(type);
      if (!set) this.handlers.set(type, (set = new Set()));
      set.add(handler);
      return () => set.delete(handler);
    }

    emit(type, payload) {
      for (const handler of this.handlers.get(type) || []) handler(payload);
    }

    send(type, payload) {
      const id = `m${++this.sequence}`;
      const message = { channel: CHANNEL, v: PROTOCOL_VERSION, id, type, payload };
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        if (this.readyState) this.post(message);
        else this.queue.push(message);
      });
    }

    post(message) {
      this.iframe.contentWindow.postMessage(message, this.origin);
    }

    onMessage(event) {
      if (event.source !== this.iframe.contentWindow || event.origin !== this.origin) return;
      const message = event.data;
      if (!message || message.channel !== CHANNEL || message.v !== PROTOCOL_VERSION) return;
      if (message.type === 'ready') {
        this.readyState = true;
        this.readyResolve(message.payload);
        for (const queued of this.queue.splice(0)) this.post(queued);
        this.emit('ready', message.payload);
        return;
      }
      if (message.replyTo) {
        const pending = this.pending.get(message.replyTo);
        if (!pending) return;
        this.pending.delete(message.replyTo);
        if (message.error) pending.reject(Object.assign(new Error(message.error.message), message.error));
        else pending.resolve(message.payload);
        return;
      }
      if (message.type === 'event') this.emit(message.payload && message.payload.name, message.payload && message.payload.data);
    }

    setUserLocation(location) {
      this.nextLocation = location;
      if (!this.locationFrame) {
        this.locationFrame = global.requestAnimationFrame(() => {
          this.locationFrame = 0;
          const next = this.nextLocation;
          this.nextLocation = null;
          this.send('setUserLocation', next).catch(() => {});
        });
      }
    }

    setUserStyle(style) { return this.send('setUserStyle', style); }
    setFollowMode(mode) { return this.send('setFollowMode', { mode }); }
    recenter() { return this.send('recenter'); }
    setRoute(route) { return this.send('setRoute', route); }
    setRouteProgress(progress) { return this.send('setRouteProgress', progress); }
    previewRoute(route, options) { return this.send('previewRoute', { route, options }); }
    clearRoute() { return this.send('clearRoute'); }
    fetchRoute(sessionId) { return this.send('fetchRoute', { sessionId }); }
    setDestination(destination) { return this.send('setDestination', destination); }
    setWaypoints(waypoints) { return this.send('setWaypoints', waypoints); }
    highlightSpace(spaceId) { return this.send('highlightSpace', { spaceId }); }
    setOccupancy(statusBySpace) { return this.send('setOccupancy', statusBySpace); }
    setMarkers(markers) { return this.send('setMarkers', markers); }
    setPolyline(polyline) { return this.send('setPolyline', polyline); }
    setFloor(floor) { return this.send('setFloor', floor); }
    getFloors() { return this.send('getFloors'); }
    flyTo(camera) { return this.send('flyTo', camera); }
    fitBounds(bounds, options) { return this.send('fitBounds', { bounds, options }); }
    setPitch(pitch) { return this.send('setCamera', { pitch }); }
    setBearing(bearing) { return this.send('setCamera', { bearing }); }
    setPadding(padding) { return this.send('setCamera', { padding }); }

    destroy() {
      if (this.locationFrame) global.cancelAnimationFrame(this.locationFrame);
      global.removeEventListener('message', this.onMessage);
      for (const pending of this.pending.values()) pending.reject(new Error('map destroyed'));
      this.pending.clear();
      this.iframe.remove();
    }
  }

  global.AvpMap = {
    create(container, options) {
      const element = typeof container === 'string' ? document.querySelector(container) : container;
      return new EmbedClient(element, options);
    },
    protocolVersion: PROTOCOL_VERSION,
  };
})(window);
