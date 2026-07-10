/** 对齐 MainActivity tickAvpLocationReport / postAvpLocationAtProgress */
(function () {
  function createAvpLocationReporter(options = {}) {
    const vehicleId = options.vehicleId || 'I1000110';
    const apiBase = options.apiBase || '';
    let timer = null;
    let msgSeq = 0;
    let postInFlight = false;
    let lastSentProgressM = NaN;
    let enabled = true;
    let terminalSent = false;

    function postLocation(display, forceTerminal) {
      if (!enabled || !apiBase || !display || !display.location) return;
      if (postInFlight && !forceTerminal) return;
      const progressM = display.progressMeters || 0;
      if (!forceTerminal && Number.isFinite(lastSentProgressM) && Math.abs(progressM - lastSentProgressM) < 0.05) {
        return;
      }
      if (forceTerminal) {
        if (terminalSent) return;
        terminalSent = true;
      }
      lastSentProgressM = progressM;
      const seq = msgSeq;
      msgSeq = (msgSeq + 1) % 65536;
      postInFlight = true;
      const body = {
        vehicleId,
        msgSeq: seq,
        timestamp: Date.now(),
        velocity: forceTerminal ? 0 : (display.velocityMps || 0),
        heading: display.heading || 0,
        position: {
          longitude: display.location.longitude,
          latitude: display.location.latitude,
          elevation: display.elevation || 0,
        },
        ext: { length: 0, content: '' },
      };
      fetch(`${apiBase.replace(/\/$/, '')}/avp/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {}).finally(() => { postInFlight = false; });
    }

    function start(getDisplayState) {
      stop();
      terminalSent = false;
      timer = setInterval(() => {
        const display = getDisplayState();
        if (display) postLocation(display, display.navArrivalFinishing);
      }, 1000);
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function sendTerminal(display) {
      if (display) postLocation(display, true);
    }

    function maybeSendTerminalOnStop(getDisplayState, shouldSend) {
      if (!shouldSend) return;
      const display = getDisplayState();
      if (display) sendTerminal(display);
    }

    return {
      start,
      stop,
      sendTerminal,
      maybeSendTerminalOnStop,
      setEnabled: (v) => { enabled = v; },
    };
  }

  window.AvpLocationReporter = { create: createAvpLocationReporter };
}());
