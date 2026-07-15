/** H5 侧 DisplayState Hash 解码（与 utils/display-bridge.js 协议一致） */

(function () {
  function expandToH5Display(compact) {
    if (!compact || compact.lat == null || compact.lon == null) return null;
    const nextTurn = compact.td != null
      ? {
        dir: compact.td,
        text: compact.tt || '',
        distanceMeters: compact.tm,
      }
      : null;
    const hasKnn = compact.klat != null && compact.klon != null
      && Number.isFinite(+compact.klat) && Number.isFinite(+compact.klon);
    return {
      location: { latitude: compact.lat, longitude: compact.lon },
      heading: compact.hdg,
      routeBearing: compact.hdg,
      cameraBearing: compact.cam,
      smoothCameraBearing: compact.cam,
      progressMeters: compact.prog,
      remainMeters: compact.rem,
      remainMetersServer: compact.rem,
      progressPct: compact.pct,
      totalMeters: compact.tot,
      etaSec: compact.eta,
      navParked: !!compact.pk,
      nextTurn,
      navigating: compact.nav === 1,
      arrived: compact.arr === 1,
      ts: compact.ts,
      showKnnRaw: !!compact.kshow,
      knnRawLocation: (compact.kshow && hasKnn)
        ? { latitude: +compact.klat, longitude: +compact.klon }
        : null,
    };
  }

  function parseDisplayHash(hash) {
    if (!hash) return null;
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    const m = raw.match(/(?:^|&)d=([^&]+)/);
    if (!m) return null;
    try {
      return JSON.parse(decodeURIComponent(m[1]));
    } catch (e) {
      return null;
    }
  }

  function decodeDisplayHash(hash) {
    const compact = parseDisplayHash(hash);
    if (!compact) return null;
    return expandToH5Display(compact);
  }

  function decodeDisplayMeta(hash) {
    if (!hash) return { display: null, recenter: false };
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    const recenter = /(?:^|&)rc=1(?:&|$)/.test(raw);
    const compact = parseDisplayHash(hash);
    return {
      display: compact ? expandToH5Display(compact) : null,
      recenter: recenter || !!(compact && compact.rc),
    };
  }

  window.DisplayBridge = {
    decodeDisplayHash,
    decodeDisplayMeta,
    parseDisplayHash,
    expandToH5Display,
  };
}());
