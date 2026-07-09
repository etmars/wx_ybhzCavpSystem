/** 浏览器调试：URL 加 debug=1 显示日志面板；seed_test_route=1 自动 POST 测试路线 */

const DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';

function ensurePanel() {
  if (!DEBUG) return null;
  let el = document.getElementById('navDebug');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'navDebug';
    el.style.cssText = [
      'position:fixed',
      'top:58px',
      'left:6px',
      'right:6px',
      'max-height:42vh',
      'overflow:auto',
      'z-index:9999',
      'background:rgba(0,0,0,0.88)',
      'color:#7CFC7C',
      'font:11px/1.45 monospace',
      'padding:8px',
      'border-radius:6px',
      'pointer-events:none',
      'white-space:pre-wrap',
      'word-break:break-all',
    ].join(';');
    document.body.appendChild(el);
  }
  return el;
}

function log(msg, data) {
  if (!DEBUG) return;
  const line = data !== undefined
    ? `${msg} ${typeof data === 'string' ? data : JSON.stringify(data)}`
    : String(msg);
  console.log('[nav-debug]', line);
  const el = ensurePanel();
  if (el) el.textContent = `${el.textContent ? `${el.textContent}\n` : ''}${line}`;
}

function logError(msg, err) {
  if (!DEBUG) {
    console.error(msg, err);
    return;
  }
  const detail = err && err.stack ? err.stack : String(err);
  log(`ERROR ${msg}`, detail);
  console.error('[nav-debug]', msg, err);
}

function reportRouteState(map, routePoints, extra) {
  if (!DEBUG) return;
  const layerIds = [
    'nav-route-source',
    'nav-route-remaining-source',
    'nav-route-casing',
    'nav-route-line',
    'nav-route-end-layer',
  ];
  const layers = {};
  layerIds.forEach((id) => {
    layers[id] = { source: !!(map && map.getSource(id)), layer: !!(map && map.getLayer(id)) };
  });
  const pts = routePoints || [];
  log('route state', {
    pointCount: pts.length,
    first: pts[0] || null,
    last: pts[pts.length - 1] || null,
    layers,
    ...(extra || {}),
  });
}

window.NavDebug = {
  enabled: DEBUG,
  log,
  logError,
  reportRouteState,
};
