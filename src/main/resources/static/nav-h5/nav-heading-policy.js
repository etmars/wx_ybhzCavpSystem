/** 对齐 NavHeadingPolicy.kt */
window.NavHeadingPolicy = {
  NavFlow: {
    PARKING_ENTRY: 'PARKING_ENTRY',
    PICKUP_EXIT: 'PICKUP_EXIT',
  },
  NavMotionPhase: {
    NO_KNN: 'NO_KNN',
    STATIONARY_IN_LOT: 'STATIONARY_IN_LOT',
    CONFIRMED_MOVE: 'CONFIRMED_MOVE',
    CRUISING: 'CRUISING',
  },

  resolvePhase(navLocSuccessCount, navRealForwardConfirmed, isNavParked) {
    if (navLocSuccessCount === 0) return this.NavMotionPhase.NO_KNN;
    if (isNavParked) return this.NavMotionPhase.STATIONARY_IN_LOT;
    if (navRealForwardConfirmed && navLocSuccessCount >= 2) return this.NavMotionPhase.CRUISING;
    if (navRealForwardConfirmed) return this.NavMotionPhase.CONFIRMED_MOVE;
    return this.NavMotionPhase.STATIONARY_IN_LOT;
  },

  allowKnnHeadingCalibrate(flow, navRealForwardConfirmed, bumpHeadingAnchored, rotationOnlyLocked) {
    if (bumpHeadingAnchored || rotationOnlyLocked) return false;
    if (flow === this.NavFlow.PARKING_ENTRY) return true;
    if (flow === this.NavFlow.PICKUP_EXIT) return navRealForwardConfirmed;
    return navRealForwardConfirmed;
  },

  allowFirstKnnPathAlign(flow, pendingFirstKnn) {
    return pendingFirstKnn && (flow === this.NavFlow.PARKING_ENTRY || flow === this.NavFlow.PICKUP_EXIT);
  },

  shouldSetPendingFirstKnnHeadingAlign(flow) {
    return flow === this.NavFlow.PARKING_ENTRY || flow === this.NavFlow.PICKUP_EXIT;
  },

  preferImuRelativeHeading(flow, phase) {
    return flow === this.NavFlow.PICKUP_EXIT && phase === this.NavMotionPhase.STATIONARY_IN_LOT;
  },

  useRouteHeadingForIcon(flow, phase) {
    return flow === this.NavFlow.PARKING_ENTRY && phase === this.NavMotionPhase.NO_KNN;
  },
};
