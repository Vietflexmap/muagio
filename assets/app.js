(() => {
  'use strict';

  const CONFIG = {
    defaultPlace: { name: 'Hà Nội', latitude: 21.0285, longitude: 105.8542, country: 'Việt Nam' },
    weatherRefreshMs: 2 * 60 * 1000,
    radarRefreshMs: 5 * 60 * 1000,
    radarFrameMs: 700,
    radarColor: 2,
    radarSmooth: 1,
    radarSnow: 1,
    radarMaxNativeZoom: 7,
    mapZoom: 8,
    fetchTimeoutMs: 12000,
    cacheMaxAgeMs: 60 * 60 * 1000,
    storageKey: 'muagio:v2',
    weatherCacheKey: 'muagio:weather-cache:v2'
  };

  const state = {
    map: null,
    baseLayers: {},
    activeBaseName: 'osm',
    activeBase: null,
    marker: null,
    markerVisible: true,
    currentPlace: { ...CONFIG.defaultPlace },
    weather: null,
    lastWeatherAt: 0,
    weatherBusy: false,
    radarBusy: false,
    radar: { enabled: true, manifest: null, frames: [], index: 0, layer: null, opacity: 0.65, timer: null, playing: false, lastManifestAt: 0 },
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
    const startup = placeFromUrl() || state.currentPlace || CONFIG.defaultPlace;
    await selectPlace(startup, { zoom: CONFIG.mapZoom, source: 'startup', skipUrl: true });
    refreshRadarManifest();
    scheduleTimers();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeunload', savePreferences);
  }

  function cacheElements() {
    ['searchForm','searchInput','searchResults','clearSearch','locateBtn','layersBtn','layerPanel','weatherPanelBtn','weatherPanel','refreshBtn','placeName','placeMeta','weatherIcon','currentTemp','weatherText','feelsLike','updatedAt','humidity','rain','wind','windDir','pressure','cloud','gust','hourlyForecast','dailyForecast','radarToggle','markerToggle','radarOpacity','radarOpacityValue','radarBar','radarStatus','radarTime','radarSlider','radarPlayBtn','toast','loading'].forEach(id => els[id] = $(id));
    els.dataNote = document.querySelector('.data-note p');
    els.statusDot = document.querySelector('.data-note .status-dot');
  }

  function bindUI() {
    els.searchForm.addEventListener('submit', e => { e.preventDefault(); searchPlaces(els.searchInput.value.trim()); });
    els.searchInput.addEventListener('input', debounce(() => {
      const q = els.searchInput.value.trim();
      if (q.length >= 2) searchPlaces(q); else hideSearchResults();
    }, 350));
    els.clearSearch.addEventListener('click', () => { els.searchInput.value = ''; els.searchInput.focus(); hideSearchResults(); });
    els.locateBtn.addEventListener('click', locateUser);
    els.layersBtn.addEventListener('click', () => togglePanel(els.layerPanel, els.layersBtn));
    els.weatherPanelBtn.addEventListener('click', () => els.weatherPanel.classList.toggle('open'));
    els.refreshBtn.addEventListener('click', async () => { await refreshWeather(true); refreshRadarManifest(true); });

    document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => {
      const panel = $(btn.dataset.close); if (panel) panel.hidden = true; els.layersBtn.classList.remove('active');
    }));
    document.querySelectorAll('[data-base]').forEach(btn => btn.addEventListener('click', () => setBasemap(btn.dataset.base)));
    document.querySelectorAll('.quick-places button').forEach(btn => btn.addEventListener('click', () => {
      selectPlace({ name: btn.dataset.place, latitude: Number(btn.dataset.lat), longitude: Number(btn.dataset.lon), country: 'Việt Nam' }, { zoom: 9, source: 'quick' });
    }));

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
    state.baseLayers.osm = makeTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, subdomains: 'abc', attribution: '&copy; OpenStreetMap contributors'
    });
    state.baseLayers.satellite = makeTileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles &copy; Esri'
    });
    state.baseLayers.terrain = makeTileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, subdomains: 'abc', attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap'
    });
    setBasemap(state.activeBaseName || 'osm');
    state.map.on('click', e => {
      const lat = e.latlng.lat, lon = e.latlng.lng;
      selectPlace({ name: `Điểm ${lat.toFixed(4)}, ${lon.toFixed(4)}`, latitude: lat, longitude: lon, country: 'Việt Nam' }, { zoom: Math.max(state.map.getZoom(), 9), source: 'map' });
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
    const icon = makeDivIcon({ className: 'weather-marker-wrap', html: '<div class="weather-marker"><span>☁</span></div>', iconSize: [32, 32], iconAnchor: [12, 29], popupAnchor: [4, -27] });
    state.marker = makeMarker([p.latitude, p.longitude], { icon }).bindPopup(`<b>${escapeHtml(p.name)}</b><br>${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}<br><small>Nhấn bản đồ để tra cứu điểm khác</small>`);
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
    setLoading(userInitiated || !state.weather); els.refreshBtn.classList.add('spinning');
    try {
      const params = new URLSearchParams({
        latitude: String(p.latitude), longitude: String(p.longitude),
        current: ['temperature_2m','relative_humidity_2m','apparent_temperature','is_day','precipitation','rain','showers','weather_code','cloud_cover','pressure_msl','surface_pressure','wind_speed_10m','wind_direction_10m','wind_gusts_10m'].join(','),
        hourly: ['temperature_2m','precipitation_probability','precipitation','rain','weather_code','wind_speed_10m','wind_direction_10m','wind_gusts_10m','cloud_cover'].join(','),
        daily: ['weather_code','temperature_2m_max','temperature_2m_min','precipitation_sum','rain_sum','precipitation_probability_max','wind_speed_10m_max','wind_gusts_10m_max','sunrise','sunset'].join(','),
        timezone: 'auto', forecast_days: '7', wind_speed_unit: 'kmh', precipitation_unit: 'mm'
      });
      const data = await fetchJSON(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
      state.weather = data; state.lastWeatherAt = Date.now();
      try { localStorage.setItem(CONFIG.weatherCacheKey, JSON.stringify({ place: state.currentPlace, savedAt: state.lastWeatherAt, data })); } catch {}
      renderWeather(data); updateConnectivityUI();
      if (userInitiated) showToast('Đã cập nhật thời tiết và làm mới nguồn trực tuyến.');
    } catch (err) {
      console.error(err);
      if (!renderCachedWeather()) showToast('Không thể tải dữ liệu thời tiết. Vui lòng thử lại.', 5500);
      else showToast('Mạng/API tạm lỗi — đang hiển thị dữ liệu gần nhất đã lưu.', 5000);
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
    els.currentTemp.textContent = round(c.temperature_2m); els.weatherIcon.textContent = meta.icon; els.weatherText.textContent = cached ? `${meta.text} · dữ liệu lưu` : meta.text;
    els.feelsLike.textContent = `${round(c.apparent_temperature)}°`; els.updatedAt.textContent = formatTime(c.time);
    els.humidity.textContent = `${round(c.relative_humidity_2m)}%`; els.rain.textContent = `${fmtNumber((c.rain || 0) + (c.showers || 0), 1)} mm`;
    els.wind.textContent = `${round(c.wind_speed_10m)} km/h`; els.windDir.textContent = `${compass(c.wind_direction_10m)} ${round(c.wind_direction_10m)}°`;
    els.pressure.textContent = `${round(c.pressure_msl ?? c.surface_pressure)} hPa`; els.cloud.textContent = `${round(c.cloud_cover)}%`; els.gust.textContent = `${round(c.wind_gusts_10m)} km/h`;
    renderHourly(data.hourly, c.time); renderDaily(data.daily); updateMarkerWeatherIcon(meta.icon); renderRiskHint(c, data.hourly);
  }

  function renderRiskHint(c, hourly) {
    const rain = Number(c.rain || 0) + Number(c.showers || 0), gust = Number(c.wind_gusts_10m || 0), wind = Number(c.wind_speed_10m || 0);
    const nextProb = Number(hourly?.precipitation_probability?.[0] || 0);
    let hint = '';
    if (gust >= 75 || wind >= 55) hint = 'Gió rất mạnh tại điểm đang chọn; nên theo dõi cảnh báo chính thức.';
    else if (rain >= 10) hint = 'Mưa đang ở mức lớn tại điểm đang chọn; lưu ý ngập cục bộ.';
    else if (nextProb >= 80) hint = 'Khả năng mưa trong giờ gần nhất ở mức cao.';
    if (hint) showToast(`⚠ Chỉ báo tự động: ${hint}`, 6000);
  }

  function updateMarkerWeatherIcon(icon) {
    const el = state.marker?.getElement?.(), span = el?.querySelector('.weather-marker span'); if (span) span.textContent = icon;
  }

  function renderHourly(h, currentTime) {
    if (!h?.time?.length) { els.hourlyForecast.innerHTML = ''; return; }
    const nowTs = new Date(currentTime || Date.now()).getTime();
    let start = h.time.findIndex(t => new Date(t).getTime() >= nowTs - 30 * 60 * 1000); if (start < 0) start = 0;
    const end = Math.min(h.time.length, start + 24); let html = '';
    for (let i = start; i < end; i++) {
      const m = weatherCode(h.weather_code?.[i], 1), isNow = i === start;
      html += `<article class="hour-card${isNow ? ' now' : ''}"><time>${isNow ? 'Bây giờ' : formatTime(h.time[i])}</time><div class="wi">${m.icon}</div><strong>${round(h.temperature_2m?.[i])}°</strong><span>☔ ${round(h.precipitation_probability?.[i])}%</span><em>${round(h.wind_speed_10m?.[i])} km/h</em></article>`;
    }
    els.hourlyForecast.innerHTML = html;
  }

  function renderDaily(d) {
    if (!d?.time?.length) { els.dailyForecast.innerHTML = ''; return; }
    const lows = d.temperature_2m_min || [], highs = d.temperature_2m_max || [];
    const validLows = lows.map(Number).filter(Number.isFinite), validHighs = highs.map(Number).filter(Number.isFinite);
    const globalMin = validLows.length ? Math.min(...validLows) : 0, globalMax = validHighs.length ? Math.max(...validHighs) : 1, span = Math.max(1, globalMax - globalMin);
    els.dailyForecast.innerHTML = d.time.map((date, i) => {
      const m = weatherCode(d.weather_code?.[i], 1), lo = Number(lows[i]), hi = Number(highs[i]), width = Number.isFinite(lo) && Number.isFinite(hi) ? Math.max(15, ((hi - lo) / span) * 100) : 15, label = i === 0 ? 'Hôm nay' : formatWeekday(date);
      return `<article class="daily-row"><time>${label}</time><span class="wi" title="${m.text}">${m.icon}</span><span class="temp-range" title="${round(lo)}° – ${round(hi)}°"><i style="width:${width}%"></i></span><b>${round(lo)}° / ${round(hi)}°</b><small>☔ ${round(d.precipitation_probability_max?.[i])}%</small></article>`;
    }).join('');
  }

  async function searchPlaces(q) {
    if (!q || q.length < 2) return;
    if (!state.online) return showToast('Đang ngoại tuyến; chưa thể tìm địa danh mới.');
    if (state.searchController) state.searchController.abort();
    state.searchController = new AbortController(); els.searchResults.hidden = false;
    els.searchResults.innerHTML = '<div class="search-result"><span><b>Đang tìm…</b><small>Tra cứu địa danh</small></span></div>';
    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.searchParams.set('name', q); url.searchParams.set('count', '10'); url.searchParams.set('language', 'vi'); url.searchParams.set('format', 'json');
      const res = await fetch(url, { signal: state.searchController.signal }); if (!res.ok) throw new Error(`Geocoding ${res.status}`);
      const data = await res.json(); let results = data.results || [];
      const vn = results.filter(r => r.country_code === 'VN' || /Việt Nam|Vietnam/i.test(r.country || '')); if (vn.length) results = vn;
      renderSearchResults(results);
    } catch (err) {
      if (err.name === 'AbortError') return; console.error(err);
      els.searchResults.innerHTML = '<div class="search-result"><span><b>Không tìm được địa phương</b><small>Thử tên khác hoặc chọn trực tiếp trên bản đồ.</small></span></div>';
    }
  }

  function renderSearchResults(results) {
    if (!results.length) { els.searchResults.innerHTML = '<div class="search-result"><span><b>Không có kết quả</b><small>Bạn có thể click trực tiếp lên bản đồ.</small></span></div>'; return; }
    els.searchResults.innerHTML = results.map((r, i) => {
      const sub = [r.admin2, r.admin1, r.country].filter(Boolean).join(' · ');
      return `<button class="search-result" type="button" data-index="${i}"><span><b>${escapeHtml(r.name)}</b><small>${escapeHtml(sub)}</small></span><span class="coords">${Number(r.latitude).toFixed(3)}, ${Number(r.longitude).toFixed(3)}</span></button>`;
    }).join('');
    els.searchResults.querySelectorAll('[data-index]').forEach(btn => btn.addEventListener('click', () => {
      const r = results[Number(btn.dataset.index)]; hideSearchResults(); els.searchInput.value = r.name; selectPlace(r, { zoom: 10, source: 'search' }); if (window.innerWidth <= 760) els.weatherPanel.classList.add('open');
    }));
  }

  function hideSearchResults() { els.searchResults.hidden = true; }

  function locateUser() {
    if (!navigator.geolocation) return showToast('Trình duyệt không hỗ trợ định vị.');
    els.locateBtn.classList.add('active');
    navigator.geolocation.getCurrentPosition(pos => {
      els.locateBtn.classList.remove('active');
      selectPlace({ name: 'Vị trí của bạn', latitude: pos.coords.latitude, longitude: pos.coords.longitude, country: 'Việt Nam' }, { zoom: 11, source: 'gps' });
      if (window.innerWidth <= 760) els.weatherPanel.classList.add('open');
    }, err => {
      els.locateBtn.classList.remove('active'); showToast(err.code === 1 ? 'Bạn chưa cấp quyền truy cập vị trí.' : 'Không xác định được vị trí hiện tại.', 5000);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  async function refreshRadarManifest(userInitiated = false) {
    if (state.radarBusy || !state.online) return;
    state.radarBusy = true; els.radarStatus.textContent = 'Đang đồng bộ radar…';
    try {
      const data = await fetchJSON('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' });
      const frames = data.radar?.past || []; if (!frames.length) throw new Error('No radar frames');
      const previousLatest = state.radar.frames.at(-1)?.time || 0;
      state.radar.manifest = data; state.radar.frames = frames; state.radar.lastManifestAt = Date.now();
      const oldMax = Number(els.radarSlider.max || 0), wasAtLatest = state.radar.index >= Math.max(0, oldMax - 1);
      els.radarSlider.max = String(frames.length - 1);
      state.radar.index = wasAtLatest || state.radar.index >= frames.length ? frames.length - 1 : state.radar.index;
      els.radarSlider.value = String(state.radar.index);
      const latest = frames.at(-1); const ageMin = latest ? Math.max(0, Math.round((Date.now() - latest.time * 1000) / 60000)) : 0;
      els.radarStatus.textContent = `${frames.length} khung · mới nhất ${ageMin} phút trước`;
      if (state.radar.enabled) setRadarFrame(state.radar.index);
      if (userInitiated && latest?.time > previousLatest) showToast('Radar đã có khung mới.');
    } catch (err) {
      console.error(err);
      els.radarStatus.textContent = state.radar.frames.length ? 'Mất kết nối · giữ radar gần nhất' : 'Radar tạm thời không khả dụng';
      if (!state.radar.frames.length) showToast('Radar mưa tạm thời không tải được; dữ liệu thời tiết vẫn hoạt động.', 4500);
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
    if (els.statusDot) {
      els.statusDot.style.background = state.online ? '#45d9a1' : '#ffb14a';
      els.statusDot.style.boxShadow = state.online ? '0 0 10px #45d9a1' : '0 0 10px #ffb14a';
    }
    if (els.dataNote) {
      const age = state.lastWeatherAt ? Math.max(0, Math.round((Date.now() - state.lastWeatherAt) / 60000)) : null;
      const next = state.lastWeatherAt ? Math.max(0, Math.ceil((CONFIG.weatherRefreshMs - (Date.now() - state.lastWeatherAt)) / 60000)) : 0;
      els.dataNote.innerHTML = `<b>${state.online ? 'LIVE · đang kết nối' : 'OFFLINE · dữ liệu lưu'}.</b> Thời tiết mô hình cập nhật tự động 2 phút/lần ở phía ứng dụng${age !== null ? ` · dữ liệu tải cách đây ${age} phút` : ''}${state.online && next > 0 ? ` · làm mới sau khoảng ${next} phút` : ''}. Radar RainViewer là ảnh tổng hợp mưa. Không dùng thay cảnh báo chính thức khi có thiên tai.`;
    }
  }

  async function fetchJSON(url, options = {}, retries = 1) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return await res.json();
      } catch (err) { lastErr = err; if (attempt < retries) await sleep(450 * (attempt + 1)); }
      finally { clearTimeout(timer); }
    }
    throw lastErr;
  }

  function savePreferences() {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({ place: state.currentPlace, base: state.activeBaseName, radarEnabled: state.radar.enabled, radarOpacity: state.radar.opacity, markerVisible: state.markerVisible }));
    } catch {}
  }
  function restorePreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.storageKey) || 'null');
      if (!saved) return;
      if (saved.place && Number.isFinite(Number(saved.place.latitude)) && Number.isFinite(Number(saved.place.longitude))) state.currentPlace = saved.place;
      if (['osm','satellite','terrain'].includes(saved.base)) state.activeBaseName = saved.base;
      if (typeof saved.radarEnabled === 'boolean') state.radar.enabled = saved.radarEnabled;
      if (Number.isFinite(Number(saved.radarOpacity))) state.radar.opacity = Math.min(1, Math.max(.2, Number(saved.radarOpacity)));
      if (typeof saved.markerVisible === 'boolean') state.markerVisible = saved.markerVisible;
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
      history.replaceState(null, '', u);
    } catch {}
  }

  function togglePanel(panel, trigger) { panel.hidden = !panel.hidden; trigger.classList.toggle('active', !panel.hidden); }
  function setLoading(on) { els.loading.hidden = !on; }
  function showToast(message, duration = 3200) { if (state.toastTimer) clearTimeout(state.toastTimer); els.toast.textContent = message; els.toast.hidden = false; state.toastTimer = setTimeout(() => { els.toast.hidden = true; }, duration); }

  function weatherCode(code, isDay = 1) {
    const night = Number(isDay) === 0;
    if (code === 0) return { icon: night ? '🌙' : '☀️', text: 'Trời quang' };
    if (code === 1) return { icon: night ? '☁️' : '🌤️', text: 'Khá quang' };
    if (code === 2) return { icon: '⛅', text: 'Mây rải rác' };
    if (code === 3) return { icon: '☁️', text: 'Nhiều mây' };
    if ([45,48].includes(code)) return { icon: '🌫️', text: 'Sương mù' };
    if ([51,53,55,56,57].includes(code)) return { icon: '🌦️', text: 'Mưa phùn' };
    if ([61,63,65,66,67].includes(code)) return { icon: '🌧️', text: code >= 65 ? 'Mưa to' : 'Có mưa' };
    if ([71,73,75,77].includes(code)) return { icon: '🌨️', text: 'Tuyết' };
    if ([80,81,82].includes(code)) return { icon: '🌧️', text: code === 82 ? 'Mưa rào mạnh' : 'Mưa rào' };
    if ([85,86].includes(code)) return { icon: '🌨️', text: 'Mưa tuyết' };
    if ([95,96,99].includes(code)) return { icon: '⛈️', text: code === 95 ? 'Dông' : 'Dông kèm mưa đá' };
    return { icon: '☁️', text: 'Thời tiết biến đổi' };
  }

  function compass(deg) {
    if (!Number.isFinite(Number(deg))) return '--';
    const names = ['B','BĐB','ĐB','ĐĐB','Đ','ĐĐN','ĐN','NĐN','N','NTN','TN','TTN','T','TTB','TB','BTB'];
    return names[Math.round(((Number(deg) % 360) / 22.5)) % 16];
  }
  function formatTime(value) { if (!value) return '--:--'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }
  function formatWeekday(value) { const d = new Date(`${value}T12:00:00`), s = d.toLocaleDateString('vi-VN', { weekday: 'short' }); return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmtCoord(n, pos, neg) { return `${Math.abs(Number(n)).toFixed(4)}°${Number(n) >= 0 ? pos : neg}`; }
  function round(n) { return Number.isFinite(Number(n)) ? Math.round(Number(n)) : '--'; }
  function fmtNumber(n, digits = 1) { return Number.isFinite(Number(n)) ? Number(n).toFixed(digits) : '--'; }
  function debounce(fn, wait) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }
})();
