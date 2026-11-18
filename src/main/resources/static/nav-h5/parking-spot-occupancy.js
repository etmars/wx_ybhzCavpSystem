/**
 * 车位占用着色。对齐 OsmAndroid ParkingSpotOccupancy。
 * 协议 status：1 空闲，2 占用，3 预约。空闲不进名单。
 */
(function attach(api) {
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ParkingSpotOccupancy = api;
}((function build() {
  const EMPTY = 0;
  const RESERVED = 3;

  function swatch(r, g, b, a) {
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    return { color: hex, opacity: a / 255 };
  }

  const LIGHT = {
    empty: swatch(46, 170, 110, 110),
    occupied: swatch(220, 70, 80, 145),
    reserved: swatch(220, 150, 40, 140),
    target: swatch(32, 127, 237, 175),
  };
  const DARK = {
    empty: swatch(20, 255, 190, 95),
    occupied: swatch(255, 70, 110, 150),
    reserved: swatch(255, 180, 40, 140),
    target: swatch(40, 240, 255, 175),
  };

  function paints(light) {
    return light ? LIGHT : DARK;
  }

  function fromTotalParkingStatus(protocolStatus) {
    if (protocolStatus === 1) return EMPTY;
    if (protocolStatus === 2) return 2;
    if (protocolStatus === 3) return RESERVED;
    return null;
  }

  function keysOf(name, spaceNumber) {
    const out = [];
    [name, spaceNumber].forEach((raw) => {
      const key = String(raw || '').trim();
      if (key && out.indexOf(key) < 0) out.push(key);
    });
    return out;
  }

  function targetKeys(targetSpaceId) {
    const raw = String(targetSpaceId || '').trim();
    if (!raw) return [];
    const out = [raw];
    const tail = raw.indexOf(':') >= 0 ? raw.slice(raw.indexOf(':') + 1) : '';
    if (tail && tail !== raw) out.push(tail);
    return out;
  }

  function listsFromRows(rows) {
    const occupied = [];
    const reserved = [];
    (rows || []).forEach((row) => {
      if (!row) return;
      const status = fromTotalParkingStatus(Number(row.status));
      if (status == null || status === EMPTY) return;
      const keys = keysOf(row.spaceId, row.spaceNumber);
      keys.forEach((key) => {
        if (status === RESERVED) {
          if (reserved.indexOf(key) < 0) reserved.push(key);
        } else if (occupied.indexOf(key) < 0) occupied.push(key);
      });
    });
    return { occupied, reserved };
  }

  function spotKeyExpr() {
    return ['coalesce', ['get', 'name'], ['get', 'space_number'], ['to-string', ['get', 'id']]];
  }

  function inList(ids) {
    return ['in', spotKeyExpr(), ['literal', ids]];
  }

  function colorExpr(themeName, occupied, reserved, targets) {
    const theme = paints(themeName === 'light');
    const args = ['case'];
    if (targets && targets.length) {
      args.push(inList(targets), theme.target.color);
    }
    if (reserved && reserved.length) {
      args.push(inList(reserved), theme.reserved.color);
    }
    if (occupied && occupied.length) {
      args.push(inList(occupied), theme.occupied.color);
    }
    args.push(['all', ['has', 'name'], ['!=', ['get', 'name'], '']], theme.empty.color);
    args.push(theme.empty.color);
    return args;
  }

  function opacityExpr(themeName, occupied, reserved, targets) {
    const theme = paints(themeName === 'light');
    const args = ['case'];
    if (targets && targets.length) {
      args.push(inList(targets), theme.target.opacity);
    }
    if (reserved && reserved.length) {
      args.push(inList(reserved), theme.reserved.opacity);
    }
    if (occupied && occupied.length) {
      args.push(inList(occupied), theme.occupied.opacity);
    }
    args.push(['all', ['has', 'name'], ['!=', ['get', 'name'], '']], theme.empty.opacity);
    args.push(0);
    return args;
  }

  return {
    EMPTY,
    RESERVED,
    LIGHT,
    DARK,
    paints,
    fromTotalParkingStatus,
    keysOf,
    targetKeys,
    listsFromRows,
    colorExpr,
    opacityExpr,
  };
}())));
