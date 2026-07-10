/** 对齐 LocHistoryBuffer.kt */
(function () {
  const G = window.NavGeo;

  function projectAlongHeading(distM, bearingDeg, headingDeg) {
    const diff = ((bearingDeg - headingDeg) * Math.PI) / 180;
    return distM * Math.cos(diff);
  }

  function headingDiffDeg(a, b) {
    let d = Math.abs(a - b) % 360;
    if (d > 180) d = 360 - d;
    return d;
  }

  function createLocHistoryBuffer() {
    const frames = [];

    function pushAndEvaluate(frame, opts = {}) {
      if (frames.length > 0) {
        const gapMs = frame.timestampMs - frames[frames.length - 1].timestampMs;
        if (gapMs > 5000) frames.length = 0;
      }
      frames.push(frame);
      while (frames.length > 3) frames.shift();

      const n = frames.length;
      if (n < 2) {
        return {
          latestConfidence: 0.6,
          weightedLatLng: frame.latLng,
          reason: 'first_frame',
        };
      }

      if (opts.skipWeighting) {
        return {
          latestConfidence: frame.confidence != null ? frame.confidence : 0.6,
          weightedLatLng: frame.latLng,
          reason: 'preprocessed',
        };
      }

      const conf = new Array(n).fill(0.5);
      const MAX_SPEED_MPS = 8.5;
      const ABS_MAX_DIST_M = 30.0;

      for (let i = 0; i < n - 1; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          const prev = frames[i];
          const curr = frames[j];
          const dtSec = Math.max(0.001, (curr.timestampMs - prev.timestampMs) / 1000);
          const actualDist = G.distanceMeters(prev.latLng, curr.latLng);
          const maxPossible = Math.min(MAX_SPEED_MPS * dtSec, ABS_MAX_DIST_M);
          if (actualDist > maxPossible * 1.2) continue;

          const actualBearing = G.bearingDegrees(prev.latLng, curr.latLng);
          const prevHeading = prev.headingDeg || 0;
          const currHeading = curr.headingDeg || 0;
          const projPrev = projectAlongHeading(actualDist, actualBearing, prevHeading);
          const projCurr = projectAlongHeading(actualDist, actualBearing, currHeading);
          if (projCurr < 0 && actualDist > 1.0) {
            conf[j] *= 0.25;
            continue;
          }
          if (projPrev < 0 && projCurr < 0 && actualDist > 1.0) {
            conf[j] *= 0.3;
            continue;
          }
          const angleDiffPrev = headingDiffDeg(actualBearing, prevHeading);
          const angleDiffCurr = headingDiffDeg(actualBearing, currHeading);
          if (Math.abs(angleDiffPrev) > 60 && Math.abs(angleDiffCurr) > 60 && actualDist > 2.0) {
            continue;
          }
          conf[j] = 1;
        }
      }

      const avgBeacon = frames.reduce((s, f) => s + (f.beaconCount || 0), 0) / n;
      const level = avgBeacon >= 20 ? 1 : avgBeacon >= 15 ? 0.85 : avgBeacon >= 10 ? 0.65 : 0.4;
      if (level < 1) {
        for (let k = 0; k < n; k += 1) conf[k] *= level;
      }

      for (let k = 0; k < n; k += 1) {
        conf[k] = Math.max(0.05, Math.min(1, conf[k]));
      }

      let sumW = 0; let sumLat = 0; let sumLon = 0;
      for (let k = 0; k < n; k += 1) {
        const w = Math.max(0.05, conf[k]);
        sumW += w;
        sumLat += frames[k].latLng.latitude * w;
        sumLon += frames[k].latLng.longitude * w;
      }
      const weightedLatLng = sumW > 0
        ? { latitude: sumLat / sumW, longitude: sumLon / sumW }
        : frames[n - 1].latLng;

      return {
        latestConfidence: conf[n - 1],
        weightedLatLng,
        reason: 'ok',
      };
    }

    function motionSpanMeters() {
      if (frames.length < 2) return 0;
      return G.distanceMeters(frames[0].latLng, frames[frames.length - 1].latLng);
    }

    function motionBearingTrueNorthDeg(minSpanM = 2.5) {
      if (frames.length < 2) return null;
      const span = motionSpanMeters();
      if (span < minSpanM) return null;
      return G.bearingDegrees(frames[0].latLng, frames[frames.length - 1].latLng);
    }

    function clear() { frames.length = 0; }

    return {
      pushAndEvaluate,
      motionSpanMeters,
      motionBearingTrueNorthDeg,
      clear,
      get size() { return frames.length; },
    };
  }

  window.LocHistoryBuffer = { create: createLocHistoryBuffer };
}());
