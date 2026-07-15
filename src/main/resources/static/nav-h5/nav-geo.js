/** 对齐 NavGeo.kt + MainActivity 路线几何 */
(function () {
  const T = window.NavTuning;

  function distanceMeters(a, b) {
    const r = 6371000;
    const p1 = (a.latitude * Math.PI) / 180;
    const p2 = (b.latitude * Math.PI) / 180;
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  function bearingDegrees(a, b) {
    const y = Math.sin(((b.longitude - a.longitude) * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180);
    const x = Math.cos((a.latitude * Math.PI) / 180) * Math.sin((b.latitude * Math.PI) / 180)
      - Math.sin((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180)
        * Math.cos(((b.longitude - a.longitude) * Math.PI) / 180);
    let br = (Math.atan2(y, x) * 180) / Math.PI;
    if (br < 0) br += 360;
    return br;
  }

  function lerpBearingDeg(from, to, t) {
    let d = (to - from) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    let out = from + d * t;
    out %= 360;
    if (out < 0) out += 360;
    return out;
  }

  function signedBearingDeltaDeg(from, to) {
    let d = (to - from) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  function headingDiffDeg(a, b) {
    return Math.abs(((a - b + 540) % 360) - 180);
  }

  function projectPointOnSegmentWithT(raw, a, b) {
    const ax = a.longitude; const ay = a.latitude;
    const bx = b.longitude; const by = b.latitude;
    const px = raw.longitude; const py = raw.latitude;
    const dx = bx - ax; const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-14) {
      return { point: { latitude: ay, longitude: ax }, t: 0 };
    }
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return {
      point: { latitude: ay + t * dy, longitude: ax + t * dx },
      t,
    };
  }

  function buildRouteMetrics(polyline) {
    const cumulative = [0];
    let total = 0;
    for (let i = 0; i < polyline.length - 1; i += 1) {
      total += distanceMeters(polyline[i], polyline[i + 1]);
      cumulative.push(total);
    }
    return { cumulative, total };
  }

  function projectPointOnRoute(raw, polyline, metrics) {
    if (!polyline || polyline.length < 2) return null;
    const m = metrics || buildRouteMetrics(polyline);
    let best = null;
    for (let i = 0; i < polyline.length - 1; i += 1) {
      const proj = projectPointOnSegmentWithT(raw, polyline[i], polyline[i + 1]);
      const segmentStartM = m.cumulative[i] || 0;
      const segmentM = distanceMeters(polyline[i], polyline[i + 1]);
      const progressMeters = segmentStartM + segmentM * proj.t;
      const d = distanceMeters(raw, proj.point);
      if (!best || d < best.distanceMeters) {
        best = {
          point: proj.point,
          distanceMeters: d,
          progress: i + proj.t,
          progressMeters,
        };
      }
    }
    return best;
  }

  function pointAtRouteDistance(polyline, targetMeters, metrics) {
    if (!polyline || !polyline.length) return null;
    if (polyline.length === 1 || targetMeters <= 0) return polyline[0];
    const m = metrics || buildRouteMetrics(polyline);
    const clamped = Math.max(0, Math.min(targetMeters, m.total));
    for (let i = 0; i < polyline.length - 1; i += 1) {
      const startM = m.cumulative[i] || 0;
      const endM = m.cumulative[i + 1] || startM;
      if (clamped <= endM + 1e-6) {
        const segM = Math.max(endM - startM, 1e-6);
        const t = Math.max(0, Math.min(1, (clamped - startM) / segM));
        const a = polyline[i];
        const b = polyline[i + 1];
        return {
          latitude: a.latitude + (b.latitude - a.latitude) * t,
          longitude: a.longitude + (b.longitude - a.longitude) * t,
        };
      }
    }
    return polyline[polyline.length - 1];
  }

  function routeSegmentBearingAtDistance(polyline, targetMeters, metrics) {
    if (!polyline || polyline.length < 2) return 0;
    const m = metrics || buildRouteMetrics(polyline);
    const clamped = Math.max(0, Math.min(targetMeters, m.total));
    for (let i = 0; i < polyline.length - 1; i += 1) {
      const endM = m.cumulative[i + 1] || 0;
      if (clamped <= endM + 1e-6) {
        return bearingDegrees(polyline[i], polyline[i + 1]);
      }
    }
    const n = polyline.length;
    return bearingDegrees(polyline[n - 2], polyline[n - 1]);
  }

  function routeForwardBearingAtProgress(polyline, progressMeters, metrics) {
    if (!polyline || polyline.length < 2) return 0;
    const m = metrics || buildRouteMetrics(polyline);
    const ahead = Math.max(0, Math.min(
      (progressMeters || 0) + T.NAV_CAMERA_ROUTE_LOOKAHEAD_M,
      m.total,
    ));
    return routeSegmentBearingAtDistance(polyline, ahead, m);
  }

  /** 对齐 Android MbtilesMapMeta.cameraBearingDeg：图纸北系方位 → MapLibre 真北 bearing */
  function cameraBearingFromRouteDeg(routeMapRelDeg, mapNorthBearingDeg) {
    return ((routeMapRelDeg + (mapNorthBearingDeg || 0)) + 360) % 360;
  }

  function elevationAtRouteDistance(polyline, targetMeters, metrics) {
    if (!polyline || !polyline.length) return 0;
    const p0 = polyline[0];
    if (p0.elevation != null || p0.elev != null) {
      const m = metrics || buildRouteMetrics(polyline);
      const pt = pointAtRouteDistance(polyline, targetMeters, m);
      if (!pt) return 0;
      for (let i = 0; i < polyline.length - 1; i += 1) {
        const a = polyline[i];
        const b = polyline[i + 1];
        const ea = a.elevation != null ? a.elevation : (a.elev || 0);
        const eb = b.elevation != null ? b.elevation : (b.elev || 0);
        const endM = m.cumulative[i + 1] || 0;
        const startM = m.cumulative[i] || 0;
        if (targetMeters <= endM + 1e-6) {
          const seg = Math.max(endM - startM, 1e-6);
          const t = Math.max(0, Math.min(1, (targetMeters - startM) / seg));
          return ea + (eb - ea) * t;
        }
      }
      const last = polyline[polyline.length - 1];
      return last.elevation != null ? last.elevation : (last.elev || 0);
    }
    return 0;
  }

  window.NavGeo = {
    distanceMeters,
    bearingDegrees,
    lerpBearingDeg,
    signedBearingDeltaDeg,
    headingDiffDeg,
    buildRouteMetrics,
    projectPointOnRoute,
    pointAtRouteDistance,
    routeSegmentBearingAtDistance,
    routeForwardBearingAtProgress,
    cameraBearingFromRouteDeg,
    elevationAtRouteDistance,
  };
}());
