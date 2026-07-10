/** POI 图标注册，对齐 Android registerFlatPoiIcons */

function createPoiCanvas(drawFn) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(23,33,45,0.8)';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const r = 7;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(r, r, size - r * 2, size - r * 2, 9);
  } else {
    ctx.rect(r, r, size - r * 2, size - r * 2);
  }
  ctx.fill();
  ctx.stroke();
  drawFn(ctx, size);
  return canvas;
}

function addCanvasImage(map, id, canvas, replace = false) {
  if (replace && map.hasImage(id)) {
    try { map.removeImage(id); } catch (e) { /* ignore */ }
  } else if (map.hasImage(id)) {
    return;
  }
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, w, h);
  map.addImage(id, { width: w, height: h, data }, { pixelRatio: 1 });
}

/** 光束位图：统一 ImageData 注册（微信 web-view 下 canvas 直传常不可见） */
function addHeadingCanvasImage(map, id, canvas, replace = false) {
  if (replace && map.hasImage(id)) {
    try { map.removeImage(id); } catch (e) { /* ignore */ }
  } else if (map.hasImage(id)) {
    return;
  }
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, w, h);
  map.addImage(id, { width: w, height: h, data }, { pixelRatio: 1 });
}

function registerPoiIcons(map) {
  const icons = {
    'poi-1': (ctx) => {
      ctx.strokeRect(20, 17, 24, 31);
      ctx.beginPath(); ctx.moveTo(32, 18); ctx.lineTo(32, 48); ctx.stroke();
    },
    'poi-3': (ctx) => {
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(18, 20 + i * 8);
        ctx.lineTo(46, 20 + i * 8);
        ctx.stroke();
      }
    },
    'poi-4': (ctx) => {
      ctx.strokeRect(20, 17, 24, 31);
      ctx.beginPath(); ctx.moveTo(32, 18); ctx.lineTo(32, 48); ctx.stroke();
    },
    'poi-29': (ctx) => {
      ctx.beginPath(); ctx.arc(32, 28, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(24, 44); ctx.lineTo(40, 44); ctx.stroke();
    },
    'poi-30': (ctx) => {
      ctx.beginPath(); ctx.moveTo(32, 16); ctx.lineTo(44, 48); ctx.lineTo(20, 48); ctx.closePath(); ctx.stroke();
    },
    'poi-40': (ctx) => {
      ctx.beginPath(); ctx.arc(32, 32, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(32, 32, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    },
  };
  Object.keys(icons).forEach((id) => {
    try {
      addCanvasImage(map, id, createPoiCanvas(icons[id]));
    } catch (e) {
      console.warn('registerPoiIcons skip', id, e);
    }
  });
}

/** 对齐 Android createNavArrowBitmap — 白色 chevron + 淡蓝阴影 */
function registerNavArrowIcon(map) {
  const id = 'nav-arrow-icon';
  if (map.hasImage(id)) return;
  const w = 64;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const drawChevron = (color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(16, 40);
    ctx.lineTo(w / 2, 22);
    ctx.lineTo(48, 40);
    ctx.stroke();
  };
  drawChevron('rgba(61,127,219,0.33)', 8);
  drawChevron('#FFFFFF', 5.5);
  try {
    addCanvasImage(map, id, canvas);
  } catch (e) {
    console.warn('registerNavArrowIcon failed', e);
  }
}

/** 对齐 createLabelBitmap — 位图略小于 Android，缩放由 updateParkingLabelSizeByZoom 控制 */
function createLabelCanvas(text) {
  const label = String(text || '');
  const textSize = 18;
  const padX = 5;
  const baseline = 22;
  const h = 27;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `bold ${textSize}px sans-serif`;
  const w = Math.max(20, Math.ceil(measure.measureText(label).width) + 12);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${textSize}px sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#243043';
  ctx.fillStyle = '#EAF4FF';
  ctx.strokeText(label, padX, baseline);
  ctx.fillText(label, padX, baseline);
  return canvas;
}

function registerParkingLabelIcons(map, labelMap) {
  if (!map || !labelMap) return;
  Object.entries(labelMap).forEach(([iconId, text]) => {
    if (!iconId || !text) return;
    try {
      addCanvasImage(map, iconId, createLabelCanvas(text), true);
    } catch (e) {
      console.warn('registerParkingLabelIcons skip', iconId, e);
    }
  });
}

/** 对齐 createUserHeadingArrowBitmap — LinearGradient(#AA3E86EC → #003E86EC) + arcTo 扇形 */
function registerUserHeadingIcon(map) {
  const id = 'user-loc-heading';
  const size = 360;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 59; // 原 176 的 1/3
  const halfAngleDeg = 20;
  const startAngleDeg = -90 - halfAngleDeg;
  const sweepDeg = halfAngleDeg * 2;
  const leftRad = (startAngleDeg * Math.PI) / 180;
  // 从圆心向前发散，与蓝点中心对齐（icon-anchor: center）
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + radius * Math.cos(leftRad), cy + radius * Math.sin(leftRad));
  ctx.arc(
    cx,
    cy,
    radius,
    (startAngleDeg * Math.PI) / 180,
    ((startAngleDeg + sweepDeg) * Math.PI) / 180,
    false,
  );
  ctx.closePath();
  const grad = ctx.createLinearGradient(cx, cy, cx, cy - radius);
  grad.addColorStop(0, 'rgba(62, 134, 236, 0.667)');
  grad.addColorStop(1, 'rgba(62, 134, 236, 0)');
  ctx.fillStyle = grad;
  ctx.fill();
  try {
    addHeadingCanvasImage(map, id, canvas, true);
  } catch (e) {
    console.warn('registerUserHeadingIcon failed', e);
  }
}

/** 对齐 Android createDestMarkerBitmap — 终点 P 徽章 + 车位号 */
function registerDestPinIcon(map, label) {
  const safe = String(label || '').replace(/[^A-Za-z0-9_-]/g, '_');
  const iconId = safe ? `nav-dest-pin-${safe}` : 'nav-dest-pin';
  if (map.hasImage(iconId)) return iconId;
  const w = 132;
  const h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const blue = '#3E86EC';
  const stroke = (x, y, rw, rh, r) => {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, rw, rh, r);
    else ctx.rect(x, y, rw, rh);
    ctx.stroke();
  };
  ctx.fillStyle = blue;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(34, 6, 64, 64, 14);
  else ctx.rect(34, 6, 64, 64);
  ctx.fill();
  stroke(34, 6, 64, 64, 14);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', w / 2, 38);
  const plateLabel = String(label || '').replace(/\D/g, '').slice(-4)
    || String(label || '').slice(-4);
  if (plateLabel) {
    ctx.fillStyle = blue;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(28, 80, 76, 44, 10);
    else ctx.rect(28, 80, 76, 44);
    ctx.fill();
    ctx.font = `bold ${plateLabel.length <= 3 ? 28 : 23}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(plateLabel, w / 2, 102);
  }
  try {
    addCanvasImage(map, iconId, canvas);
  } catch (e) {
    console.warn('registerDestPinIcon failed', e);
  }
  return iconId;
}

window.MapLayersUtil = {
  registerPoiIcons,
  registerNavArrowIcon,
  registerUserHeadingIcon,
  registerDestPinIcon,
  registerParkingLabelIcons,
};
