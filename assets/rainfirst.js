(() => {
  'use strict';

  const CONFIG = {
    defaultPlace: { name: 'Hà Nội', latitude: 21.0285, longitude: 105.8542, country: 'Việt Nam' },
    adminUrls: ['/sapnhap/data/admin.json', 'https://vietflexmap.github.io/sapnhap/data/admin.json'],
    weatherRefreshMs: 5 * 60 * 1000,
    radarRefreshMs: 5 * 60 * 1000,
    radarFrameMs: 750,
    radarColor: 2,
    radarSmooth: 1,
    radarSnow: 1,
    radarMaxNativeZoom: 7,
    mapZoom: 8,
    fetchTimeoutMs: 15000,
    cacheMaxAgeMs: 2 * 60 * 60 * 1000,
    storageKey: 'muagio:rainfirst:v3',
    weatherCacheKey: 'muagio:weather-cache:v3'
  };

  const RANGE_META = {
    '30m': { label: '30 PHÚT TỚI', kind: 'minute', minutes: 30 },
    '60m': { label: '60 PHÚT TỚI', kind: 'minute', minutes: 60 },
    '3h': { label: '3 GIỜ TỚI', kind: 'minute', minutes: 180 },
    '6h': { label: '6 GIỜ TỚI', kind: 'minute', minutes: 360 },
    '12h': { label: '12 GIỜ TỚI', kind: 'hour', hours: 12 },
    '24h': { label: '24 GIỜ TỚI', kind: 'hour', hours: 24 },
    '1d': { label: 'HÔM NAY', kind: 'day', days: 1 },
    '2d': { label: '2 NGÀY', kind: 'day', days: 2 },
    '3d': { label: '3 NGÀY', kind: 'day', days: 3 },
    '4d': { label: '4 NGÀY', kind: 'day', days: 4 },
    '5d': { label: '5 NGÀY', kind: 'day', days: 5 },
    '6d': { label: '6 NGÀY', kind: 'day', days: 6 },
    '7d': { label: '1 TUẦN', kind: 'day', days: 7 }
  };

  const state = {
    map: null,
    baseLayers: {},
    activeBaseName: 'osm',
    activeBase: null,
    marker: null,
    markerVisible: true,
    currentPlace: { ...CONFIG.defaultPlace },
    currentUnit: null,
    adminData: null,
    units: [],
    provinces: [],
    weather: null,
    selectedRange: '30m',
    lastWeatherAt: 0,
    weatherBusy: false,
    radarBusy: false,
    radar: { enabled: true, manifest: null, frames: [], index: 0, layer: null, opacity: 0.62, timer: null, playing: false, lastManifestAt: 0 },
    searchController: null,
    toastTimer: null,
    weatherTimer: null,
    radarTimer: null,
    heartbeatTimer: null,
    online: navigator.onLine
  };

  const $ = id => document.getElementById(id);
  const els = {};
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheElements();
    restorePreferences();
    bindUI();
    if (!window.Vietflex) {
      showToast('Không tải được Vietflex Map SDK. Hãy kiểm tra kết nối mạng.', 8000);
      return;
    }
    initMap();
    updateConnectivityUI();
    await loadAdminData();

    const unitCode = new URLSearchParams(location.search).get('unit') || state.currentUnit?.code || '';
    const urlUnit = unitCode ? state.units.find(u => String(u.code) === String(unitCode)) : null;
    if (urlUnit) {
      await selectAdminUnit(urlUnit, { zoom: 11, source: 'startup', skipUrl: true });
    } else {
      const startup = placeFromUrl() || state.currentPlace || CONFIG.defaultPlace;
      await selectPlace(startup, { zoom: CONFIG.mapZoom, source: 'startup', skipUrl: true });
    }

    refreshRadarManifest();
    scheduleTimers();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeunload', savePreferences);
  }

  function cacheElements() {
    [
      'searchForm','searchInput','searchResults','clearSearch','locateBtn','layersBtn','layerPanel','weatherPanelBtn','weatherPanel','refreshBtn',
      'placeName','placeMeta','weatherIcon','currentTemp','weatherText','updatedAt','humidity','rain','wind','gust','currentRainClass',
      'provinceSelect','unitSelect','adminBadge','communeName','communeMeta','adminStatus','networkStatus','modelStatus','radarSourceStatus',
      'forecastRange','rangeMethod','rangeLabel','rangeHeadline','riskBadge','rangeRain','rangePeak','rangeProbability','rangeGust','rangeExplanation','riskList','rainAlert',
      'hourlyForecast','dailyForecast','radarToggle','markerToggle','radarOpacity','radarOpacityValue','radarBar','radarStatus','radarTime','radarSlider','radarPlayBtn','toast','loading','dataNoteText'
    ].forEach(id => els[id] = $(id));
  }

  function bindUI() {
    els.searchForm.addEventListener('submit', e => { e.preventDefault(); searchPlaces(els.searchInput.value.trim(), true); });
    els.searchInput.addEventListener('input', debounce(() => {
      const q = els.searchInput.value.trim();
      if (q.length >= 2) searchPlaces(q, false); else hideSearchResults();
    }, 220));
    els.clearSearch.addEventListener('click', () => { els.searchInput.value = ''; els.searchInput.focus(); hideSearchResults(); });
    els.locateBtn.addEventListener('click', locateUser);
    els.layersBtn.addEventListener('click', () => togglePanel(els.layerPanel, els.layersBtn));
    els.weatherPanelBtn.addEventListener('click', () => els.weatherPanel.classList.toggle('open'));
    els.refreshBtn.addEventListener('click', async () => { await refreshWeather(true); refreshRadarManifest(true); });

    els.provinceSelect.addEventListener('change', () => {
      const value = els.provinceSelect.value;
      fillUnitSelect(value);
      const province = state.provinces.find(p => String(p.code || p.id) === value);
      if (province && Number.isFinite(Number(province.centroid_lat)) && Number.isFinite(Number(province.centroid_lon))) {
        state.currentUnit = null;
        selectPlace({
          name: province.full_name || province.name,
          admin1: province.full_name || province.name,
          latitude: Number(province.centroid_lat), longitude: Number(province.centroid_lon), country: 'Việt Nam'
        }, { zoom: 8, source: 'province' });
        syncAdminUI(null, province);
      }
    });

    els.unitSelect.addEventListener('change', () => {
      const unit = state.units.find(u => String(u.code) === els.unitSelect.value);
      if (unit) selectAdminUnit(unit, { zoom: 11, source: 'selector' });
    });

    document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => {
      const panel = $(btn.dataset.close); if (panel) panel.hidden = true; els.layersBtn.classList.remove('active');
    }));
    document.querySelectorAll('[data-base]').forEach(btn => btn.addEventListener('click', () => setBasemap(btn.dataset.base)));
    document.querySelectorAll('.quick-places button').forEach(btn => btn.addEventListener('click', () => {
      state.currentUnit = null;
      selectPlace({ name: btn.dataset.place, latitude: Number(btn.dataset.lat), longitude: Number(btn.dataset.lon), country: 'Việt Nam' }, { zoom: 9, source: 'quick' });
      syncAdminUI(null, null);
    }));
    els.forecastRange.querySelectorAll('[data-range]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === state.selectedRange);
      btn.addEventListener('click', () => {
        state.selectedRange = btn.dataset.range;
        els.forecastRange.querySelectorAll('[data-range]').forEach(x => x.classList.toggle('active', x === btn));
        renderSelectedRange();
        savePreferences();
      });
    });

    els.radarToggle.checked = state.radar.enabled;
    els.markerToggle.checked = state.markerVisible;
    els.radarOpacity.value = String(Math.round(state.radar.opacity * 100));
    els.radarOpacityValue.textContent = `${els.radarOpacity.value}%`;

    els.radarToggle.addEventListener('change', () => {
      state.radar.enabled = els.radarToggle.checked;
      if (state.radar.enabled) setRadarFrame(state.radar.index); else { stopRadarAnimation(); removeRadarLayer(); }
      els.radarBar.style.opacity = state.radar.enabled ? '1' : '.55';
      savePreferences();
    });
    els.markerToggle.addEventListener('change', () => { state.markerVisible = els.markerToggle.checked; syncMarkerVisibility(); savePreferences(); });
    els.radarOpacity.addEventListener('input', () => {
      state.radar.opacity = Number(els.radarOpacity.value) / 100;
      els.radarOpacityValue.textContent = `${els.radarOpacity.value}%`;
      if (state.radar.layer?.setOpacity) state.radar.layer.setOpacity(state.radar.opacity);
      savePreferences();
    });
    els.radarSlider.addEventListener('input', () => { stopRadarAnimation(); setRadarFrame(Number(els.radarSlider.value)); });
    els.radarPlayBtn.addEventListener('click', () => state.radar.playing ? stopRadarAnimation() : startRadarAnimation());

    document.addEventListener('click', e => {
      if (!e.target.closest('.search-wrap')) hideSearchResults();
      if (!e.target.closest('#layerPanel') && !e.target.closest('#layersBtn') && !els.layerPanel.hidden) {
        els.layerPanel.hidden = true; els.layersBtn.classList.remove('active');
      }
    });
  }

  function initMap() {
    const V = window.Vietflex;
    state.map = V.vietflexMap('map', {
      center: [state.currentPlace.latitude, state.currentPlace.longitude],
      zoom: CONFIG.mapZoom,
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
      googleMaps: false
    });
    state.baseLayers.osm = makeTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, subdomains: 'abc' });
    state.baseLayers.satellite = makeTileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    state.baseLayers.terrain = makeTileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, subdomains: 'abc' });
    setBasemap(state.activeBaseName || 'osm');
    state.map.on('click', e => {
      state.currentUnit = null;
      const lat = e.latlng.lat, lon = e.latlng.lng;
      selectPlace({ name: `Điểm ${lat.toFixed(4)}, ${lon.toFixed(4)}`, latitude: lat, longitude: lon, country: 'Việt Nam' }, { zoom: Math.max(state.map.getZoom(), 9), source: 'map' });
      syncAdminUI(null, null);
      if (window.innerWidth <= 760) els.weatherPanel.classList.add('open');
    });
  }

  function makeTileLayer(url, options) {
    const V = window.Vietflex;
    if (typeof V.tileLayer === 'function') return V.tileLayer(url, options);
    return new V.TileLayer(url, options);
  }
  function makeMarker(latlng, options) {
    const V = window.Vietflex;
    if (typeof V.marker === 'function') return V.marker(latlng, options);
    return new V.Marker(latlng, options);
  }
  function makeDivIcon(options) {
    const V = window.Vietflex;
    if (typeof V.divIcon === 'function') return V.divIcon(options);
    return new V.DivIcon(options);
  }

  function setBasemap(name) {
    const next = state.baseLayers[name]; if (!next || !state.map) return;
    if (state.activeBase && state.map.hasLayer(state.activeBase)) state.map.removeLayer(state.activeBase);
    next.addTo(state.map); state.activeBase = next; state.activeBaseName = name;
    if (state.radar.layer?.bringToFront) state.radar.layer.bringToFront();
    syncMarkerVisibility();
    document.querySelectorAll('[data-base]').forEach(btn => btn.classList.toggle('active', btn.dataset.base === name));
    savePreferences();
  }

  async function loadAdminData() {
    setStatus(els.adminStatus, 'loading', 'ĐVHC đang tải');
    let lastErr;
    for (const url of CONFIG.adminUrls) {
      try {
        const payload = await fetchJSON(url, { cache: 'force-cache' }, 0);
        if (!Array.isArray(payload?.provinces) || !Array.isArray(payload?.units)) throw new Error('Sai schema provinces/units');
        state.adminData = payload;
        state.provinces = payload.provinces;
        state.units = payload.units;
        fillProvinceSelect();
        setStatus(els.adminStatus, 'ready', `${payload.provinces.length} tỉnh · ${payload.units.length} đơn vị`);
        return;
      } catch (err) { lastErr = err; console.warn('Admin source failed', url, err); }
    }
    setStatus(els.adminStatus, 'error', 'ĐVHC lỗi');
    showToast('Không tải được master data xã/phường từ sapnhap. Tra cứu tọa độ vẫn hoạt động.', 6500);
    console.error(lastErr);
  }

  function fillProvinceSelect() {
    const current = els.provinceSelect.value;
    const sorted = [...state.provinces].sort((a, b) => Number(a.order || 999) - Number(b.order || 999));
    els.provinceSelect.innerHTML = '<option value="">Chọn tỉnh/thành</option>' + sorted.map(p => `<option value="${escapeHtml(String(p.code || p.id))}">${escapeHtml(p.full_name || p.name)}</option>`).join('');
    if (current) els.provinceSelect.value = current;
  }

  function fillUnitSelect(provinceValue) {
    const province = state.provinces.find(p => String(p.code || p.id) === String(provinceValue));
    if (!province) {
      els.unitSelect.innerHTML = '<option value="">Chọn đơn vị</option>';
      els.unitSelect.disabled = true;
      return;
    }
    const pName = normalize(province.name || province.full_name || '');
    const units = state.units.filter(u => {
      const byOrder = province.order != null && u.province_order != null && Number(u.province_order) === Number(province.order);
      const byName = normalize(u.province_name || u.province_full_name || '') === pName || normalize(u.province_full_name || '').includes(pName);
      return byOrder || byName;
    }).sort((a, b) => String(a.full_name || a.name).localeCompare(String(b.full_name || b.name), 'vi'));
    els.unitSelect.innerHTML = '<option value="">Chọn xã/phường/đặc khu</option>' + units.map(u => `<option value="${escapeHtml(String(u.code))}">${escapeHtml(u.full_name || `${u.type || ''} ${u.name || ''}`)}</option>`).join('');
    els.unitSelect.disabled = false;
  }

  async function selectAdminUnit(unit, options = {}) {
    if (!unit) return;
    const lat = Number(unit.centroid_lat), lon = Number(unit.centroid_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showToast('Đơn vị này chưa có tọa độ tâm trong bộ dữ liệu.', 5000);
      return;
    }
    state.currentUnit = unit;
    const province = state.provinces.find(p => Number(p.order) === Number(unit.province_order)) || null;
    syncAdminSelectors(unit, province);
    syncAdminUI(unit, province);
    await selectPlace({
      name: unit.full_name || unit.name,
      admin1: unit.province_full_name || unit.province_name || province?.full_name || province?.name || '',
      admin2: unit.type || '',
      latitude: lat, longitude: lon, country: 'Việt Nam'
    }, { ...options, zoom: options.zoom || 11 });
  }

  function syncAdminSelectors(unit, province) {
    if (!unit) return;
    const p = province || state.provinces.find(x => Number(x.order) === Number(unit.province_order));
    if (p) {
      els.provinceSelect.value = String(p.code || p.id);
      fillUnitSelect(String(p.code || p.id));
    }
    els.unitSelect.value = String(unit.code);
  }

  function syncAdminUI(unit, province) {
    if (unit) {
      els.adminBadge.textContent = `${String(unit.type || '').toUpperCase()} · ${unit.code || '—'}`;
      els.communeName.textContent = unit.full_name || unit.name;
      const parts = [unit.province_full_name || unit.province_name, unit.code ? `Mã ĐVHC ${unit.code}` : '', Number.isFinite(Number(unit.area_km2)) ? `${fmtNumber(unit.area_km2, 2)} km²` : ''].filter(Boolean);
      els.communeMeta.textContent = parts.join(' · ');
    } else if (province) {
      els.adminBadge.textContent = 'TỈNH / THÀNH';
      els.communeName.textContent = province.full_name || province.name;
      els.communeMeta.textContent = `${province.commune_level_count || '—'} đơn vị cấp xã · Điểm dự báo đặt tại tâm đại diện của tỉnh/thành.`;
    } else {
      els.adminBadge.textContent = state.adminData ? 'ĐIỂM TỌA ĐỘ' : 'ĐVHC CHƯA SẴN SÀNG';
      els.communeName.textContent = 'Chưa chọn xã/phường/đặc khu';
      els.communeMeta.textContent = 'Chọn từ danh mục ĐVHC để dự báo đúng theo tâm đại diện của đơn vị.';
    }
  }

  async function selectPlace(place, options = {}) {
    state.currentPlace = {
      name: place.name || 'Vị trí đã chọn', admin1: place.admin1 || '', admin2: place.admin2 || '', country: place.country || 'Việt Nam',
      latitude: Number(place.latitude), longitude: Number(place.longitude)
    };
    const { latitude: lat, longitude: lon } = state.currentPlace;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    updateLocationHeader(); updateMarker(); savePreferences();
    if (!options.skipUrl) updateShareUrl();
    if (options.zoom && state.map) state.map.setView([lat, lon], options.zoom, { animate: true });
    await refreshWeather(false);
  }

  function updateLocationHeader() {
    const p = state.currentPlace;
    els.placeName.textContent = p.name;
    const admin = [p.admin2, p.admin1].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
    els.placeMeta.textContent = `${admin ? admin + ' · ' : ''}${fmtCoord(p.latitude, 'N', 'S')} · ${fmtCoord(p.longitude, 'E', 'W')}`;
  }

  function updateMarker() {
    const p = state.currentPlace;
    if (state.marker && state.map.hasLayer(state.marker)) state.map.removeLayer(state.marker);
    const icon = makeDivIcon({ className: 'weather-marker-wrap', html: '<div class="weather-marker"><span>☔</span></div>', iconSize: [36, 36], iconAnchor: [13, 31], popupAnchor: [4, -29] });
    state.marker = makeMarker([p.latitude, p.longitude], { icon }).bindPopup(`<b>${escapeHtml(p.name)}</b><br>${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}<br><small>Dự báo tại tọa độ đại diện</small>`);
    syncMarkerVisibility();
  }

  function syncMarkerVisibility() {
    if (!state.marker || !state.map) return;
    if (state.markerVisible) { if (!state.map.hasLayer(state.marker)) state.marker.addTo(state.map); }
    else if (state.map.hasLayer(state.marker)) state.map.removeLayer(state.marker);
  }

  async function refreshWeather(userInitiated = false) {
    if (state.weatherBusy) return;
    const p = state.currentPlace;
    if (!state.online) { renderCachedWeather(); return; }
    state.weatherBusy = true;
    setStatus(els.modelStatus, 'loading', 'Mô hình đang tải');
    setLoading(userInitiated || !state.weather); els.refreshBtn.classList.add('spinning');
    try {
      const params = new URLSearchParams({
        latitude: String(p.latitude), longitude: String(p.longitude),
        current: ['temperature_2m','relative_humidity_2m','apparent_temperature','is_day','precipitation','rain','showers','weather_code','cloud_cover','pressure_msl','wind_speed_10m','wind_direction_10m','wind_gusts_10m'].join(','),
        minutely_15: ['precipitation','rain','showers','weather_code','wind_speed_10m','wind_gusts_10m','cape'].join(','),
        hourly: ['temperature_2m','precipitation_probability','precipitation','rain','showers','weather_code','wind_speed_10m','wind_direction_10m','wind_gusts_10m','cloud_cover','cape'].join(','),
        daily: ['weather_code','temperature_2m_max','temperature_2m_min','precipitation_sum','rain_sum','showers_sum','precipitation_probability_max','wind_speed_10m_max','wind_gusts_10m_max'].join(','),
        timezone: 'Asia/Ho_Chi_Minh', forecast_days: '7', forecast_minutely_15: '32', wind_speed_unit: 'kmh', precipitation_unit: 'mm'
      });
      const data = await fetchJSON(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
      state.weather = data; state.lastWeatherAt = Date.now();
      try { localStorage.setItem(CONFIG.weatherCacheKey, JSON.stringify({ place: state.currentPlace, savedAt: state.lastWeatherAt, data })); } catch {}
      renderWeather(data); updateConnectivityUI();
      setStatus(els.modelStatus, 'ready', 'Open‑Meteo LIVE');
      if (userInitiated) showToast('Đã cập nhật dự báo mưa và radar.');
    } catch (err) {
      console.error(err);
      setStatus(els.modelStatus, 'error', 'Mô hình lỗi');
      if (!renderCachedWeather()) showToast('Không thể tải dữ liệu dự báo. Vui lòng thử lại.', 5500);
      else showToast('API tạm lỗi — đang hiển thị dữ liệu gần nhất đã lưu.', 5000);
    } finally {
      state.weatherBusy = false; setLoading(false); els.refreshBtn.classList.remove('spinning');
    }
  }

  function renderCachedWeather() {
    try {
      const cached = JSON.parse(localStorage.getItem(CONFIG.weatherCacheKey) || 'null');
      if (!cached?.data || Date.now() - Number(cached.savedAt || 0) > CONFIG.cacheMaxAgeMs) return false;
      const same = cached.place && Math.abs(cached.place.latitude - state.currentPlace.latitude) < .02 && Math.abs(cached.place.longitude - state.currentPlace.longitude) < .02;
      if (!same) return false;
      state.weather = cached.data; state.lastWeatherAt = Number(cached.savedAt || 0); renderWeather(cached.data, true); updateConnectivityUI(); return true;
    } catch { return false; }
  }

  function renderWeather(data, cached = false) {
    const c = data.current || {}, meta = weatherCode(c.weather_code, c.is_day);
    const currentRain = Number(c.precipitation ?? 0);
    els.currentTemp.textContent = round(c.temperature_2m);
    els.weatherIcon.textContent = meta.icon;
    els.weatherText.textContent = cached ? `${meta.text} · dữ liệu lưu` : meta.text;
    els.updatedAt.textContent = formatTime(c.time);
    els.humidity.textContent = `${round(c.relative_humidity_2m)}%`;
    els.rain.textContent = `${fmtNumber(currentRain, 1)} mm`;
    els.currentRainClass.textContent = rainClass(currentRain);
    els.wind.textContent = `${round(c.wind_speed_10m)} km/h`;
    els.gust.textContent = `${round(c.wind_gusts_10m)} km/h`;
    renderHourly(data.hourly, c.time);
    renderDaily(data.daily);
    renderSelectedRange();
    renderShortHeadline();
    updateMarkerWeatherIcon(meta.icon);
  }

  function renderSelectedRange() {
    if (!state.weather) return;
    const meta = RANGE_META[state.selectedRange] || RANGE_META['30m'];
    const s = aggregateRange(state.weather, meta);
    const risk = classifyRisk(s, meta);
    els.rangeLabel.textContent = meta.label;
    els.rangeRain.textContent = `${fmtNumber(s.totalRain, 1)} mm`;
    els.rangePeak.textContent = `${fmtNumber(s.peakRain, 1)} mm`;
    els.rangeProbability.textContent = s.maxProbability == null ? '—' : `${round(s.maxProbability)}%`;
    els.rangeGust.textContent = `${round(s.maxGust)} km/h`;
    els.rangeHeadline.textContent = buildHeadline(s, risk, meta);
    els.riskBadge.className = `risk-badge ${risk.level}`;
    els.riskBadge.textContent = risk.label;
    els.rangeMethod.textContent = meta.kind === 'minute' ? '15 phút · nội suy' : meta.kind === 'hour' ? 'Theo giờ' : 'Theo ngày';
    els.rangeExplanation.textContent = meta.kind === 'minute'
      ? 'Mốc 30–60 phút và 3–6 giờ dùng chuỗi 15 phút của Open‑Meteo. Tại Việt Nam, dữ liệu 15 phút có thể được nội suy từ mô hình theo giờ; radar chỉ dùng để quan sát diễn biến gần nhất.'
      : meta.kind === 'hour'
        ? 'Khoảng thời gian tính lăn từ thời điểm hiện tại, tổng hợp lượng mưa và gió theo giờ.'
        : 'Khoảng ngày dùng tổng lượng mưa theo ngày của mô hình; “1 ngày” là ngày hiện tại theo giờ Việt Nam.';
    renderRiskList(s, risk, meta);
  }

  function aggregateRange(data, meta) {
    const h = data.hourly || {}, m = data.minutely_15 || {}, d = data.daily || {};
    const now = Date.now();
    let rains = [], gusts = [], probs = [], codes = [], capes = [];

    if (meta.kind === 'minute' && m.time?.length) {
      const limit = now + meta.minutes * 60000;
      m.time.forEach((t, i) => {
        const ts = new Date(t).getTime();
        if (ts >= now - 15 * 60000 && ts < limit) {
          rains.push(num(m.precipitation?.[i])); gusts.push(num(m.wind_gusts_10m?.[i])); codes.push(num(m.weather_code?.[i])); capes.push(num(m.cape?.[i]));
        }
      });
      const hours = Math.max(1, Math.ceil(meta.minutes / 60));
      getHourlyWindow(h, now, hours).forEach(i => probs.push(num(h.precipitation_probability?.[i])));
    } else if (meta.kind === 'hour') {
      getHourlyWindow(h, now, meta.hours).forEach(i => {
        rains.push(num(h.precipitation?.[i])); gusts.push(num(h.wind_gusts_10m?.[i])); probs.push(num(h.precipitation_probability?.[i])); codes.push(num(h.weather_code?.[i])); capes.push(num(h.cape?.[i]));
      });
    } else {
      const count = Math.min(meta.days || 1, d.time?.length || 0);
      for (let i = 0; i < count; i++) {
        rains.push(num(d.precipitation_sum?.[i])); gusts.push(num(d.wind_gusts_10m_max?.[i])); probs.push(num(d.precipitation_probability_max?.[i])); codes.push(num(d.weather_code?.[i]));
      }
    }

    const totalRain = sum(rains);
    const peakRain = max(rains);
    const maxGust = max(gusts);
    const maxProbability = probs.filter(Number.isFinite).length ? max(probs) : null;
    const maxCape = capes.filter(Number.isFinite).length ? max(capes) : 0;
    const thunder = codes.some(c => [95,96,99].includes(Number(c)));
    return { totalRain, peakRain, maxGust, maxProbability, maxCape, thunder, slots: rains.length };
  }

  function getHourlyWindow(h, now, hours) {
    const out = [];
    if (!h.time?.length) return out;
    let start = h.time.findIndex(t => new Date(t).getTime() >= now - 30 * 60000);
    if (start < 0) start = 0;
    for (let i = start; i < Math.min(h.time.length, start + hours); i++) out.push(i);
    return out;
  }

  function classifyRisk(s, meta) {
    const durationFactor = meta.kind === 'day' ? Math.max(1, meta.days || 1) : 1;
    let score = 0;
    if (s.totalRain >= 5 * durationFactor) score += 1;
    if (s.totalRain >= 20 * durationFactor) score += 1;
    if (s.totalRain >= 50 * durationFactor) score += 1;
    if (s.peakRain >= 10) score += 1;
    if ((s.maxProbability || 0) >= 80) score += 1;
    if (s.maxGust >= 50) score += 1;
    if (s.maxGust >= 70 || s.thunder) score += 2;
    if (s.maxCape >= 1500) score += 1;
    if (score >= 5) return { level: 'high', label: 'CẦN CHÚ Ý CAO' };
    if (score >= 2) return { level: 'watch', label: 'NÊN THEO DÕI' };
    return { level: 'low', label: 'RỦI RO THẤP' };
  }

  function buildHeadline(s, risk) {
    if (s.totalRain < .1 && (s.maxProbability || 0) < 40) return 'Khả năng mưa đáng kể hiện thấp.';
    if (risk.level === 'high') return `Mưa/gió có tín hiệu mạnh: khoảng ${fmtNumber(s.totalRain,1)} mm trong khoảng đã chọn.`;
    if (risk.level === 'watch') return `Có tín hiệu mưa cần theo dõi, tổng khoảng ${fmtNumber(s.totalRain,1)} mm.`;
    return `Có thể có mưa nhẹ, tổng khoảng ${fmtNumber(s.totalRain,1)} mm.`;
  }

  function renderRiskList(s, risk, meta) {
    const items = [];
    if (s.totalRain >= 20 || s.peakRain >= 8) items.push({ icon:'🌧️', kind:risk.level, title:'Mưa lớn cục bộ', text:'Có thể giảm tầm nhìn, đường trơn và tăng khả năng đọng/ngập tại vị trí trũng.' });
    if (s.totalRain >= 35) items.push({ icon:'💧', kind:risk.level, title:'Ngập cục bộ cần lưu ý', text:'Lượng mưa tích lũy cao hơn; nên kiểm tra các điểm thấp, hẻm, cống và tuyến thường ngập.' });
    if (s.thunder || s.maxCape >= 1500) items.push({ icon:'⚡', kind:'high', title:'Dông / sét có thể xuất hiện', text:'Tín hiệu đối lưu hoặc mã thời tiết dông xuất hiện trong khoảng dự báo; hạn chế ở nơi trống trải khi dông phát triển.' });
    if (s.maxGust >= 50) items.push({ icon:'💨', kind:s.maxGust >= 70 ? 'high' : 'warn', title:'Gió giật', text:`Gió giật mô hình có thể đạt khoảng ${round(s.maxGust)} km/h; chú ý cây, biển quảng cáo và vật nhẹ ngoài trời.` });
    if (meta.kind === 'day' && s.totalRain >= 70) items.push({ icon:'⛰️', kind:'warn', title:'Mưa kéo dài', text:'Ở khu vực đồi dốc hoặc nền đất đã bão hòa, cần theo dõi thêm cảnh báo sạt lở/lũ quét chính thức.' });
    if (!items.length) items.push({ icon:'✓', kind:'', title:'Chưa thấy tín hiệu rủi ro mưa nổi bật', text:'Tiếp tục theo dõi radar và cập nhật dự báo nếu kế hoạch ngoài trời nhạy cảm với mưa.' });
    els.riskList.innerHTML = items.map(x => `<article class="risk-item ${x.kind}"><span class="ico">${x.icon}</span><div><b>${escapeHtml(x.title)}</b><p>${escapeHtml(x.text)}</p></div></article>`).join('');
  }

  function renderShortHeadline() {
    const s = aggregateRange(state.weather, RANGE_META['60m']);
    const risk = classifyRisk(s, RANGE_META['60m']);
    let title = '60 phút tới';
    let body = `ước tính ${fmtNumber(s.totalRain,1)} mm`;
    if (s.maxProbability != null) body += ` · xác suất cao nhất ${round(s.maxProbability)}%`;
    if (s.maxGust) body += ` · giật ${round(s.maxGust)} km/h`;
    els.rainAlert.className = `rain-alert ${risk.level === 'high' ? 'high' : risk.level === 'watch' ? 'watch' : ''}`;
    els.rainAlert.innerHTML = `<strong>${title}: ${risk.label.toLowerCase()}</strong>${body}.`;
    els.rainAlert.hidden = false;
  }

  function renderHourly(h, currentTime) {
    if (!h?.time?.length) { els.hourlyForecast.innerHTML = ''; return; }
    const nowTs = new Date(currentTime || Date.now()).getTime();
    let start = h.time.findIndex(t => new Date(t).getTime() >= nowTs - 30 * 60 * 1000); if (start < 0) start = 0;
    const end = Math.min(h.time.length, start + 24); let html = '';
    for (let i = start; i < end; i++) {
      const m = weatherCode(h.weather_code?.[i], 1), isNow = i === start;
      html += `<article class="hour-card${isNow ? ' now' : ''}"><time>${isNow ? 'Bây giờ' : formatTime(h.time[i])}</time><div class="wi">${m.icon}</div><strong class="mm">${fmtNumber(h.precipitation?.[i],1)} mm</strong><span>☔ ${round(h.precipitation_probability?.[i])}%</span><em>Giật ${round(h.wind_gusts_10m?.[i])} km/h</em></article>`;
    }
    els.hourlyForecast.innerHTML = html;
  }

  function renderDaily(d) {
    if (!d?.time?.length) { els.dailyForecast.innerHTML = ''; return; }
    const rains = (d.precipitation_sum || []).map(num);
    const maxRain = Math.max(1, ...rains.filter(Number.isFinite));
    els.dailyForecast.innerHTML = d.time.map((date, i) => {
      const m = weatherCode(d.weather_code?.[i], 1), rain = num(d.precipitation_sum?.[i]), label = i === 0 ? 'Hôm nay' : formatWeekday(date);
      const width = Math.max(2, Math.min(100, (rain / maxRain) * 100));
      return `<article class="daily-row"><time>${label}</time><span class="wi" title="${m.text}">${m.icon}</span><span class="rain-bar" title="${fmtNumber(rain,1)} mm"><i style="width:${width}%"></i></span><b>${fmtNumber(rain,1)} mm</b><small>☔ ${round(d.precipitation_probability_max?.[i])}%</small></article>`;
    }).join('');
  }

  function searchPlaces(q, submit = false) {
    if (!q || q.length < 2) return;
    const nq = normalize(q);
    const local = [];
    for (const u of state.units) {
      const hay = normalize(`${u.full_name || ''} ${u.name || ''} ${u.province_full_name || ''} ${u.province_name || ''} ${u.code || ''}`);
      if (hay.includes(nq)) local.push({ kind:'unit', score: scoreMatch(hay, nq), item:u });
      if (local.length > 80) break;
    }
    for (const p of state.provinces) {
      const hay = normalize(`${p.full_name || ''} ${p.name || ''} ${p.code || ''}`);
      if (hay.includes(nq)) local.push({ kind:'province', score: scoreMatch(hay, nq) - .2, item:p });
    }
    local.sort((a,b) => a.score - b.score);
    renderSearchResults(local.slice(0, 12));
    if (submit && local.length === 1) activateSearchResult(local[0]);
  }

  function scoreMatch(hay, q) { return hay === q ? 0 : hay.startsWith(q) ? .5 : hay.includes(` ${q}`) ? 1 : 2; }

  function renderSearchResults(results) {
    els.searchResults.hidden = false;
    if (!results.length) {
      els.searchResults.innerHTML = '<div class="search-result"><span><b>Không có kết quả trong ĐVHC 2025</b><small>Thử tên xã/phường, tỉnh/thành hoặc mã ĐVHC.</small></span></div>';
      return;
    }
    els.searchResults.innerHTML = results.map((r, i) => {
      if (r.kind === 'unit') {
        const u = r.item;
        return `<button class="search-result" type="button" data-index="${i}"><span><b>${escapeHtml(u.full_name || u.name)}</b><small>${escapeHtml(u.province_full_name || u.province_name || '')} · Mã ${escapeHtml(String(u.code || '—'))}</small></span><span class="result-kind">${escapeHtml(String(u.type || 'ĐVHC').toUpperCase())}</span></button>`;
      }
      const p = r.item;
      return `<button class="search-result" type="button" data-index="${i}"><span><b>${escapeHtml(p.full_name || p.name)}</b><small>${p.commune_level_count || '—'} đơn vị cấp xã</small></span><span class="result-kind">TỈNH/THÀNH</span></button>`;
    }).join('');
    els.searchResults.querySelectorAll('[data-index]').forEach(btn => btn.addEventListener('click', () => activateSearchResult(results[Number(btn.dataset.index)])));
  }

  function activateSearchResult(result) {
    if (!result) return;
    hideSearchResults();
    if (result.kind === 'unit') {
      els.searchInput.value = result.item.full_name || result.item.name;
      selectAdminUnit(result.item, { zoom: 11, source: 'search' });
    } else {
      const p = result.item;
      els.searchInput.value = p.full_name || p.name;
      els.provinceSelect.value = String(p.code || p.id); fillUnitSelect(String(p.code || p.id));
      state.currentUnit = null; syncAdminUI(null, p);
      selectPlace({ name:p.full_name || p.name, admin1:p.full_name || p.name, latitude:Number(p.centroid_lat), longitude:Number(p.centroid_lon), country:'Việt Nam' }, { zoom:8, source:'search' });
    }
    if (window.innerWidth <= 760) els.weatherPanel.classList.add('open');
  }

  function hideSearchResults() { els.searchResults.hidden = true; }

  function locateUser() {
    if (!navigator.geolocation) return showToast('Trình duyệt không hỗ trợ định vị.');
    els.locateBtn.classList.add('active');
    navigator.geolocation.getCurrentPosition(pos => {
      els.locateBtn.classList.remove('active');
      state.currentUnit = null; syncAdminUI(null, null);
      selectPlace({ name: 'Vị trí của bạn', latitude: pos.coords.latitude, longitude: pos.coords.longitude, country: 'Việt Nam' }, { zoom: 11, source: 'gps' });
      if (window.innerWidth <= 760) els.weatherPanel.classList.add('open');
    }, err => {
      els.locateBtn.classList.remove('active'); showToast(err.code === 1 ? 'Bạn chưa cấp quyền truy cập vị trí.' : 'Không xác định được vị trí hiện tại.', 5000);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  async function refreshRadarManifest(userInitiated = false) {
    if (state.radarBusy || !state.online) return;
    state.radarBusy = true;
    setStatus(els.radarSourceStatus, 'loading', 'Radar đang tải');
    els.radarStatus.textContent = 'Đang đồng bộ radar…';
    try {
      const data = await fetchJSON('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' });
      const frames = data.radar?.past || [];
      if (!frames.length) throw new Error('No radar frames');
      const previousLatest = state.radar.frames.at(-1)?.time || 0;
      state.radar.manifest = data; state.radar.frames = frames; state.radar.lastManifestAt = Date.now();
      const oldMax = Number(els.radarSlider.max || 0), wasAtLatest = state.radar.index >= Math.max(0, oldMax - 1);
      els.radarSlider.max = String(frames.length - 1);
      state.radar.index = wasAtLatest || state.radar.index >= frames.length ? frames.length - 1 : state.radar.index;
      els.radarSlider.value = String(state.radar.index);
      const latest = frames.at(-1); const ageMin = latest ? Math.max(0, Math.round((Date.now() - latest.time * 1000) / 60000)) : 0;
      els.radarStatus.textContent = `${frames.length} khung · mới nhất ${ageMin} phút trước`;
      setStatus(els.radarSourceStatus, 'ready', `Radar · ${ageMin}p`);
      if (state.radar.enabled) setRadarFrame(state.radar.index);
      if (userInitiated && latest?.time > previousLatest) showToast('Radar đã có khung mới.');
    } catch (err) {
      console.error(err);
      setStatus(els.radarSourceStatus, 'error', 'Radar lỗi');
      els.radarStatus.textContent = state.radar.frames.length ? 'Mất kết nối · giữ radar gần nhất' : 'Radar tạm thời không khả dụng';
    } finally { state.radarBusy = false; }
  }

  function setRadarFrame(index) {
    if (!state.radar.enabled || !state.radar.manifest || !state.radar.frames.length || !state.map) return;
    index = Math.max(0, Math.min(index, state.radar.frames.length - 1)); state.radar.index = index; els.radarSlider.value = String(index);
    const frame = state.radar.frames[index], host = state.radar.manifest.host, path = frame.path;
    const url = `${host}${path}/256/{z}/{x}/{y}/${CONFIG.radarColor}/${CONFIG.radarSmooth}_${CONFIG.radarSnow}.png`;
    const oldLayer = state.radar.layer;
    const nextLayer = makeTileLayer(url, { opacity: state.radar.opacity, maxNativeZoom: CONFIG.radarMaxNativeZoom, maxZoom: 19, zIndex: 450, attribution: 'Weather radar &copy; RainViewer' });
    nextLayer.addTo(state.map); state.radar.layer = nextLayer;
    if (oldLayer && state.map.hasLayer(oldLayer)) window.setTimeout(() => { try { if (state.map.hasLayer(oldLayer)) state.map.removeLayer(oldLayer); } catch {} }, 180);
    els.radarTime.textContent = new Date(frame.time * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  function removeRadarLayer() { if (state.radar.layer && state.map?.hasLayer(state.radar.layer)) state.map.removeLayer(state.radar.layer); state.radar.layer = null; }
  function startRadarAnimation() {
    if (!state.radar.frames.length || !state.radar.enabled) return;
    stopRadarAnimation(); state.radar.playing = true; els.radarPlayBtn.textContent = 'Ⅱ'; els.radarPlayBtn.setAttribute('aria-label', 'Tạm dừng radar');
    if (state.radar.index >= state.radar.frames.length - 1) state.radar.index = 0;
    state.radar.timer = window.setInterval(() => { state.radar.index = (state.radar.index + 1) % state.radar.frames.length; setRadarFrame(state.radar.index); }, CONFIG.radarFrameMs);
  }
  function stopRadarAnimation() { state.radar.playing = false; if (state.radar.timer) window.clearInterval(state.radar.timer); state.radar.timer = null; els.radarPlayBtn.textContent = '▶'; els.radarPlayBtn.setAttribute('aria-label', 'Phát radar'); }

  function scheduleTimers() {
    clearInterval(state.weatherTimer); clearInterval(state.radarTimer); clearInterval(state.heartbeatTimer);
    state.weatherTimer = window.setInterval(() => { if (state.online && !document.hidden) refreshWeather(false); }, CONFIG.weatherRefreshMs);
    state.radarTimer = window.setInterval(() => { if (state.online && !document.hidden) refreshRadarManifest(); }, CONFIG.radarRefreshMs);
    state.heartbeatTimer = window.setInterval(updateConnectivityUI, 15000);
  }

  function handleVisibilityChange() {
    if (document.hidden) { stopRadarAnimation(); return; }
    updateConnectivityUI();
    if (Date.now() - state.lastWeatherAt > CONFIG.weatherRefreshMs) refreshWeather(false);
    if (Date.now() - state.radar.lastManifestAt > CONFIG.radarRefreshMs) refreshRadarManifest();
  }
  function handleOnline() { state.online = true; updateConnectivityUI(); showToast('Đã kết nối lại Internet. Đang đồng bộ dữ liệu…'); refreshWeather(false); refreshRadarManifest(); }
  function handleOffline() { state.online = false; stopRadarAnimation(); updateConnectivityUI(); showToast('Đang ngoại tuyến — giữ dữ liệu gần nhất trên màn hình.', 5000); }

  function updateConnectivityUI() {
    state.online = navigator.onLine;
    setStatus(els.networkStatus, state.online ? 'ready' : 'error', state.online ? 'Mạng LIVE' : 'Ngoại tuyến');
    if (els.dataNoteText) {
      const age = state.lastWeatherAt ? Math.max(0, Math.round((Date.now() - state.lastWeatherAt) / 60000)) : null;
      els.dataNoteText.innerHTML = `<b>${state.online ? 'LIVE · đang kết nối.' : 'OFFLINE · dữ liệu lưu.'}</b> ${age !== null ? `Dữ liệu mô hình tải cách đây ${age} phút. ` : ''}Mốc 15 phút tại Việt Nam có thể là dữ liệu nội suy từ mô hình theo giờ. Radar RainViewer chỉ hiển thị diễn biến đã quan sát trong khoảng 2 giờ gần nhất. Chỉ báo rủi ro trên trang là hỗ trợ, không thay thế cảnh báo thiên tai chính thức.`;
    }
  }

  function setStatus(el, kind, text) {
    if (!el) return;
    el.className = `source-chip ${kind}`;
    el.innerHTML = `<i></i>${escapeHtml(text)}`;
  }

  async function fetchJSON(url, options = {}, retries = 1) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return await res.json();
      } catch (err) { lastErr = err; if (attempt < retries) await sleep(500 * (attempt + 1)); }
      finally { clearTimeout(timer); }
    }
    throw lastErr;
  }

  function savePreferences() {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({
        place: state.currentPlace, unitCode: state.currentUnit?.code || null, base: state.activeBaseName,
        radarEnabled: state.radar.enabled, radarOpacity: state.radar.opacity, markerVisible: state.markerVisible, selectedRange: state.selectedRange
      }));
    } catch {}
  }
  function restorePreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.storageKey) || 'null');
      if (!saved) return;
      if (saved.place && Number.isFinite(Number(saved.place.latitude)) && Number.isFinite(Number(saved.place.longitude))) state.currentPlace = saved.place;
      if (saved.unitCode) state.currentUnit = { code: saved.unitCode };
      if (['osm','satellite','terrain'].includes(saved.base)) state.activeBaseName = saved.base;
      if (typeof saved.radarEnabled === 'boolean') state.radar.enabled = saved.radarEnabled;
      if (Number.isFinite(Number(saved.radarOpacity))) state.radar.opacity = Math.min(1, Math.max(.2, Number(saved.radarOpacity)));
      if (typeof saved.markerVisible === 'boolean') state.markerVisible = saved.markerVisible;
      if (RANGE_META[saved.selectedRange]) state.selectedRange = saved.selectedRange;
    } catch {}
  }

  function placeFromUrl() {
    const params = new URLSearchParams(location.search), lat = Number(params.get('lat')), lon = Number(params.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { name: params.get('name') || `Điểm ${lat.toFixed(4)}, ${lon.toFixed(4)}`, latitude: lat, longitude: lon, country: 'Việt Nam' };
  }
  function updateShareUrl() {
    try {
      const u = new URL(location.href), p = state.currentPlace;
      u.searchParams.set('lat', p.latitude.toFixed(5)); u.searchParams.set('lon', p.longitude.toFixed(5)); u.searchParams.set('name', p.name);
      if (state.currentUnit?.code) u.searchParams.set('unit', state.currentUnit.code); else u.searchParams.delete('unit');
      history.replaceState(null, '', u);
    } catch {}
  }

  function updateMarkerWeatherIcon(icon) {
    const el = state.marker?.getElement?.(), span = el?.querySelector('.weather-marker span'); if (span) span.textContent = icon;
  }
  function togglePanel(panel, trigger) { panel.hidden = !panel.hidden; trigger.classList.toggle('active', !panel.hidden); }
  function setLoading(on) { els.loading.hidden = !on; }
  function showToast(message, duration = 3200) { if (state.toastTimer) clearTimeout(state.toastTimer); els.toast.textContent = message; els.toast.hidden = false; state.toastTimer = setTimeout(() => { els.toast.hidden = true; }, duration); }

  function weatherCode(code, isDay = 1) {
    const c = Number(code), night = Number(isDay) === 0;
    if (c === 0) return { icon: night ? '🌙' : '☀️', text: 'Trời quang' };
    if (c === 1) return { icon: night ? '☁️' : '🌤️', text: 'Khá quang' };
    if (c === 2) return { icon: '⛅', text: 'Mây rải rác' };
    if (c === 3) return { icon: '☁️', text: 'Nhiều mây' };
    if ([45,48].includes(c)) return { icon: '🌫️', text: 'Sương mù' };
    if ([51,53,55,56,57].includes(c)) return { icon: '🌦️', text: 'Mưa phùn' };
    if ([61,63,65,66,67].includes(c)) return { icon: '🌧️', text: c >= 65 ? 'Mưa to' : 'Có mưa' };
    if ([71,73,75,77,85,86].includes(c)) return { icon: '🌨️', text: 'Mưa tuyết' };
    if ([80,81,82].includes(c)) return { icon: '🌧️', text: c === 82 ? 'Mưa rào mạnh' : 'Mưa rào' };
    if ([95,96,99].includes(c)) return { icon: '⛈️', text: c === 95 ? 'Dông' : 'Dông mạnh' };
    return { icon: '☁️', text: 'Thời tiết biến đổi' };
  }

  function rainClass(mm) {
    const v = num(mm); if (v < .1) return 'Không mưa'; if (v < 2.5) return 'Mưa nhẹ'; if (v < 7.5) return 'Mưa vừa'; return 'Mưa mạnh';
  }
  function normalize(text = '') { return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
  function formatTime(value) { if (!value) return '--:--'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }
  function formatWeekday(value) { const d = new Date(`${value}T12:00:00`), s = d.toLocaleDateString('vi-VN', { weekday: 'short' }); return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmtCoord(n, pos, neg) { return `${Math.abs(Number(n)).toFixed(4)}°${Number(n) >= 0 ? pos : neg}`; }
  function num(n) { const x = Number(n); return Number.isFinite(x) ? x : 0; }
  function sum(arr) { return arr.reduce((a,b) => a + (Number.isFinite(b) ? b : 0), 0); }
  function max(arr) { const v = arr.filter(Number.isFinite); return v.length ? Math.max(...v) : 0; }
  function round(n) { return Number.isFinite(Number(n)) ? Math.round(Number(n)) : '--'; }
  function fmtNumber(n, digits = 1) { return Number.isFinite(Number(n)) ? Number(n).toFixed(digits) : '--'; }
  function debounce(fn, wait) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }
})();
