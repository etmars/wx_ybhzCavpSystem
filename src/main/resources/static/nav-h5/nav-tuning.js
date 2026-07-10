/** 对齐 MainActivity companion object 导航常量 */
window.NavTuning = {
  NAV_ZOOM: 19.4,
  PREVIEW_ZOOM: 21,
  NAV_PITCH: 42,
  PREVIEW_PITCH: 20,
  NAV_CAMERA_EASE_MS: 600,
  NAV_PADDING_BOTTOM: 180,
  NAV_CAMERA_ROUTE_LOOKAHEAD_M: 8,
  NAV_CAMERA_BEARING_ALPHA: 0.12,
  NAV_CAMERA_MIN_MOVE_M: 1.5,
  NAV_CAMERA_MIN_BEARING_DELTA_DEG: 2,

  NAV_DOT_INTERVAL_MS: 33,
  NAV_DOT_HEADING_ALPHA: 0.18,
  NAV_RENDER_CATCHUP_SPEED_MPS: 1.5,
  NAV_RENDER_CATCHUP_SLOW_MPS: 0.85,
  NAV_RENDER_CATCHUP_SLOW_GAP_M: 3.5,
  NAV_RENDER_CATCHUP_MIN_MS: 900,
  NAV_RENDER_CATCHUP_MAX_MS: 3000,
  NAV_HOLD_APPROACH_SPEED_MPS: 1.0,

  NAV_MAX_SPEED_MPS: 8.5,
  NAV_MAX_ADVANCE_PER_TICK_METERS: 5.0,
  NAV_ROUTE_MAX_SNAP_DISTANCE_METERS: 30.0,
  NAV_SOFT_DISPLAY_MAX_ADVANCE_M: 5.0,
  PARKING_ENTRY_REANCHOR_MIN_DELTA_M: 30.0,
  NAV_ROUTE_GATE_MAX_DISTANCE_METERS: 30.0,
  NAV_ROUTE_BACKTRACK_TOLERANCE_METERS: 2.0,

  NAV_IMU_MAX_LEAD_BASE_M: 6.0,
  NAV_IMU_MAX_LEAD_CAP_M: 40.0,
  NAV_IMU_MAX_SILENT_SEC: 12.0,
  NAV_KNN_SPEED_ALPHA: 0.35,

  NAV_ARRIVAL_METERS: 8.0,
  NAV_ARRIVAL_MIN_PROGRESS_RATIO: 0.9,
  NAV_ARRIVAL_CONFIRM_TICKS: 3,
  NAV_ARRIVAL_END_EPSILON_M: 1.0,

  CHECKPOINT_MIN_TURN_DEG: 25,
  NAV_TURN_LOOKAHEAD_M: 10,
  CHECKPOINT_HEADING_TOLERANCE_DEG: 30,
  CHECKPOINT_HOLD_BEFORE_M: 2,
  CHECKPOINT_APPROACH_M: 5,
  CHECKPOINT_HOLD_ENTER_M: 8,
  CHECKPOINT_PASS_MAX_M: 15,
  CHECKPOINT_PUSH_AHEAD_M: 8,
  TURN_HOLD_TIMEOUT_MS: 8000,
  TURN_KNN_PAST_VERTEX_FRAME_COUNT: 3,
  TURN_KNN_PAST_VERTEX_EPS_M: 0.05,
  NAV_TURN_KNN_CATCHUP_MPS: 8.0,

  NAV_REQUIRE_FORWARD_M: 2.5,
  NAV_IMU_SCALE_MIN: 0.3,
  NAV_IMU_SCALE_MAX: 3.0,
  NAV_IMU_SCALE_ALPHA: 0.3,

  NAV_START_HEADING_HOLD_ENTER_DEG: 60,

  BUMP_GEO_GATE_M: 8.0,
  BUMP_MATCH_EXTRA_M: 12.0,
  NAV_PARKED_SPEED_THRESH: 0.35,

  PRED_GATE_MAX_SPEED_MPS: 3.0,
  PRED_GATE_SPEED_MARGIN: 1.35,
  PRED_GATE_MIN_STEP_M: 0.8,
  PRED_GATE_ABS_MAX_DIST_M: 15.0,
  PRED_GATE_LOW_QUALITY_ABS_MAX_DIST_M: 8.0,
  PRED_GATE_REACQUIRE_AFTER_MS: 5000,
  PRED_GATE_REACQUIRE_CLOSE_M: 5.0,
  PRED_GATE_REACQUIRE_MAX_GAP_MS: 3000,
  STABILIZE_MAX_JUMP_M: 45,
  STABILIZE_MAX_CENTER_DIST_M: 260,

  WALK_SPEED_MPS: 1.15,

  applyRemote(json) {
    if (!json || typeof json !== 'object') return false;
    const nav = json.nav || {};
    Object.keys(nav).forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(window.NavTuning, k) && typeof nav[k] === 'number') {
        window.NavTuning[k] = nav[k];
      }
    });
    const bump = json.bump || {};
    if (bump.k != null) window.NavTuning.BUMP_K = bump.k;
    if (bump.bandpass_low_hz != null) window.NavTuning.BUMP_BANDPASS_LOW_HZ = bump.bandpass_low_hz;
    if (bump.bandpass_high_hz != null) window.NavTuning.BUMP_BANDPASS_HIGH_HZ = bump.bandpass_high_hz;
    if (bump.dual_peak_min_gap_ms != null) window.NavTuning.BUMP_DUAL_MIN_GAP_MS = bump.dual_peak_min_gap_ms;
    if (bump.dual_peak_max_gap_ms != null) window.NavTuning.BUMP_DUAL_MAX_GAP_MS = bump.dual_peak_max_gap_ms;
    if (bump.geo_gate_m != null) window.NavTuning.BUMP_GEO_GATE_M = bump.geo_gate_m;
    if (bump.match_extra_m != null) window.NavTuning.BUMP_MATCH_EXTRA_M = bump.match_extra_m;
    const jm = json.junction_mag || {};
    if (jm.radius_m != null) window.NavTuning.JUNCTION_MAG_RADIUS_M = jm.radius_m;
    if (jm.mismatch_ut != null) window.NavTuning.JUNCTION_MAG_MISMATCH_UT = jm.mismatch_ut;
    if (jm.conf_scale != null) window.NavTuning.JUNCTION_MAG_CONF_SCALE = jm.conf_scale;
    const mm = json.motion_mag || {};
    if (mm.mag_stable_var != null) window.NavTuning.MAG_STABLE_VAR = mm.mag_stable_var;
    if (mm.vehicle_idle_var != null) window.NavTuning.VEHICLE_IDLE_VAR = mm.vehicle_idle_var;
    const bp = json.beacon_prior || {};
    window.NavTuning._beaconPrior = {
      enabled: bp.enabled != null ? bp.enabled : true,
      gateRadiusM: bp.gate_radius_m != null ? bp.gate_radius_m : 30,
      lambda: bp.lambda != null ? bp.lambda : 0.5,
      penaltyCap: bp.penalty_cap != null ? bp.penalty_cap : 3,
      minBeacons: bp.min_beacons != null ? bp.min_beacons : 4,
      fallbackEnabled: bp.fallback != null ? bp.fallback : true,
    };
    return true;
  },

  async fetchRemote(baseUrl, mapId) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/model/nav_tuning.json?map_id=${encodeURIComponent(mapId)}`;
      const res = await fetch(url);
      if (!res.ok) return false;
      const data = await res.json();
      return window.NavTuning.applyRemote(data);
    } catch (e) {
      console.warn('nav_tuning fetch failed', e);
      return false;
    }
  },
};
