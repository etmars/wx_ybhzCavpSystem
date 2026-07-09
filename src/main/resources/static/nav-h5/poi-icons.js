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
  ctx.roundRect(r, r, size - r * 2, size - r * 2, 9);
  ctx.fill();
  ctx.stroke();
  drawFn(ctx, size);
  return canvas;
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
    if (!map.hasImage(id)) {
      map.addImage(id, createPoiCanvas(icons[id]), { pixelRatio: 2 });
    }
  });
}

function registerNavArrowIcon(map) {
  const id = 'nav-arrow-icon';
  if (map.hasImage(id)) return;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3E86EC';
  ctx.beginPath();
  ctx.moveTo(16, 4);
  ctx.lineTo(28, 28);
  ctx.lineTo(16, 22);
  ctx.lineTo(4, 28);
  ctx.closePath();
  ctx.fill();
  map.addImage(id, canvas, { pixelRatio: 2 });
}

window.MapLayersUtil = {
  registerPoiIcons,
  registerNavArrowIcon,
};
