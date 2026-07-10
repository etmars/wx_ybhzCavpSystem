/** 对齐 NavTurnExtractor.kt */
(function () {
  const G = window.NavGeo;

  function normalizeTurnDeg(rawDelta) {
    return ((rawDelta + 540) % 360) - 180;
  }

  function extractTurnCheckpoints(polyline, cumulativeMeters, minTurnDeg, lookAheadMeters, mergeWithinMeters = 6) {
    if (!polyline || polyline.length < 3 || cumulativeMeters.length !== polyline.length) return [];
    if (lookAheadMeters <= 0) return [];

    const raw = [];
    let i = 0;
    while (i < polyline.length - 1) {
      const startM = cumulativeMeters[i];
      let j = i + 1;
      while (j < polyline.length && cumulativeMeters[j] - startM < lookAheadMeters) j += 1;
      if (j >= polyline.length) break;

      let k = j;
      while (k < polyline.length && cumulativeMeters[k] - cumulativeMeters[j] < lookAheadMeters) k += 1;
      if (k >= polyline.length) break;

      const before = G.bearingDegrees(polyline[i], polyline[j]);
      const after = G.bearingDegrees(polyline[j], polyline[k]);
      const turn = normalizeTurnDeg(after - before);
      if (Math.abs(turn) >= minTurnDeg) {
        raw.push({
          progressMeters: cumulativeMeters[j],
          beforeBearingDeg: before,
          afterBearingDeg: after,
          turnDeg: turn,
        });
        i = k;
      } else {
        i += 1;
      }
    }
    return mergeNearby(raw, mergeWithinMeters);
  }

  function mergeNearby(list, withinMeters) {
    if (!list.length) return list;
    const merged = [];
    list.forEach((cp) => {
      const last = merged[merged.length - 1];
      if (last && cp.progressMeters - last.progressMeters < withinMeters) {
        if (Math.abs(cp.turnDeg) > Math.abs(last.turnDeg)) {
          merged[merged.length - 1] = cp;
        }
      } else {
        merged.push(cp);
      }
    });
    return merged;
  }

  function findNextTurnFromProgress(currentProgressMeters, routeTotalMeters, segmentBearingAt, minTurnDeg, lookAheadMeters, stepMeters = 2) {
    if (routeTotalMeters <= 0) return null;
    const cur = Math.max(0, Math.min(currentProgressMeters, routeTotalMeters));
    const baseBr = segmentBearingAt(cur);
    let probe = cur + Math.max(lookAheadMeters, stepMeters);
    while (probe <= routeTotalMeters) {
      const br = segmentBearingAt(probe);
      const turn = normalizeTurnDeg(br - baseBr);
      if (Math.abs(turn) >= minTurnDeg) {
        return { distanceMeters: Math.max(0, probe - cur), dir: turn > 0 ? 1 : -1 };
      }
      probe += stepMeters;
    }
    return null;
  }

  window.NavCheckpoints = {
    normalizeTurnDeg,
    extractTurnCheckpoints,
    findNextTurnFromProgress,
  };
}());
