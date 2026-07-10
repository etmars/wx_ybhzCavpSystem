/** 对齐 MainActivity main_menu.xml + 地图浮层（朝向/正北针/传感器调试） */
(function () {
  const PREFS = 'cavp_nav_prefs';

  const MENU_ITEMS = [
    { id: 'beacon_filter', label: '信标类型', type: 'action' },
    { id: 'feat_mode', label: '特征模式切换', type: 'action' },
    { id: 'server', label: '服务器地址', type: 'action' },
    { id: 'vehicle_id', label: '车辆 ID', type: 'action' },
    { id: 'switch_map', label: '切换地图', type: 'action' },
    { id: 'saved', label: '已保存标定点', type: 'action' },
    { id: 'map_model_mgr', label: '模型权重管理', type: 'action' },
    { id: 'ble_record', label: '录制BLE数据(5分钟)', type: 'action' },
    { id: 'loc_engine', label: '定位引擎切换', type: 'action' },
    { id: 'correct_bearing', label: '修正方向', type: 'action' },
    { id: 'nav_auto_heading_correct', label: '自动修正朝向', type: 'toggle', key: 'navAutoHeadingCorrect', default: false },
    { id: 'download_weights', label: '下载模型权重', type: 'action' },
    { id: 'sync_model', label: '同步定位模型', type: 'action' },
    { id: 'nav_knn_speed', label: 'KNN邻近点推算速度', type: 'toggle', key: 'navSpeedUseKnn', default: true },
    { id: 'nav_imu_speed', label: 'IMU积分推算速度', type: 'toggle', key: 'navSpeedUseImu', default: true },
    { id: 'avp_location_upload', label: '上传服务器车辆定位', type: 'toggle', key: 'avpLocationUploadEnabled', default: true },
    { id: 'use_server_park_data', label: '使用服务器泊车数据', type: 'toggle', key: 'useServerParkData', default: false },
    { id: 'view_park_cache', label: '查看缓存数据', type: 'action' },
    { id: 'nav_sensor_debug', label: '传感器调试浮层', type: 'toggle', key: 'navSensorDebugOverlayEnabled', default: false },
  ];

  let ctx = null;
  let els = {};
  let menuOpen = false;
  let debugTimer = null;

  function buildNavDebugText(display) {
    const lines = ['── 导航 ──'];
    if (display) {
      lines.push(`flow:${ctx.navFlow || '--'}`);
      lines.push(`图北:${display.heading != null ? display.heading.toFixed(1) : '--'}`);
      lines.push(`route:${display.routeBearing != null ? display.routeBearing.toFixed(1) : '--'}`);
      lines.push(`cam:${display.cameraBearing != null ? display.cameraBearing.toFixed(1) : '--'}`);
      lines.push(`mapN:${ctx.mapNorthBearingDeg != null ? ctx.mapNorthBearingDeg.toFixed(1) : '--'}`);
      lines.push(`progress:${display.progressMeters != null ? display.progressMeters.toFixed(1) : '--'}m`);
    } else {
      lines.push('nav: --');
    }
    lines.push('(IMU 见左上角原生浮层)');
    return lines.join('\n');
  }

  function refreshNavDebugOverlay(display) {
    if (!els.sensorDebug) return;
    els.sensorDebug.textContent = buildNavDebugText(display);
  }

  function stopDebugTimer() {
    if (debugTimer) {
      clearInterval(debugTimer);
      debugTimer = null;
    }
  }

  let lastOverlayDisplay = null;

  function startDebugTimer() {
    stopDebugTimer();
    debugTimer = setInterval(() => {
      if (!getToggle('navSensorDebugOverlayEnabled', false)) return;
      refreshNavDebugOverlay(lastOverlayDisplay);
    }, 200);
  }

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS) || '{}');
    } catch (e) {
      return {};
    }
  }

  function savePrefs(prefs) {
    localStorage.setItem(PREFS, JSON.stringify(prefs));
  }

  function getToggle(key, defaultVal) {
    const prefs = loadPrefs();
    if (prefs[key] === undefined) return defaultVal;
    return !!prefs[key];
  }

  function setToggle(key, val) {
    const prefs = loadPrefs();
    prefs[key] = !!val;
    savePrefs(prefs);
  }

  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add('visible');
    clearTimeout(els.toast._timer);
    els.toast._timer = setTimeout(() => els.toast.classList.remove('visible'), 2200);
  }

  function postHost(type, payload) {
    if (ctx && typeof ctx.postToMiniProgram === 'function') {
      ctx.postToMiniProgram({ type: 'menuAction', action: type, ...(payload || {}) });
    }
  }

  function promptInput(title, value, onOk) {
    const v = window.prompt(title, value || '');
    if (v != null && v !== '') onOk(v);
  }

  function closeMenu() {
    menuOpen = false;
    if (els.menuPanel) els.menuPanel.classList.remove('open');
    if (els.menuBackdrop) els.menuBackdrop.classList.remove('open');
  }

  function openMenu() {
    renderMenuItems();
    menuOpen = true;
    if (els.menuPanel) els.menuPanel.classList.add('open');
    if (els.menuBackdrop) els.menuBackdrop.classList.add('open');
  }

  function renderMenuItems() {
    if (!els.menuList) return;
    els.menuList.innerHTML = '';
    MENU_ITEMS.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-menu-item';
      btn.dataset.id = item.id;
      let suffix = '';
      if (item.type === 'toggle') {
        const on = getToggle(item.key, item.default);
        suffix = on ? ' ✓' : '';
      }
      btn.textContent = `${item.label}${suffix}`;
      btn.addEventListener('click', () => handleMenuItem(item));
      els.menuList.appendChild(btn);
    });
  }

  function handleMenuItem(item) {
    closeMenu();
    switch (item.id) {
      case 'beacon_filter':
        postHost('beacon_filter');
        toast('已请求：信标类型（小程序处理）');
        break;
      case 'feat_mode':
        promptInput('特征模式（legacy / enhanced）', 'legacy', (v) => {
          setToggle('featMode', v);
          postHost('feat_mode', { value: v });
          toast(`特征模式: ${v}`);
        });
        break;
      case 'server':
        promptInput('服务器地址', ctx.apiBase || '', (v) => {
          postHost('server', { value: v });
          toast('服务器地址已提交');
        });
        break;
      case 'vehicle_id':
        promptInput('车辆 ID', ctx.vehicleId || '', (v) => {
          postHost('vehicle_id', { value: v });
          toast(`车辆 ID: ${v}`);
        });
        break;
      case 'switch_map':
        postHost('switch_map');
        toast('返回切换地图');
        break;
      case 'saved':
        postHost('saved');
        toast('已保存标定点（小程序处理）');
        break;
      case 'map_model_mgr':
        postHost('map_model_mgr');
        toast('模型权重管理（小程序处理）');
        break;
      case 'ble_record':
        postHost('ble_record');
        toast('BLE 录制（小程序处理）');
        break;
      case 'loc_engine':
        promptInput('定位引擎（knn / fusion）', 'knn', (v) => {
          postHost('loc_engine', { value: v });
          toast(`定位引擎: ${v}`);
        });
        break;
      case 'correct_bearing': {
        const br = ctx.map ? ctx.map.getBearing() : 0;
        const norm = ((br % 360) + 360) % 360;
        postHost('correct_bearing', { mapId: ctx.mapId, bearingDeg: norm });
        toast(`方向已修正为 ${norm.toFixed(0)}°`);
        break;
      }
      case 'nav_auto_heading_correct': {
        const on = !getToggle(item.key, item.default);
        setToggle(item.key, on);
        postHost('nav_auto_heading_correct', { enabled: on });
        toast(on ? '自动修正朝向: 开' : '自动修正朝向: 关');
        break;
      }
      case 'download_weights':
        postHost('download_weights', { mapId: ctx.mapId });
        toast('正在下载模型权重…');
        break;
      case 'sync_model':
        postHost('sync_model', { mapId: ctx.mapId });
        toast('正在同步定位模型…');
        break;
      case 'nav_knn_speed': {
        const on = !getToggle(item.key, item.default);
        setToggle(item.key, on);
        postHost('nav_knn_speed', { enabled: on });
        toast(on ? 'KNN 邻近点推算速度: 开' : 'KNN 邻近点推算速度: 关');
        break;
      }
      case 'nav_imu_speed': {
        const on = !getToggle(item.key, item.default);
        setToggle(item.key, on);
        postHost('nav_imu_speed', { enabled: on });
        toast(on ? 'IMU 积分推算速度: 开' : 'IMU 积分推算速度: 关');
        break;
      }
      case 'avp_location_upload': {
        const on = !getToggle(item.key, item.default);
        setToggle(item.key, on);
        postHost('avp_location_upload', { enabled: on });
        toast(on ? '上传服务器车辆定位: 开' : '上传服务器车辆定位: 关');
        break;
      }
      case 'use_server_park_data': {
        const on = !getToggle(item.key, item.default);
        setToggle(item.key, on);
        postHost('use_server_park_data', { enabled: on });
        toast(on ? '使用服务器泊车数据: 开' : '使用服务器泊车数据: 关');
        break;
      }
      case 'view_park_cache':
        postHost('view_park_cache');
        toast('查看缓存（小程序处理）');
        break;
      case 'nav_sensor_debug': {
        const on = !getToggle(item.key, item.default);
        setToggle(item.key, on);
        postHost('nav_sensor_debug', { enabled: on });
        if (ctx && typeof ctx.postToMiniProgram === 'function') {
          ctx.postToMiniProgram({ type: 'setSensorDebug', enabled: on });
        }
        applyDebugVisibility();
        toast(on ? '传感器调试(原生): 开' : '传感器调试(原生): 关');
        break;
      }
      default:
        break;
    }
    updateOverlays();
  }

  function applyDebugVisibility() {
    const debugOn = getToggle('navSensorDebugOverlayEnabled', false);
    const navActive = ctx && ctx.getNavigating && ctx.getNavigating();
    const show = debugOn && navActive;
    if (els.sensorDebug) els.sensorDebug.classList.toggle('visible', show);
    if (show) {
      startDebugTimer();
      refreshNavDebugOverlay(lastOverlayDisplay);
    } else {
      stopDebugTimer();
    }
  }

  function updateCompass(display) {
    const showPanel = ctx && ctx.getNavigating && ctx.getNavigating();
    if (els.compassWrap) {
      els.compassWrap.classList.toggle('visible', !!showPanel);
    }
    if (els.fabRecenter) {
      els.fabRecenter.style.display = showPanel ? 'none' : '';
    }
    if (!showPanel || !display) return;

    const heading = display.heading;
    if (els.userHeading && heading != null) {
      els.userHeading.textContent = `${heading.toFixed(0)}°`;
    } else if (els.userHeading) {
      els.userHeading.textContent = '--°';
    }

    if (els.compassIcon && ctx.map) {
      const mapN = ctx.mapNorthBearingDeg || 0;
      const camBr = ctx.map.getBearing() || 0;
      const rot = ((mapN - camBr) % 360 + 360) % 360;
      els.compassIcon.style.transform = `rotate(${rot}deg)`;
    }
  }

  function updateOverlays(display) {
    if (display) lastOverlayDisplay = display;
    applyDebugVisibility();
    const d = display || lastOverlayDisplay;
    if (d) updateCompass(d);
    refreshNavDebugOverlay(d);
  }

  function bindDom() {
    els.menuBtn = document.getElementById('btnMapMenu');
    els.menuPanel = document.getElementById('mapMenuPanel');
    els.menuBackdrop = document.getElementById('mapMenuBackdrop');
    els.menuList = document.getElementById('mapMenuList');
    els.sensorDebug = document.getElementById('navSensorDebugOverlay');
    els.compassWrap = document.getElementById('navCompassContainer');
    els.compassIcon = document.getElementById('navMapNorthCompass');
    els.userHeading = document.getElementById('navUserHeading');
    els.fabRecenter = document.getElementById('btnRecenter');
    els.toast = document.getElementById('mapMenuToast');

    if (els.menuBtn) {
      els.menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menuOpen) closeMenu();
        else openMenu();
      });
    }
    if (els.menuBackdrop) {
      els.menuBackdrop.addEventListener('click', closeMenu);
    }
  }

  function init(options) {
    ctx = options || {};
    if (ctx.sensorDebugDefault != null) {
      setToggle('navSensorDebugOverlayEnabled', !!ctx.sensorDebugDefault);
    }
    bindDom();
    applyDebugVisibility();
    updateOverlays();
  }

  function getPrefs() {
    return loadPrefs();
  }

  window.NavMenu = {
    init,
    updateOverlays,
    getPrefs,
    closeMenu,
    toast,
  };
}());
