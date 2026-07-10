/**
 * 导航渲染引擎 — 对齐 MainActivity renderSmoothNavDot / advanceRenderProgress / snapToRoute
 */
(function () {
  const T = window.NavTuning;
  const G = window.NavGeo;
  const CP = window.NavCheckpoints;

  function createNavEngine(options = {}) {
    const state = {
      route: [],
      metrics: { cumulative: [0], total: 0 },
      checkpoints: [],
      destination: null,
      mapNorthBearingDeg: options.mapNorthBearingDeg || 0,
      navFlow: options.navFlow || 'PARKING_ENTRY',
      navigating: false,
      navArrivalFrozen: false,
      navArrivalFinishing: false,
      navArrivalConfirmCount: 0,

      navRouteProgressMeters: 0,
      navMaxProgressMeters: 0,
      renderProgressMeters: -1,
      renderProgressTarget: 0,
      renderProgressAnimStart: 0,
      renderProgressAnimFrom: 0,
      renderProgressAnimTo: 0,
      renderProgressAnimDuration: 0,
      renderProgressAnimPreferSlow: false,

      lastMeasuredProgressMeters: 0,
      lastMeasuredProgressMs: 0,
      navKnnSpeedMps: 0,
      imuSpeedMps: 0,
      navSnappedLocation: null,

      smoothNavHeadingDeg: null,
      smoothNavCameraBearingDeg: null,
      lastNavCameraEaseTarget: null,
      lastNavCameraEaseBearingDeg: null,

      navTurnHoldCpIdx: -1,
      navTurnReleasedCpIdx: -1,
      navTurnHoldSinceMs: 0,
      navStartHeadingHold: false,
      navStartHeadingHoldReleased: false,

      lastKnnTs: 0,
      lastSnapOffRouteM: 99,
      lastRawSnapProgressMeters: 0,
      navTurnKnnPastVertexBuf: [],
      navTurnKnnCatchupTargetMeters: NaN,
      navTurnKnnCatchupCpIdx: -1,
      navTurnReleaseStableSinceMs: 0,
      imuRenderScale: 1,
      imuRawIntegralSinceMeasM: 0,
      navImuDrEnabled: false,
      navStartProgressMeters: 0,
      lastFusedHeadingResult: null,
      sensorBearingDeg: null,
      sensorAngularSpeedRadS: 0,
      beaconCount: 0,
      histConfidence: 0.6,
      navParked: false,
      serverTotalLen: 0,
      serverEtaSec: 0,
      navRouteSpeedMps: 0,
      navImuAccelLaunchSinceMs: 0,
      navRealForwardConfirmed: false,
      navStartHeadingHoldImuMeters: 0,
      navLocSuccessCount: 0,
      navParkingEntryReanchorDone: false,
      rotationOnly: false,
      navImuDrAccumMeters: 0,
      navStartHeadingFusionStableSinceMs: 0,
      imuLaunchConfirmed: false,
      avpVelProgressM: NaN,
      avpVelProgressMs: 0,
      speedBumpTracker: null,
      lastBumpTsHandled: 0,
    };

    const locHistory = window.LocHistoryBuffer.create();
    const headingFusion = window.HeadingFusionConfidence.create(options.mapId);

    function setRoute(points) {
      state.route = points || [];
      state.metrics = G.buildRouteMetrics(state.route);
      state.destination = state.route.length ? state.route[state.route.length - 1] : null;
      state.checkpoints = CP.extractTurnCheckpoints(
        state.route,
        state.metrics.cumulative,
        T.CHECKPOINT_MIN_TURN_DEG,
        T.NAV_TURN_LOOKAHEAD_M,
      );
      resetNavProgress();
    }

    function resetNavProgress() {
      state.navRouteProgressMeters = 0;
      state.navMaxProgressMeters = 0;
      state.renderProgressMeters = -1;
      state.renderProgressTarget = 0;
      state.navArrivalFinishing = false;
      state.navArrivalConfirmCount = 0;
      state.navTurnHoldCpIdx = -1;
      state.navTurnReleasedCpIdx = -1;
      state.navStartHeadingHold = false;
      state.navStartHeadingHoldReleased = false;
      if (state.route.length >= 2) {
        state.navSnappedLocation = state.route[0];
        const br = G.bearingDegrees(state.route[0], state.route[1]);
        state.smoothNavHeadingDeg = br;
      }
    }

    function seedAtRouteStart(initialHeading) {
      if (state.route.length < 2) return;
      state.navSnappedLocation = state.route[0];
      state.renderProgressMeters = 0;
      state.navRouteProgressMeters = 0;
      state.navMaxProgressMeters = 0;
      state.navStartProgressMeters = 0;
      state.navStartHeadingHoldImuMeters = 0;
      const br = initialHeading != null
        ? initialHeading
        : G.bearingDegrees(state.route[0], state.route[1]);
      state.smoothNavHeadingDeg = br;
      if (state.navFlow === 'PARKING_ENTRY') {
        const routeBr = G.bearingDegrees(state.route[0], state.route[1]);
        if (G.headingDiffDeg(br, routeBr) >= T.NAV_START_HEADING_HOLD_ENTER_DEG) {
          state.navStartHeadingHold = true;
        }
      }
    }

    function navProgressNoRetreat(candidate) {
      const forward = Math.max(candidate, state.navMaxProgressMeters);
      state.navMaxProgressMeters = Math.max(state.navMaxProgressMeters, forward);
      return forward;
    }

    function setServerMetrics(totalLen, etaSec) {
      if (totalLen > 0) state.serverTotalLen = totalLen;
      if (etaSec > 0) state.serverEtaSec = etaSec;
    }

    function attachSpeedBumpTracker(tracker) {
      state.speedBumpTracker = tracker;
    }

    function isNavParked() {
      return state.navigating && !!state.navParked;
    }

    function capProgressForTurnCeiling(progressMeters, headingDeg) {
      if (!state.checkpoints.length) return progressMeters;
      const heading = headingDeg != null ? headingDeg : fusedHeadingForTurnCompareDeg();
      const renderProgress = state.renderProgressMeters >= 0 ? state.renderProgressMeters : 0;
      const probe = Math.max(progressMeters, state.navRouteProgressMeters, renderProgress);
      for (let i = 0; i < state.checkpoints.length; i += 1) {
        if (i <= state.navTurnReleasedCpIdx) continue;
        const cp = state.checkpoints[i];
        if (probe < cp.progressMeters - T.CHECKPOINT_APPROACH_M) continue;
        if (probe > cp.progressMeters + T.CHECKPOINT_PASS_MAX_M) {
          state.navTurnReleasedCpIdx = Math.max(state.navTurnReleasedCpIdx, i);
          continue;
        }
        if (isTurnHeadingReleased(cp, heading)) {
          state.navTurnReleasedCpIdx = Math.max(state.navTurnReleasedCpIdx, i);
          continue;
        }
        const ceiling = state.navTurnHoldCpIdx === i
          ? Math.min(Math.max(0, cp.progressMeters - T.CHECKPOINT_HOLD_BEFORE_M), cp.progressMeters)
          : cp.progressMeters;
        let v = Math.min(progressMeters, ceiling);
        const holdCap = turnHoldProgressCapMeters();
        if (holdCap != null) v = Math.min(v, holdCap);
        return v;
      }
      const holdCap = turnHoldProgressCapMeters();
      if (holdCap != null) return Math.min(progressMeters, holdCap);
      return progressMeters;
    }

    function capProgressForHolds(candidate, now) {
      let capped = candidate;
      if (state.navStartHeadingHold && !state.navStartHeadingHoldReleased) {
        capped = Math.min(capped, Math.max(state.navStartHeadingHoldImuMeters, 0.5));
      }
      const cpIdx = activeTurnHoldCheckpoint(now);
      if (cpIdx >= 0) {
        const cp = state.checkpoints[cpIdx];
        const holdCap = Math.max(0, cp.progressMeters - T.CHECKPOINT_HOLD_BEFORE_M);
        capped = Math.min(capped, holdCap);
      }
      capped = capProgressForTurnCeiling(capped);
      return capped;
    }

    function activeTurnHoldCheckpoint(now) {
      if (state.navTurnHoldCpIdx >= 0) return state.navTurnHoldCpIdx;
      const probe = Math.max(state.renderProgressMeters, state.navRouteProgressMeters);
      for (let i = 0; i < state.checkpoints.length; i += 1) {
        const cp = state.checkpoints[i];
        if (i <= state.navTurnReleasedCpIdx) continue;
        if (probe >= cp.progressMeters - T.CHECKPOINT_APPROACH_M
          && probe <= cp.progressMeters + T.CHECKPOINT_PASS_MAX_M) {
          return i;
        }
      }
      return -1;
    }

    function isTurnHeadingReleased(cp, heading) {
      return G.headingDiffDeg(heading, cp.afterBearingDeg) <= T.CHECKPOINT_HEADING_TOLERANCE_DEG;
    }

    function isTurnHeadingReleasedStable(cp, heading, now, allowTimeout) {
      if (isTurnHeadingReleased(cp, heading)) {
        if (state.navTurnReleaseStableSinceMs <= 0) state.navTurnReleaseStableSinceMs = now;
        if (now - state.navTurnReleaseStableSinceMs >= (window.HeadingFusionConfidence.HF.TURN_RELEASE_STABLE_MS || 300)) {
          return true;
        }
      } else {
        state.navTurnReleaseStableSinceMs = 0;
      }
      return allowTimeout;
    }

    function turnHoldProgressCapMeters() {
      if (state.navTurnHoldCpIdx < 0) return null;
      const cp = state.checkpoints[state.navTurnHoldCpIdx];
      if (!cp) return null;
      return Math.max(0, cp.progressMeters - T.CHECKPOINT_HOLD_BEFORE_M);
    }

    function resetTurnKnnCatchupState() {
      state.navTurnKnnPastVertexBuf = [];
      state.navTurnKnnCatchupTargetMeters = NaN;
      state.navTurnKnnCatchupCpIdx = -1;
    }

    function recordTurnHoldKnnRawSnap(progressMeters) {
      if (state.navTurnHoldCpIdx < 0) return;
      const cp = state.checkpoints[state.navTurnHoldCpIdx];
      if (!cp) return;
      const vertex = cp.progressMeters;
      if (progressMeters <= vertex + (T.TURN_KNN_PAST_VERTEX_EPS_M || 0.05)) return;
      state.navTurnKnnPastVertexBuf.push(progressMeters);
      if (state.navTurnKnnPastVertexBuf.length < (T.TURN_KNN_PAST_VERTEX_FRAME_COUNT || 3)) return;
      const avg = state.navTurnKnnPastVertexBuf.reduce((a, b) => a + b, 0) / state.navTurnKnnPastVertexBuf.length;
      state.navTurnKnnPastVertexBuf = [];
      state.navTurnKnnCatchupTargetMeters = Math.max(0, Math.min(avg, state.metrics.total));
      state.navTurnKnnCatchupCpIdx = state.navTurnHoldCpIdx;
    }

    function finishTurnKnnCatchup() {
      const target = state.navTurnKnnCatchupTargetMeters;
      const cpIdx = state.navTurnKnnCatchupCpIdx;
      resetTurnKnnCatchupState();
      if (!Number.isFinite(target) || cpIdx < 0) return;
      state.navRouteProgressMeters = navProgressNoRetreat(Math.max(state.navRouteProgressMeters, target));
      state.lastMeasuredProgressMeters = Math.max(state.lastMeasuredProgressMeters, target);
      if (state.navTurnHoldCpIdx === cpIdx) {
        state.navTurnReleasedCpIdx = Math.max(state.navTurnReleasedCpIdx, cpIdx);
        state.navTurnHoldCpIdx = -1;
        state.navTurnHoldSinceMs = 0;
      } else {
        state.navTurnReleasedCpIdx = Math.max(state.navTurnReleasedCpIdx, cpIdx);
      }
    }

    function advanceTurnKnnCatchupRender(now) {
      const target = state.navTurnKnnCatchupTargetMeters;
      if (!Number.isFinite(target)) return;
      state.renderProgressAnimDuration = 0;
      const displayNow = currentRenderProgress(now);
      const frameDt = T.NAV_DOT_INTERVAL_MS / 1000;
      const stepped = Math.min(displayNow + (T.NAV_TURN_KNN_CATCHUP_MPS || 8) * frameDt, target);
      state.renderProgressMeters = navProgressNoRetreat(Math.min(stepped, target));
      state.navRouteProgressMeters = navProgressNoRetreat(Math.max(state.navRouteProgressMeters, state.renderProgressMeters));
      state.navSnappedLocation = G.pointAtRouteDistance(state.route, state.renderProgressMeters, state.metrics);
      if (stepped >= target - 0.02) finishTurnKnnCatchup();
    }

    function fusedHeadingForTurnCompareDeg() {
      if (state.smoothNavHeadingDeg != null) return state.smoothNavHeadingDeg;
      const p = Math.max(state.renderProgressMeters, state.navRouteProgressMeters);
      return G.routeForwardBearingAtProgress(state.route, p, state.metrics);
    }

    function computeFusedHeading(displayProgress, now, forDisplay) {
      const HP = window.NavHeadingPolicy;
      const phase = HP.resolvePhase(
        state.navLocSuccessCount,
        state.navRealForwardConfirmed,
        isNavParked(),
      );
      const routeDeg = G.routeForwardBearingAtProgress(state.route, displayProgress, state.metrics);
      const knnTn = locHistory.motionBearingTrueNorthDeg(window.HeadingFusionConfidence.HF.KNN_MIN_SPAN_M);
      const knnDeg = knnTn != null
        ? ((knnTn - state.mapNorthBearingDeg + 360) % 360)
        : null;
      const sensorDeg = state.sensorBearingDeg != null
        ? ((state.sensorBearingDeg - state.mapNorthBearingDeg + 360) % 360)
        : null;

      if (HP.useRouteHeadingForIcon(state.navFlow, phase) && routeDeg != null) {
        return routeDeg;
      }
      if (HP.preferImuRelativeHeading(state.navFlow, phase) && sensorDeg != null) {
        return sensorDeg;
      }

      const allowKnnCal = HP.allowKnnHeadingCalibrate(
        state.navFlow,
        state.navRealForwardConfirmed,
        false,
        state.rotationOnly,
      );
      const onStraight = CP.findNextTurnFromProgress(
        displayProgress,
        state.metrics.total,
        (m) => G.routeSegmentBearingAtDistance(state.route, m, state.metrics),
        T.CHECKPOINT_MIN_TURN_DEG,
        T.NAV_TURN_LOOKAHEAD_M,
      ) == null;
      const ctx = {
        hasSensor: state.sensorBearingDeg != null,
        offsetCalibrated: true,
        offsetFrozen: false,
        angularSpeedRadS: state.sensorAngularSpeedRadS,
        sensorSampleAgeMs: state.lastKnnTs > 0 ? now - state.lastKnnTs : 9999,
        hasKnnMotion: allowKnnCal && knnDeg != null,
        knnSpanM: locHistory.motionSpanMeters(),
        histConfidence: state.histConfidence,
        beaconAvg: state.beaconCount,
        knnTickAgeMs: state.lastKnnTs > 0 ? now - state.lastKnnTs : 99999,
        hasRoute: state.route.length >= 2,
        snapOffRouteM: state.lastSnapOffRouteM,
        onStraight,
        nearTurn: activeTurnHoldCheckpoint(now) >= 0,
        forDisplay,
      };
      const result = headingFusion.fuseHeading(ctx, { sensorDeg, knnDeg: allowKnnCal ? knnDeg : null, routeDeg });
      state.lastFusedHeadingResult = result;
      if (!result) return routeDeg;
      return headingFusion.updateIconFuseState(routeDeg, result.fused);
    }

    function updateTurnHoldState(now, userHeadingDeg) {
      const heading = userHeadingDeg != null ? userHeadingDeg : fusedHeadingForTurnCompareDeg();
      if (state.navTurnHoldCpIdx >= 0) {
        const cp = state.checkpoints[state.navTurnHoldCpIdx];
        const holdMs = state.navTurnHoldSinceMs > 0 ? now - state.navTurnHoldSinceMs : 0;
        const allowTimeout = holdMs >= T.TURN_HOLD_TIMEOUT_MS;
        if (cp && isTurnHeadingReleasedStable(cp, heading, now, allowTimeout)) {
          if (state.lastFusedHeadingResult) {
            headingFusion.applyFeedback(cp.afterBearingDeg, state.lastFusedHeadingResult, 'turn_release');
          }
          state.navTurnReleasedCpIdx = Math.max(state.navTurnReleasedCpIdx, state.navTurnHoldCpIdx);
          state.navTurnHoldCpIdx = -1;
          state.navTurnHoldSinceMs = 0;
          state.navTurnReleaseStableSinceMs = 0;
          resetTurnKnnCatchupState();
          return;
        }
        recordTurnHoldKnnRawSnap(state.lastRawSnapProgressMeters);
        return;
      }

      const renderProgress = state.renderProgressMeters >= 0 ? state.renderProgressMeters : 0;
      for (let i = 0; i < state.checkpoints.length; i += 1) {
        if (i <= state.navTurnReleasedCpIdx) continue;
        const cp = state.checkpoints[i];
        const probe = Math.max(renderProgress, state.navRouteProgressMeters);
        if (probe < cp.progressMeters - T.CHECKPOINT_APPROACH_M) continue;
        if (probe > cp.progressMeters + T.CHECKPOINT_PASS_MAX_M) {
          state.navTurnReleasedCpIdx = Math.max(state.navTurnReleasedCpIdx, i);
          continue;
        }
        if (isTurnHeadingReleased(cp, heading)) {
          state.navTurnReleasedCpIdx = Math.max(state.navTurnReleasedCpIdx, i);
          resetTurnKnnCatchupState();
          if (renderProgress < cp.progressMeters + (T.CHECKPOINT_PUSH_AHEAD_M || 8)) {
            const target = Math.min(cp.progressMeters + (T.CHECKPOINT_PUSH_AHEAD_M || 8), state.metrics.total);
            scheduleRenderProgressAnim(now, capProgressForHolds(target, now), false);
          }
          continue;
        }
        const diffBefore = G.headingDiffDeg(heading, cp.beforeBearingDeg);
        const diffAfter = G.headingDiffDeg(heading, cp.afterBearingDeg);
        if (renderProgress >= cp.progressMeters - T.CHECKPOINT_HOLD_ENTER_M
          && diffBefore <= T.CHECKPOINT_HEADING_TOLERANCE_DEG
          && diffBefore <= diffAfter) {
          state.navTurnHoldCpIdx = i;
          state.navTurnHoldSinceMs = now;
          return;
        }
      }
    }

    function releaseStartHeadingHold(userHeadingDeg, now) {
      if (!state.navStartHeadingHold || state.navStartHeadingHoldReleased) return;
      if (state.route.length < 2) return;
      const routeBr = G.bearingDegrees(state.route[0], state.route[1]);
      const heading = userHeadingDeg != null ? userHeadingDeg : state.smoothNavHeadingDeg;
      if (heading != null && G.headingDiffDeg(heading, routeBr) <= T.CHECKPOINT_HEADING_TOLERANCE_DEG) {
        state.navStartHeadingHoldReleased = true;
        state.navStartHeadingHold = false;
        state.navStartHeadingFusionStableSinceMs = 0;
      } else if (state.navStartHeadingHoldImuMeters >= T.NAV_REQUIRE_FORWARD_M) {
        state.navStartHeadingHoldReleased = true;
        state.navStartHeadingHold = false;
        state.navStartHeadingFusionStableSinceMs = 0;
      } else if (isStartHeadingFusionAlignedStable(now || Date.now())) {
        state.navStartHeadingHoldReleased = true;
        state.navStartHeadingHold = false;
        state.navStartHeadingFusionStableSinceMs = 0;
      }
    }

    function isStartHeadingFusionAligned(now) {
      if (!state.navStartHeadingHold || state.navStartHeadingHoldReleased) return false;
      if (state.route.length < 2) return false;
      const routeBr = G.bearingDegrees(state.route[0], state.route[1]);
      const displayP = state.renderProgressMeters >= 0 ? state.renderProgressMeters : 0;
      const fused = computeFusedHeading(displayP, now, true);
      return G.headingDiffDeg(fused, routeBr) <= T.CHECKPOINT_HEADING_TOLERANCE_DEG;
    }

    function isStartHeadingFusionAlignedStable(now) {
      if (!isStartHeadingFusionAligned(now)) {
        state.navStartHeadingFusionStableSinceMs = 0;
        return false;
      }
      if (state.navStartHeadingFusionStableSinceMs <= 0) {
        state.navStartHeadingFusionStableSinceMs = now;
        return false;
      }
      const stableMs = window.HeadingFusionConfidence.HF.TURN_RELEASE_STABLE_MS || 300;
      return now - state.navStartHeadingFusionStableSinceMs >= stableMs;
    }

    function navImuDeadReckoningEnabled(now) {
      if (!state.navigating || isNavParked() || state.navLocSuccessCount < 1) return false;
      if (state.navRealForwardConfirmed) return true;
      if (state.navStartHeadingHold && !state.navStartHeadingHoldReleased) return false;
      return state.imuLaunchConfirmed || state.navImuDrEnabled;
    }

    function capProgressForAllHolds(candidate, now) {
      return capProgressForHolds(capProgressForTurnCeiling(candidate, headingDegForCap(now)), now);
    }

    function headingDegForCap(now) {
      const displayP = state.renderProgressMeters >= 0 ? state.renderProgressMeters : state.navRouteProgressMeters;
      return computeFusedHeading(displayP, now, false);
    }

    function bumpRenderProgressTarget(displayMeters, now) {
      scheduleRenderProgressAnim(now, displayMeters, false);
    }

    function updateSoftRouteDisplayFromPred(pred, now) {
      if (isNavParked()) return;
      if (!navImuDeadReckoningEnabled(now)) return;
      if (state.route.length < 2) return;
      const candidate = G.projectPointOnRoute(pred, state.route, state.metrics);
      if (!candidate || candidate.distanceMeters > T.NAV_ROUTE_MAX_SNAP_DISTANCE_METERS) return;
      const base = state.renderProgressMeters >= 0
        ? Math.max(state.renderProgressMeters, currentRenderProgress(now))
        : state.navRouteProgressMeters;
      const maxAdvance = T.NAV_SOFT_DISPLAY_MAX_ADVANCE_M || 5.0;
      let displayMeters = Math.min(candidate.progressMeters, base + maxAdvance);
      displayMeters = Math.max(displayMeters, state.navRouteProgressMeters);
      displayMeters = navProgressNoRetreat(displayMeters);
      displayMeters = capProgressForAllHolds(displayMeters, now);
      bumpRenderProgressTarget(displayMeters, now);
    }

    function maybeReanchorParkingEntryOnFirstKnn(rawLoc, now) {
      if (state.navParkingEntryReanchorDone || state.navFlow !== 'PARKING_ENTRY') return;
      if (!state.navigating || state.navLocSuccessCount !== 1) return;
      if (state.route.length < 2) return;
      const projection = G.projectPointOnRoute(rawLoc, state.route, state.metrics);
      if (!projection || projection.distanceMeters > T.NAV_ROUTE_MAX_SNAP_DISTANCE_METERS) return;
      const baseline = Math.max(0, state.navStartProgressMeters);
      const delta = Math.abs(projection.progressMeters - baseline);
      const minDelta = T.PARKING_ENTRY_REANCHOR_MIN_DELTA_M || 30;
      if (delta <= minDelta) return;

      state.navParkingEntryReanchorDone = true;
      const newProgress = projection.progressMeters;
      state.navRouteProgressMeters = navProgressNoRetreat(newProgress);
      state.navMaxProgressMeters = Math.max(state.navMaxProgressMeters, newProgress);
      state.navStartProgressMeters = newProgress;
      state.navRealForwardConfirmed = false;
      state.navImuDrEnabled = false;
      state.renderProgressMeters = newProgress;
      state.renderProgressTarget = newProgress;
      state.renderProgressAnimDuration = 0;
      state.lastMeasuredProgressMeters = newProgress;
      state.lastMeasuredProgressMs = now;
      state.navSnappedLocation = projection.point;
    }

    function snapToRoute(raw, advanceProgress, now, userHeadingDeg) {
      if (state.route.length < 2) return raw;
      if (advanceProgress && state.navigating) {
        releaseStartHeadingHold(userHeadingDeg, now);
        updateTurnHoldState(now, userHeadingDeg);
      }
      const candidate = G.projectPointOnRoute(raw, state.route, state.metrics);
      if (!candidate) return state.navSnappedLocation || raw;
      state.lastSnapOffRouteM = candidate.distanceMeters;
      state.lastRawSnapProgressMeters = candidate.progressMeters;
      if (candidate.distanceMeters > T.NAV_ROUTE_MAX_SNAP_DISTANCE_METERS) {
        return state.navSnappedLocation || raw;
      }
      if (!advanceProgress) return candidate.point;

      if (isNavParked()) {
        return state.navSnappedLocation || candidate.point;
      }

      const current = state.navRouteProgressMeters;
      const maxAllowed = isNavParked() ? 0 : current + T.NAV_MAX_ADVANCE_PER_TICK_METERS;
      let limitedMeters = Math.max(current, Math.min(candidate.progressMeters, maxAllowed));
      limitedMeters = capProgressForHolds(limitedMeters, now);
      limitedMeters = navProgressNoRetreat(limitedMeters);
      const limitedPoint = G.pointAtRouteDistance(state.route, limitedMeters, state.metrics) || candidate.point;
      state.navRouteProgressMeters = navProgressNoRetreat(Math.max(state.navRouteProgressMeters, limitedMeters));
      state.navSnappedLocation = limitedPoint;
      return limitedPoint;
    }

    function onKnnMeasurement(raw, meta = {}) {
      if (state.navArrivalFrozen || !state.route.length) return null;
      const now = meta.now || Date.now();
      state.lastKnnTs = now;
      state.beaconCount = meta.beaconCount || 0;
      state.navParked = !!meta.parked;
      if (meta.histConfidence != null) state.histConfidence = meta.histConfidence;
      if (meta.bearing != null) state.sensorBearingDeg = meta.bearing;
      if (meta.angularSpeedRadS != null) state.sensorAngularSpeedRadS = meta.angularSpeedRadS;
      if (meta.navLocSuccessCount != null) state.navLocSuccessCount = meta.navLocSuccessCount;
      if (meta.rotationOnly != null) state.rotationOnly = !!meta.rotationOnly;
      if (meta.imuLaunchConfirmed != null) state.imuLaunchConfirmed = !!meta.imuLaunchConfirmed;

      if (meta.softDisplay) {
        updateSoftRouteDisplayFromPred(raw, now);
        const displayP = state.renderProgressMeters >= 0 ? state.renderProgressMeters : state.navRouteProgressMeters;
        const fused = computeFusedHeading(displayP, now, true);
        updateHeading(fused);
        return state.navSnappedLocation;
      }

      if (meta.bumpDetected && meta.bumpTs && meta.bumpTs !== state.lastBumpTsHandled && state.speedBumpTracker) {
        const anchorM = state.speedBumpTracker.onBumpDetected(
          Math.max(state.renderProgressMeters, state.navRouteProgressMeters),
          T.BUMP_GEO_GATE_M || 8,
          T.BUMP_MATCH_EXTRA_M || 12,
        );
        if (anchorM != null) {
          state.lastBumpTsHandled = meta.bumpTs;
          const bumped = navProgressNoRetreat(Math.max(state.navRouteProgressMeters, anchorM));
          state.navRouteProgressMeters = bumped;
          scheduleRenderProgressAnim(now, bumped, false);
        }
      }

      const histPreprocessed = !meta.softDisplay && meta.histConfidence != null;
      const hist = locHistory.pushAndEvaluate({
        latLng: { latitude: raw.latitude, longitude: raw.longitude },
        headingDeg: meta.bearing || 0,
        timestampMs: now,
        beaconCount: meta.beaconCount || 0,
        confidence: meta.histConfidence,
      }, { skipWeighting: histPreprocessed });
      state.histConfidence = hist.latestConfidence || meta.histConfidence || 0.6;

      maybeReanchorParkingEntryOnFirstKnn(raw, now);

      const headingForSnap = meta.bearing != null ? meta.bearing : state.smoothNavHeadingDeg;
      const snapped = snapToRoute(
        { latitude: raw.latitude, longitude: raw.longitude },
        state.navigating,
        now,
        headingForSnap,
      );

      if (state.navigating) {
        if (!state.navRealForwardConfirmed
          && state.navRouteProgressMeters - state.navStartProgressMeters >= (T.NAV_REQUIRE_FORWARD_M || 2.5)) {
          state.navRealForwardConfirmed = true;
          state.navImuDrEnabled = true;
        }
        if (state.navStartHeadingHold && !state.navStartHeadingHoldReleased && meta.imuSpeedMps > 0.05) {
          state.navStartHeadingHoldImuMeters += meta.imuSpeedMps * (T.NAV_DOT_INTERVAL_MS / 1000);
        }
        state.navRouteSpeedMps = Math.max(state.imuSpeedMps, state.navKnnSpeedMps);
        if (state.navRouteProgressMeters > state.lastMeasuredProgressMeters + 1e-3) {
          const dtSec = state.lastMeasuredProgressMs > 0
            ? Math.max(0.5, (now - state.lastMeasuredProgressMs) / 1000)
            : 0.5;
          const advance = state.navRouteProgressMeters - state.lastMeasuredProgressMeters;
          const speed = advance / dtSec;
          state.navKnnSpeedMps = state.navKnnSpeedMps * (1 - T.NAV_KNN_SPEED_ALPHA)
            + speed * T.NAV_KNN_SPEED_ALPHA;
          if (advance > 0.3 && state.imuRawIntegralSinceMeasM > 0.3) {
            const s = Math.max(T.NAV_IMU_SCALE_MIN || 0.3, Math.min(T.NAV_IMU_SCALE_MAX || 3, advance / state.imuRawIntegralSinceMeasM));
            state.imuRenderScale = state.imuRenderScale * (1 - (T.NAV_IMU_SCALE_ALPHA || 0.3)) + s * (T.NAV_IMU_SCALE_ALPHA || 0.3);
          }
          state.imuRawIntegralSinceMeasM = 0;
          state.lastMeasuredProgressMeters = state.navRouteProgressMeters;
          state.lastMeasuredProgressMs = now;
        }
      }

      if (meta.imuSpeedMps != null && Number.isFinite(meta.imuSpeedMps)) {
        state.imuSpeedMps = Math.max(0, meta.imuSpeedMps);
      }

      const displayP = state.renderProgressMeters >= 0 ? state.renderProgressMeters : state.navRouteProgressMeters;
      const fused = computeFusedHeading(displayP, now, true);
      updateHeading(fused);
      releaseStartHeadingHold(fused, now);
      return snapped;
    }

    function navImuMaxLeadMeters(now) {
      const speed = Math.max(state.imuSpeedMps, state.navKnnSpeedMps);
      if (speed <= 0.05 || state.lastMeasuredProgressMs <= 0) return T.NAV_IMU_MAX_LEAD_BASE_M;
      const silentSec = Math.max(0, Math.min((now - state.lastMeasuredProgressMs) / 1000, T.NAV_IMU_MAX_SILENT_SEC));
      const timeExtra = Math.max(0, silentSec - 1.5) * speed;
      return Math.min(T.NAV_IMU_MAX_LEAD_BASE_M + timeExtra, T.NAV_IMU_MAX_LEAD_CAP_M);
    }

    function scheduleRenderProgressAnim(now, target, preferSlow = false) {
      const from = currentRenderProgress(now);
      if (Math.abs(target - from) < 0.02) {
        state.renderProgressMeters = target;
        state.renderProgressTarget = target;
        return;
      }
      const gap = Math.abs(target - from);
      const speed = preferSlow || gap > T.NAV_RENDER_CATCHUP_SLOW_GAP_M
        ? T.NAV_RENDER_CATCHUP_SLOW_MPS
        : T.NAV_RENDER_CATCHUP_SPEED_MPS;
      const duration = Math.max(
        T.NAV_RENDER_CATCHUP_MIN_MS,
        Math.min((gap / Math.max(speed, 0.1)) * 1000, preferSlow ? 4000 : T.NAV_RENDER_CATCHUP_MAX_MS),
      );
      state.renderProgressAnimStart = now;
      state.renderProgressAnimFrom = from;
      state.renderProgressAnimTo = target;
      state.renderProgressAnimDuration = duration;
      state.renderProgressAnimPreferSlow = preferSlow;
      state.renderProgressTarget = target;
    }

    function tickRenderProgressAnim(now) {
      if (state.renderProgressAnimDuration <= 0) return null;
      const elapsed = now - state.renderProgressAnimStart;
      if (elapsed >= state.renderProgressAnimDuration) {
        state.renderProgressMeters = state.renderProgressAnimTo;
        state.renderProgressAnimDuration = 0;
        return state.renderProgressAnimTo;
      }
      const t = elapsed / state.renderProgressAnimDuration;
      const eased = t * t * (3 - 2 * t);
      const v = state.renderProgressAnimFrom + (state.renderProgressAnimTo - state.renderProgressAnimFrom) * eased;
      state.renderProgressMeters = v;
      return v;
    }

    function currentRenderProgress(now) {
      if (state.renderProgressMeters < 0) return 0;
      if (state.renderProgressAnimDuration > 0) {
        return tickRenderProgressAnim(now) ?? state.renderProgressMeters;
      }
      return state.renderProgressMeters;
    }

    function advanceRenderProgress(now) {
      const measured = state.navRouteProgressMeters;
      if (state.renderProgressMeters < 0) {
        state.renderProgressMeters = 0;
        state.renderProgressTarget = measured;
        state.lastMeasuredProgressMeters = measured;
        state.lastMeasuredProgressMs = now;
      }

      if (state.navArrivalFinishing && state.metrics.total > 0) {
        scheduleRenderProgressAnim(now, state.metrics.total, false);
        tickRenderProgressAnim(now);
        const display = Math.min(currentRenderProgress(now), state.metrics.total);
        state.renderProgressMeters = display;
        state.navSnappedLocation = G.pointAtRouteDistance(state.route, display, state.metrics);
        return display;
      }

      if (Number.isFinite(state.navTurnKnnCatchupTargetMeters)) {
        advanceTurnKnnCatchupRender(now);
        return state.renderProgressMeters;
      }

      const holdCapM = turnHoldProgressCapMeters();
      const activeHold = state.navTurnHoldCpIdx >= 0
        || (state.navStartHeadingHold && !state.navStartHeadingHoldReleased);
      if (activeHold) {
        const holdCap = holdCapM != null ? holdCapM : capProgressForHolds(Infinity, now);
        const displayNow = currentRenderProgress(now);
        const frameDt = T.NAV_DOT_INTERVAL_MS / 1000;
        if (displayNow > holdCap + 0.05) {
          state.renderProgressMeters = holdCap;
        } else if (displayNow < holdCap - 0.05) {
          const creep = Math.min(displayNow + T.NAV_HOLD_APPROACH_SPEED_MPS * frameDt, holdCap);
          scheduleRenderProgressAnim(now, creep, true);
        } else {
          state.renderProgressMeters = holdCap;
        }
        tickRenderProgressAnim(now);
        const display = Math.min(currentRenderProgress(now), holdCap);
        state.renderProgressMeters = display;
        state.navSnappedLocation = G.pointAtRouteDistance(state.route, display, state.metrics);
        return display;
      }

      const frameDt = T.NAV_DOT_INTERVAL_MS / 1000;
      const silentMs = state.lastMeasuredProgressMs > 0 ? now - state.lastMeasuredProgressMs : 0;
      if (isNavParked()) {
        const display = currentRenderProgress(now);
        state.renderProgressMeters = display;
        state.navSnappedLocation = G.pointAtRouteDistance(state.route, display, state.metrics);
        return display;
      }
      let predSpeed = 0;
      if (state.navImuDrEnabled && state.imuSpeedMps > 0.05) {
        predSpeed = Math.min(T.NAV_MAX_SPEED_MPS, state.imuSpeedMps * state.imuRenderScale);
        state.imuRawIntegralSinceMeasM += predSpeed * frameDt;
        if (!state.navRealForwardConfirmed) {
          state.navImuDrAccumMeters += predSpeed * frameDt;
          if (state.navImuDrAccumMeters >= (T.NAV_REQUIRE_FORWARD_M || 2.5)) {
            state.navRealForwardConfirmed = true;
          }
        }
      }
      const knnFallback = silentMs > 500 && state.navKnnSpeedMps > 0.3 ? state.navKnnSpeedMps : 0;
      const effectiveSpeed = predSpeed > 0.05 ? predSpeed : knnFallback;

      let desiredTarget = measured;
      if (effectiveSpeed > 0.05) {
        desiredTarget = Math.max(desiredTarget, currentRenderProgress(now) + effectiveSpeed * frameDt);
      }
      const maxLead = navImuMaxLeadMeters(now);
      desiredTarget = Math.min(desiredTarget, measured + maxLead, state.metrics.total);

      if (Math.abs(desiredTarget - currentRenderProgress(now)) > 0.02) {
        scheduleRenderProgressAnim(now, desiredTarget, false);
      }
      tickRenderProgressAnim(now);
      const display = Math.min(currentRenderProgress(now), state.metrics.total);
      state.renderProgressMeters = display;
      state.navSnappedLocation = G.pointAtRouteDistance(state.route, display, state.metrics);
      return display;
    }

    function updateHeading(targetHeading) {
      const prev = state.smoothNavHeadingDeg;
      if (prev == null) {
        state.smoothNavHeadingDeg = targetHeading;
        return;
      }
      const diff = G.headingDiffDeg(prev, targetHeading);
      state.smoothNavHeadingDeg = diff > 45
        ? targetHeading
        : G.lerpBearingDeg(prev, targetHeading, T.NAV_DOT_HEADING_ALPHA);
    }

    function maybeArrival(displayProgress, now) {
      if (state.navArrivalFrozen || !state.destination || state.metrics.total <= 0) return false;
      const here = G.pointAtRouteDistance(state.route, displayProgress, state.metrics);
      if (!here) return false;

      if (state.navArrivalFinishing) {
        const atEnd = displayProgress >= state.metrics.total - T.NAV_ARRIVAL_END_EPSILON_M;
        if (atEnd) state.navArrivalConfirmCount += 1;
        else state.navArrivalConfirmCount = 0;
        return state.navArrivalConfirmCount >= T.NAV_ARRIVAL_CONFIRM_TICKS;
      }

      const distMeters = G.distanceMeters(here, state.destination);
      const renderRatio = displayProgress / state.metrics.total;
      const measuredRatio = state.navRouteProgressMeters / state.metrics.total;
      const nearDest = distMeters <= T.NAV_ARRIVAL_METERS;
      const nearRouteEnd = renderRatio >= T.NAV_ARRIVAL_MIN_PROGRESS_RATIO
        || measuredRatio >= T.NAV_ARRIVAL_MIN_PROGRESS_RATIO;
      if (nearDest && nearRouteEnd) {
        state.navArrivalFinishing = true;
        state.navArrivalConfirmCount = 0;
        scheduleRenderProgressAnim(now, state.metrics.total, false);
      }
      return false;
    }

    function tick(now = Date.now()) {
      if (!state.navigating || state.navArrivalFrozen || state.route.length < 2) {
        return getDisplayState(now);
      }
      const displayProgress = advanceRenderProgress(now);
      const fused = computeFusedHeading(displayProgress, now, true);
      updateHeading(fused);
      const arrived = maybeArrival(displayProgress, now);
      return { ...getDisplayState(now), arrived };
    }

    function computeNextTurn(displayProgress) {
      const total = state.metrics.total;
      if (total <= 0) return { distanceMeters: 0, dir: 0, text: '前方直行' };
      const cur = Math.max(0, Math.min(displayProgress, total));
      const nextCp = state.checkpoints.find((cp) => cp.progressMeters > cur + 2);
      if (nextCp) {
        return {
          distanceMeters: Math.max(0, nextCp.progressMeters - cur),
          dir: nextCp.turnDeg > 0 ? 1 : -1,
          text: nextCp.turnDeg > 0 ? '前方右转' : '前方左转',
        };
      }
      const scan = CP.findNextTurnFromProgress(
        cur,
        total,
        (m) => G.routeSegmentBearingAtDistance(state.route, m, state.metrics),
        T.CHECKPOINT_MIN_TURN_DEG,
        T.NAV_TURN_LOOKAHEAD_M,
      );
      if (scan) {
        return {
          distanceMeters: scan.distanceMeters,
          dir: scan.dir,
          text: scan.dir > 0 ? '前方右转' : '前方左转',
        };
      }
      return { distanceMeters: Math.max(0, total - cur), dir: 0, text: '前方直行' };
    }

    function getDisplayState(now = Date.now()) {
      const displayProgress = state.navigating && state.renderProgressMeters >= 0
        ? currentRenderProgress(now)
        : state.navRouteProgressMeters;
      const loc = G.pointAtRouteDistance(state.route, displayProgress, state.metrics)
        || state.navSnappedLocation
        || (state.route[0] || null);
      const remainMeters = Math.max(0, state.metrics.total - displayProgress);
      const progressPct = state.metrics.total > 0
        ? Math.min(100, Math.round((displayProgress / state.metrics.total) * 100))
        : 0;
      const routeBr = loc && state.route.length >= 2
        ? G.routeForwardBearingAtProgress(state.route, displayProgress, state.metrics)
        : 0;
      let cameraBr = G.cameraBearingFromRouteDeg(routeBr, state.mapNorthBearingDeg);
      if (state.smoothNavCameraBearingDeg == null) {
        state.smoothNavCameraBearingDeg = cameraBr;
      } else {
        const brDelta = G.headingDiffDeg(state.smoothNavCameraBearingDeg, cameraBr);
        let alpha = T.NAV_CAMERA_BEARING_ALPHA;
        if (brDelta > 35) alpha *= 0.5;
        state.smoothNavCameraBearingDeg = G.lerpBearingDeg(
          state.smoothNavCameraBearingDeg,
          cameraBr,
          alpha,
        );
      }
      cameraBr = state.smoothNavCameraBearingDeg;
      const nextTurn = computeNextTurn(displayProgress);

      let velocityMps = Math.max(state.imuSpeedMps, state.navKnnSpeedMps);
      if (Number.isFinite(state.avpVelProgressM) && state.avpVelProgressMs > 0) {
        const dt = Math.max(0.2, (now - state.avpVelProgressMs) / 1000);
        const dv = Math.max(0, (displayProgress - state.avpVelProgressM) / dt);
        if (Number.isFinite(dv)) velocityMps = dv;
      }
      state.avpVelProgressM = displayProgress;
      state.avpVelProgressMs = now;

      const totalForEta = state.serverTotalLen > 0 ? state.serverTotalLen : state.metrics.total;
      const remainForEta = state.serverTotalLen > 0
        ? Math.max(0, totalForEta * (1 - displayProgress / Math.max(state.metrics.total, 1)))
        : remainMeters;
      const etaSec = state.serverEtaSec > 0 && state.metrics.total > 0
        ? Math.max(0, state.serverEtaSec * (remainForEta / totalForEta))
        : (remainMeters / T.WALK_SPEED_MPS);

      const elevation = G.elevationAtRouteDistance
        ? G.elevationAtRouteDistance(state.route, displayProgress, state.metrics)
        : 0;

      return {
        location: loc,
        heading: state.smoothNavHeadingDeg ?? routeBr,
        routeBearing: routeBr,
        cameraBearing: cameraBr,
        smoothCameraBearing: cameraBr,
        progressMeters: displayProgress,
        measuredProgressMeters: state.navRouteProgressMeters,
        remainMeters,
        remainMetersServer: remainForEta,
        progressPct,
        totalMeters: state.metrics.total,
        navArrivalFinishing: state.navArrivalFinishing,
        navArrivalFrozen: state.navArrivalFrozen,
        navParked: isNavParked(),
        nextTurn,
        velocityMps,
        etaSec,
        elevation,
      };
    }

    function shouldSendTerminalOnStop() {
      if (state.metrics.total <= 0) return false;
      const ratio = state.navRouteProgressMeters / state.metrics.total;
      return ratio >= 0.95;
    }

    function startNavigation(initialHeading) {
      state.navigating = true;
      state.navArrivalFrozen = false;
      state.navStartProgressMeters = 0;
      state.navStartHeadingHoldImuMeters = 0;
      state.navRealForwardConfirmed = false;
      state.navLocSuccessCount = 0;
      state.navParkingEntryReanchorDone = false;
      state.rotationOnly = false;
      state.navImuDrAccumMeters = 0;
      state.navStartHeadingFusionStableSinceMs = 0;
      state.imuLaunchConfirmed = false;
      state.avpVelProgressM = NaN;
      state.avpVelProgressMs = 0;
      seedAtRouteStart(initialHeading);
    }

    function stopNavigation() {
      state.navigating = false;
      state.navArrivalFinishing = false;
    }

    function freezeAfterArrival() {
      state.navArrivalFrozen = true;
      state.navigating = false;
    }

    return {
      setRoute,
      setServerMetrics,
      attachSpeedBumpTracker,
      resetNavProgress,
      seedAtRouteStart,
      startNavigation,
      stopNavigation,
      freezeAfterArrival,
      onKnnMeasurement,
      tick,
      getDisplayState,
      shouldSendTerminalOnStop,
      snapToRoute: (raw, adv, now, h) => snapToRoute(raw, adv, now || Date.now(), h),
      getState: () => state,
    };
  }

  window.NavEngine = { create: createNavEngine };
}());
