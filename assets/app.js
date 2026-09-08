(() => {
  'use strict';

  const CONFIG = {
    defaultPlace: { name: 'Hà Nội', latitude: 21.0285, longitude: 105.8542 },
    weatherRefreshMs: 5 * 60 * 1000,
    radarRefreshMs: 10 * 60 * 1000,
    radarFrameMs: 650,
    radarColor: 2,
    radarSmooth: 1,
    radarSnow: 1,
    radarMaxNativeZoom: 7,
    mapZoom: 8,
  };

  const state = {
    map: null,
    baseLayers: {},
    activeBase: null,
    marker: null,
    markerVisible: true,
    currentPlace: { ...CONFIG.defaultPlace },
    weather: null,
    radar: { enabled: true, manifest: null, frames: [], index: 0, layer: null, opacity: 0.65, timer: null, playing: false },
    searchController: null,
    toastTimer: null,
    weatherTimer: null,
    radarTimer: null,
  };

  const $ = (id) => document.getElementById(id);
  const els = {};
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheElements();
    bindUI();
    if (!window.Vietflex) {
      showToast('Không tải được Vietflex Map SDK. Hãy kiểm tra kết nối mạng.', 8000);
      return;
    }
    initMap();
    selectPlace(CONFIG.defaultPlace, { zoom: CONFIG.mapZoom, source: 'default' });
    refreshRadarManifest();
    state.weatherTimer = window.setInterval(() => refreshWeather(false), CONFIG.weatherRefreshMs);
    state.radarTimer = window.setInterval(refreshRadarManifest, CONFIG.radarRefreshMs);
  }

  function cacheElements() {
    ['searchForm','searchInput','searchResults','clearSearch','locateBtn','layersBtn','layerPanel','weatherPanelBtn','weatherPanel','refreshBtn','placeName','placeMeta','weatherIcon','currentTemp','weatherText','feelsLike','updatedAt','humidity','rain','wind','windDir','pressure','cloud','gust','hourlyForecast','dailyForecast','radarToggle','markerToggle','radarOpacity','radarOpacityValue','radarBar','radarStatus','radarTime','radarSlider','radarPlayBtn','toast','loading'].forEach(id => els[id] = $(id));
  }

  function bindUI() {
    els.searchForm.addEventListener('submit', (e) => { e.preventDefault(); searchPlaces(els.searchInput.value.trim()); });
    els.searchInput.addEventListener('input', debounce(() => {
      const q = els.searchInput.value.trim();
      if (q.length >= 2) searchPlaces(q); else hideSearchResults();
    }, 300));
    els.clearSearch.addEventListener('click', () => { els.searchInput.value = ''; els.searchInput.focus(); hideSearchResults(); });
    els.locateBtn.addEventListener('click', locateUser);
    els.layersBtn.addEventListener('click', () => togglePanel(els.layerPanel, els.layersBtn));
    els.weatherPanelBtn.addEventListener('click', () => els.weatherPanel.classList.toggle('open'));
    els.refreshBtn.addEventListener('click', () => refreshWeather(true));

    document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => {
      const panel = $(btn.dataset.close); if (panel) panel.hidden = true; els.layersBtn.classList.remove('active');
    }));
    document.querySelectorAll('[data-base]').forEach(btn => btn.addEventListener('click', () => setBasemap(btn.dataset.base)));
    document.querySelectorAll('.quick-places button').forEach(btn => btn.addEventListener('click', () => {
      selectPlace({ name: btn.dataset.place, latitude: Number(btn.dataset.lat), longitude: Number(btn.dataset.lon) }, { zoom: 9, source: 'quick' });
    }));

    els.radarToggle.addEventListener('change', () => {
      state.radar.enabled = els.radarToggle.checked;
      if (state.radar.enabled) setRadarFrame(state.radar.index); else removeRadarLayer();
      els.radarBar.style.opacity = state.radar.enabled ? '1' : '.55';
    });
    els.markerToggle.addEventListener('change', () => { state.markerVisible = els.markerToggle.checked; syncMarkerVisibility(); });
    els.radarOpacity.addEventListener('input', () => {
      state.radar.opacity = Number(els.radarOpacity.value) / 100;
      els.radarOpacityValue.textContent = `${els.radarOpacity.value}%`;
      if (state.radar.layer?.setOpacity) state.radar.layer.setOpacity(state.radar.opacity);
    });
    els.radarSlider.addEventListener('input', () => { stopRadarAnimation(); setRadarFrame(Number(els.radarSlider.value)); });
    els.radarPlayBtn.addEventListener('click', () => state.radar.playing ? stopRadarAnimation() : startRadarAnimation());

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrap')) hideSearchResults();
      if (!e.target.closest('#layerPanel') && !e.target.closest('#layersBtn') && !els.layerPanel.hidden) {
        els.layerPanel.hidden = true; els.layersBtn.classList.remove('active');
      }
    });
  }

  function initMap() {
    const V = window.Vietflex;
    state.map = V.vietflexMap('map', {
      center: [CONFIG.defaultPlace.latitude, CONFIG.defaultPlace.longitude], zoom: CONFIG.mapZoom,
      zoomControl: true, attributionControl: true, preferCanvas: true,
    });
    state.baseLayers.osm = V.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, subdomains: 'abc', attribution: '&copy; OpenStreetMap contributors'
    });
    state.baseLayers.satellite = V.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles &copy; Esri'
    });
    state.baseLayers.terrain = V.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, subdomains: 'abc', attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap'
    });
    setBasemap('osm');
    state.map.on('click', (e) => {
      const lat = e.latlng.lat, lon = e.latlng.lng;
      selectPlace({ name: `Điểm ${lat.toFixed(4)}, ${lon.toFixed(4)}`, latitude: lat, longitude: lon }, { zoom: Math.max(state.map.getZoom(), 9), source: 'map' });
      if (window.innerWidth <= 760) els.weatherPanel.classList.add('open');
    });
  }

  function setBasemap(name) {
    const next = state.baseLayers[name]; if (!next || !state.map) return;
    if (state.activeBase && state.map.hasLayer(state.activeBase)) state.map.removeLayer(state.activeBase);
    next.addTo(state.map); state.activeBase = next;
    if (state.radar.layer?.bringToFront) state.radar.layer.bringToFront();
    syncMarkerVisibility();
    document.querySelectorAll('[data-base]').forEach(btn => btn.classList.toggle('active', btn.dataset.base === name));
  }

  async function selectPlace(place, options = {}) {
    state.currentPlace = {
      name: place.name || 'Vị trí đã chọn', admin1: place.admin1 || '', admin2: place.admin2 || '', country: place.country || 'Việt Nam',
      latitude: Number(place.latitude), longitude: Number(place.longitude),
    };
    const { latitude: lat, longitude: lon } = state.currentPlace;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    updateLocationHeader(); updateMarker();
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
    const V = window.Vietflex, p = state.currentPlace;
    if (state.marker && state.map.hasLayer(state.marker)) state.map.removeLayer(state.marker);
    const icon = V.divIcon ? V.divIcon({
      className: 'weather-marker-wrap', html: '<div class="weather-marker"><span>☁</span></div>', iconSize: [32, 32], iconAnchor: [12, 29], popupAnchor: [4, -27],
    }) : undefined;
    state.marker = V.marker([p.latitude, p.longitude], icon ? { icon } : {}).bindPopup(`<b>${escapeHtml(p.name)}</b><br>${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`);
    syncMarkerVisibility();
  }

  function syncMarkerVisibility() {
    if (!state.marker || !state.map) return;
    if (state.markerVisible) { if (!state.map.hasLayer(state.marker)) state.marker.addTo(state.map); }
    else if (state.map.hasLayer(state.marker)) state.map.removeLayer(state.marker);
  }

  async function refreshWeather(userInitiated = false) {
    const p = state.currentPlace; setLoading(true); els.refreshBtn.classList.add('spinning');
    try {
      const params = new URLSearchParams({
        latitude: p.latitude, longitude: p.longitude,
        current: ['temperature_2m','relative_humidity_2m','apparent_temperature','is_day','precipitation','rain','showers','weather_code','cloud_cover','pressure_msl','surface_pressure','wind_speed_10m','wind_direction_10m','wind_gusts_10m'].join(','),
        hourly: ['temperature_2m','precipitation_probability','precipitation','rain','weather_code','wind_speed_10m','wind_direction_10m','wind_gusts_10m','cloud_cover'].join(','),
        daily: ['weather_code','temperature_2m_max','temperature_2m_min','precipitation_sum','rain_sum','precipitation_probability_max','wind_speed_10m_max','wind_gusts_10m_max','sunrise','sunset'].join(','),
        timezone: 'auto', forecast_days: '7', wind_speed_unit: 'kmh', precipitation_unit: 'mm',
      });
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Weather API ${res.status}`);
      state.weather = await res.json(); renderWeather(state.weather);
      if (userInitiated) showToast('Đã cập nhật dữ liệu thời tiết.');
    } catch (err) {
      console.error(err); showToast('Không thể tải dữ liệu thời tiết. Vui lòng thử lại.', 5500);
    } finally { setLoading(false); els.refreshBtn.classList.remove('spinning'); }
  }

  function renderWeather(data) {
    const c = data.current || {}, meta = weatherCode(c.weather_code, c.is_day);
    els.currentTemp.textContent = round(c.temperature_2m); els.weatherIcon.textContent = meta.icon; els.weatherText.textContent = meta.text;
    els.feelsLike.textContent = `${round(c.apparent_temperature)}°`; els.updatedAt.textContent = formatTime(c.time);
    els.humidity.textContent = `${round(c.relative_humidity_2m)}%`; els.rain.textContent = `${fmtNumber((c.rain || 0) + (c.showers || 0), 1)} mm`;
    els.wind.textContent = `${round(c.wind_speed_10m)} km/h`; els.windDir.textContent = `${compass(c.wind_direction_10m)} ${round(c.wind_direction_10m)}°`;
    els.pressure.textContent = `${round(c.pressure_msl ?? c.surface_pressure)} hPa`; els.cloud.textContent = `${round(c.cloud_cover)}%`; els.gust.textContent = `${round(c.wind_gusts_10m)} km/h`;
    renderHourly(data.hourly, c.time); renderDaily(data.daily); updateMarkerWeatherIcon(meta.icon);
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
    const globalMin = Math.min(...lows.filter(Number.isFinite)), globalMax = Math.max(...highs.filter(Number.isFinite)), span = Math.max(1, globalMax - globalMin);
    els.dailyForecast.innerHTML = d.time.map((date, i) => {
      const m = weatherCode(d.weather_code?.[i], 1), lo = lows[i], hi = highs[i], width = Math.max(15, ((hi - lo) / span) * 100), label = i === 0 ? 'Hôm nay' : formatWeekday(date);
      return `<article class="daily-row"><time>${label}</time><span class="wi" title="${m.text}">${m.icon}</span><span class="temp-range" title="${round(lo)}° – ${round(hi)}°"><i style="width:${width}%"></i></span><b>${round(lo)}° / ${round(hi)}°</b><small>☔ ${round(d.precipitation_probability_max?.[i])}%</small></article>`;
    }).join('');
  }

  async function searchPlaces(q) {
    if (!q || q.length < 2) return;
    if (state.searchController) state.searchController.abort();
    state.searchController = new AbortController(); els.searchResults.hidden = false;
    els.searchResults.innerHTML = '<div class="search-result"><span><b>Đang tìm…</b><small>Tra cứu địa danh</small></span></div>';
    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.searchParams.set('name', q); url.searchParams.set('count', '10'); url.searchParams.set('language', 'vi'); url.searchParams.set('format', 'json');
      const res = await fetch(url, { signal: state.searchController.signal }); if (!res.ok) throw new Error(`Geocoding ${res.status}`);
      const data = await res.json(); let results = data.results || [];
      const vn = results.filter(r => ['VN','Vietnam','Việt Nam'].includes(r.country_code) || /Việt Nam|Vietnam/i.test(r.country || '')); if (vn.length) results = vn;
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
      selectPlace({ name: 'Vị trí của bạn', latitude: pos.coords.latitude, longitude: pos.coords.longitude }, { zoom: 11, source: 'gps' });
      if (window.innerWidth <= 760) els.weatherPanel.classList.add('open');
    }, err => {
      els.locateBtn.classList.remove('active'); showToast(err.code === 1 ? 'Bạn chưa cấp quyền truy cập vị trí.' : 'Không xác định được vị trí hiện tại.', 5000);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 });
  }

  async function refreshRadarManifest() {
    els.radarStatus.textContent = 'Đang kết nối…';
    try {
      const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' }); if (!res.ok) throw new Error(`Radar ${res.status}`);
      const data = await res.json(), frames = data.radar?.past || []; if (!frames.length) throw new Error('No radar frames');
      state.radar.manifest = data; state.radar.frames = frames;
      const wasAtLatest = state.radar.index >= Math.max(0, Number(els.radarSlider.max) - 1);
      els.radarSlider.max = String(frames.length - 1); state.radar.index = wasAtLatest || state.radar.index >= frames.length ? frames.length - 1 : state.radar.index;
      els.radarSlider.value = String(state.radar.index); els.radarStatus.textContent = `${frames.length} khung · gần thời gian thực`;
      if (state.radar.enabled) setRadarFrame(state.radar.index);
    } catch (err) {
      console.error(err); els.radarStatus.textContent = 'Radar tạm thời không khả dụng'; showToast('Radar mưa tạm thời không tải được; bản đồ thời tiết vẫn hoạt động.', 4500);
    }
  }

  function setRadarFrame(index) {
    if (!state.radar.enabled || !state.radar.manifest || !state.radar.frames.length || !state.map) return;
    index = Math.max(0, Math.min(index, state.radar.frames.length - 1)); state.radar.index = index; els.radarSlider.value = String(index);
    const frame = state.radar.frames[index], host = state.radar.manifest.host, path = frame.path;
    const url = `${host}${path}/256/{z}/{x}/{y}/${CONFIG.radarColor}/${CONFIG.radarSmooth}_${CONFIG.radarSnow}.png`;
    removeRadarLayer();
    state.radar.layer = window.Vietflex.tileLayer(url, { opacity: state.radar.opacity, maxNativeZoom: CONFIG.radarMaxNativeZoom, maxZoom: 19, zIndex: 450, attribution: 'Weather radar &copy; RainViewer' }).addTo(state.map);
    els.radarTime.textContent = new Date(frame.time * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    if (state.markerVisible && state.marker?.bringToFront) state.marker.bringToFront();
  }

  function removeRadarLayer() { if (state.radar.layer && state.map?.hasLayer(state.radar.layer)) state.map.removeLayer(state.radar.layer); state.radar.layer = null; }
  function startRadarAnimation() {
    if (!state.radar.frames.length || !state.radar.enabled) return;
    state.radar.playing = true; els.radarPlayBtn.textContent = 'Ⅱ'; els.radarPlayBtn.setAttribute('aria-label', 'Tạm dừng radar');
    if (state.radar.index >= state.radar.frames.length - 1) state.radar.index = 0;
    state.radar.timer = window.setInterval(() => { state.radar.index = (state.radar.index + 1) % state.radar.frames.length; setRadarFrame(state.radar.index); }, CONFIG.radarFrameMs);
  }
  function stopRadarAnimation() { state.radar.playing = false; if (state.radar.timer) window.clearInterval(state.radar.timer); state.radar.timer = null; els.radarPlayBtn.textContent = '▶'; els.radarPlayBtn.setAttribute('aria-label', 'Phát radar'); }
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
  function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }
})();
