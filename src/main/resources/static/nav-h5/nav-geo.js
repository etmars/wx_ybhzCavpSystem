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

  /** 对齐 Android NavRouteBearing.segmentBearingSkippingShort：短段向后/向前找足够长的段。 */
  function segmentBearingSkippingShort(polyline, cumulative, targetMeters, minSegM) {
    const n = polyline.length;
    if (n < 2 || !cumulative || cumulative.length !== n) return 0;
    const total = cumulative[n - 1];
    const clamped = Math.max(0, Math.min(targetMeters, total));
    let idx = n - 2;
    for (let i = 0; i < n - 1; i += 1) {
      if (clamped <= cumulative[i + 1] + 1e-6) { idx = i; break; }
    }
    const segLen = (i) => Math.max(0, (cumulative[i + 1] || 0) - (cumulative[i] || 0));
    let i = idx;
    while (i >= 0 && segLen(i) < minSegM) i -= 1;
    if (i < 0) {
      i = idx;
      while (i < n - 1 && segLen(i) < minSegM) i += 1;
    }
    i = Math.max(0, Math.min(n - 2, i));
    return bearingDegrees(polyline[i], polyline[i + 1]);
  }

  /**
   * 对齐 Android NavRouteBearing.forwardChordBearingDeg：
   * 从 progress 到前方 lookahead 米的弦向。光束 = 脚下路径方向，不读 IMU。
   */
  function forwardChordBearingDeg(polyline, progressMeters, lookaheadM, metrics) {
    const MIN_SEG_M = 0.8;
    if (!polyline || polyline.length < 2) return 0;
    const m = metrics || buildRouteMetrics(polyline);
    const cum = m.cumulative;
    const total = m.total;
    if (!(total > 0)) return bearingDegrees(polyline[0], polyline[1]);
    const fromM = Math.max(0, Math.min(progressMeters || 0, total));
    const span = Math.max(lookaheadM, MIN_SEG_M);
    let toM = Math.min(fromM + span, total);
    if (toM - fromM < MIN_SEG_M) toM = total;
    const a = pointAtRouteDistance(polyline, fromM, m) || polyline[0];
    const b = pointAtRouteDistance(polyline, toM, m) || polyline[polyline.length - 1];
    if (distanceMeters(a, b) < MIN_SEG_M) {
      return segmentBearingSkippingShort(polyline, cum, fromM, 2.0);
    }
    return bearingDegrees(a, b);
  }

  /** 图纸北系 → 真北（罗盘）。MapLibre 相机应直接用 route 前向角，勿叠加 mapN。 */
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
    forwardChordBearingDeg,
    cameraBearingFromRouteDeg,
    elevationAtRouteDistance,
  };
}());
