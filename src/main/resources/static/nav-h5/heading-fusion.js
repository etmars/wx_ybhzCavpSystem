/** 对齐 HeadingFusionConfidence.kt */
(function () {
  const HF = {
    MIN_TOTAL_WEIGHT: 0.8,
    FEEDBACK_AGREE_DEG: 45,
    SESSION_ALPHA: 0.12,
    KNN_MIN_SPAN_M: 2.5,
    ROUTE_MAX_OFF_M: 8,
    TURN_SMOOTH_ALPHA: 0.35,
    TURN_RELEASE_STABLE_MS: 300,
    ICON_FUSE_ON_DEG: 25,
    ICON_FUSE_OFF_DEG: 18,
    KNN_STALE_MS: 1500,
    SENSOR_STALE_MS: 500,
  };

  function headingDiffDeg(a, b) {
    return Math.abs(((a - b + 540) % 360) - 180);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function circMeanWeighted(entries) {
    let sx = 0; let sy = 0; let sw = 0;
    entries.forEach(([deg, w]) => {
      if (w <= 0 || !Number.isFinite(deg)) return;
      const rad = (deg * Math.PI) / 180;
      sx += w * Math.sin(rad);
      sy += w * Math.cos(rad);
      sw += w;
    });
    if (sw <= 0) return null;
    let out = (Math.atan2(sx, sy) * 180) / Math.PI;
    if (out < 0) out += 360;
    return out;
  }

  function createHeadingFusionConfidence(mapId) {
    const session = { SENSOR: 0.55, KNN_MOTION: 0.55, ROUTE: 0.55 };
    const prior = { SENSOR: 0.6, KNN_MOTION: 0.72, ROUTE: 0.68 };
    const smoothedInstant = { SENSOR: 1, KNN_MOTION: 1, ROUTE: 1 };
    let lastFeedbackMs = 0;
    let navIconUseFusedHeading = false;

    function smoothInstant(source, raw) {
      const prev = smoothedInstant[source];
      const v = lerp(prev, Math.max(0, Math.min(1.25, raw)), 0.4);
      smoothedInstant[source] = v;
      return v;
    }

    function computeInstantSensor(ctx) {
      if (!ctx.hasSensor) return 0;
      let w = 1;
      if (ctx.offsetCalibrated) w *= 1.15;
      if (ctx.offsetFrozen) w *= 0.25;
      if (ctx.angularSpeedRadS > 0.35) w *= 0.35;
      if (ctx.sensorSampleAgeMs > HF.SENSOR_STALE_MS) {
        const stale = Math.min(2, (ctx.sensorSampleAgeMs - HF.SENSOR_STALE_MS) / 1000);
        w *= Math.max(0.5, 1 - stale * 0.25);
      }
      return w;
    }

    function computeInstantKnn(ctx) {
      if (!ctx.hasKnnMotion) return 0;
      if (ctx.forDisplay && ctx.onStraight) return 0;
      let w = Math.max(0.05, Math.min(1, ctx.histConfidence || 0.5));
      const spanFactor = Math.max(0, Math.min(1, ((ctx.knnSpanM || 0) - HF.KNN_MIN_SPAN_M) / 5.5));
      w *= 0.4 + 0.6 * spanFactor;
      if ((ctx.beaconAvg || 0) >= 20) w *= 1;
      else if (ctx.beaconAvg >= 15) w *= 0.9;
      else if (ctx.beaconAvg >= 10) w *= 0.75;
      else w *= 0.5;
      if ((ctx.knnTickAgeMs || 0) > HF.KNN_STALE_MS) w *= 0.4;
      if (ctx.nearTurn && (ctx.knnSpanM || 0) < 4) w *= 0.5;
      return w;
    }

    function computeInstantRoute(ctx) {
      if (!ctx.hasRoute) return 0;
      if ((ctx.snapOffRouteM || 99) > HF.ROUTE_MAX_OFF_M) return 0;
      let w = 0.55 + 0.45 * (1 - (ctx.snapOffRouteM || 0) / HF.ROUTE_MAX_OFF_M);
      if (ctx.onStraight) w *= 1.1;
      if (ctx.nearTurn) w = 0.5 + 0.5 * w;
      return Math.max(0, Math.min(1.2, w));
    }

    function effectiveWeights(ctx) {
      const raw = {
        SENSOR: computeInstantSensor(ctx),
        KNN_MOTION: computeInstantKnn(ctx),
        ROUTE: computeInstantRoute(ctx),
      };
      const result = {};
      ['SENSOR', 'KNN_MOTION', 'ROUTE'].forEach((s) => {
        const inst = smoothInstant(s, raw[s]);
        const eff = Math.max(0.05, Math.min(1.25, inst * session[s] * prior[s]));
        result[s] = { instant: inst, session: session[s], prior: prior[s], effective: eff };
      });
      return result;
    }

    function fuseHeading(ctx, bearings) {
      const weights = effectiveWeights(ctx);
      const entries = [];
      if (bearings.sensorDeg != null) entries.push([bearings.sensorDeg, weights.SENSOR.effective]);
      if (bearings.knnDeg != null) entries.push([bearings.knnDeg, weights.KNN_MOTION.effective]);
      if (bearings.routeDeg != null) entries.push([bearings.routeDeg, weights.ROUTE.effective]);
      const fused = circMeanWeighted(entries);
      if (!fused) return null;
      let totalW = 0;
      entries.forEach(([, w]) => { totalW += w; });
      if (totalW < HF.MIN_TOTAL_WEIGHT) return null;
      return { fused, weights, sensorDeg: bearings.sensorDeg, knnDeg: bearings.knnDeg, routeDeg: bearings.routeDeg };
    }

    function applyFeedback(referenceMapRelDeg, bearings, reason) {
      lastFeedbackMs = Date.now();
      ['SENSOR', 'KNN_MOTION', 'ROUTE'].forEach((s) => {
        const br = bearings[s === 'SENSOR' ? 'sensorDeg' : s === 'KNN_MOTION' ? 'knnDeg' : 'routeDeg'];
        if (br == null) return;
        const diff = headingDiffDeg(br, referenceMapRelDeg);
        const reward = Math.max(0, Math.min(1, 1 - diff / HF.FEEDBACK_AGREE_DEG));
        session[s] = lerp(session[s], reward, HF.SESSION_ALPHA);
        prior[s] = lerp(prior[s], reward, 0.04);
      });
    }

    function updateIconFuseState(rawIconDeg, fusedDeg) {
      if (fusedDeg == null) return rawIconDeg;
      const diff = headingDiffDeg(rawIconDeg, fusedDeg);
      if (navIconUseFusedHeading) {
        if (diff < HF.ICON_FUSE_OFF_DEG) navIconUseFusedHeading = false;
        return fusedDeg;
      }
      if (diff > HF.ICON_FUSE_ON_DEG) navIconUseFusedHeading = true;
      return navIconUseFusedHeading ? fusedDeg : rawIconDeg;
    }

    return {
      fuseHeading,
      applyFeedback,
      updateIconFuseState,
      headingDiffDeg,
      constants: HF,
      mapId,
    };
  }

  window.HeadingFusionConfidence = {
    create: createHeadingFusionConfidence,
    headingDiffDeg,
    circMeanWeighted,
    HF,
  };
}());
