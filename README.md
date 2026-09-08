# 🌧️ Mưa Gió LIVE · Vietflex Weather GIS

WebGIS thời tiết theo địa phương cho Việt Nam, tối ưu để chạy trực tiếp bằng **GitHub Pages**, không cần backend ở cấu hình mặc định.

🌐 Trang chạy: https://vietflexmap.github.io/muagio/

## Tính năng hiện tại

- 🔎 Tìm tỉnh/thành/huyện/địa danh và xem thời tiết theo tọa độ.
- 📍 Lấy GPS của người dùng hoặc click trực tiếp lên bản đồ để tra cứu điểm bất kỳ.
- 🌡️ Điều kiện hiện tại: nhiệt độ, cảm giác, độ ẩm, mưa, mây, áp suất, gió và gió giật.
- 🕐 Dự báo 24 giờ và xu hướng 7 ngày.
- 🌧️ Radar mưa RainViewer với khoảng 2 giờ dữ liệu quá khứ, timeline và animation.
- 🗺️ Ba nền bản đồ: OpenStreetMap, Esri World Imagery, OpenTopoMap.
- 🔄 Ứng dụng tự yêu cầu làm mới thời tiết mỗi 2 phút và radar mỗi 5 phút khi tab đang hoạt động.
- 👁️ Khi quay lại tab sau thời gian dài, dữ liệu được đồng bộ ngay nếu đã quá hạn refresh.
- 📶 Tự nhận biết online/offline và tự đồng bộ lại khi mạng trở lại.
- 💾 Cache dữ liệu thời tiết gần nhất trong localStorage để tránh màn hình trắng khi API/mạng tạm lỗi.
- 🧠 Chống request chồng nhau, có timeout và retry cho dữ liệu thời tiết/radar.
- 🔗 Lưu tọa độ hiện tại vào URL để có thể chia sẻ trực tiếp vị trí đang xem.
- 💽 Ghi nhớ địa phương, basemap, bật/tắt radar, độ trong radar và trạng thái marker.
- ⚠️ Chỉ báo tự động khi gió mạnh, mưa lớn hoặc xác suất mưa rất cao; không thay thế cảnh báo chính thức.
- 📱 Responsive cho desktop/mobile.

> “2 phút/lần” và “5 phút/lần” là chu kỳ **ứng dụng kiểm tra/lấy lại dữ liệu**. Tần suất cập nhật thực tế của mô hình thời tiết và từng ảnh radar do nhà cung cấp dữ liệu quyết định.

## Kiến trúc

```text
Browser / GitHub Pages
        │
        ├── Vietflex Map SDK
        │     ├── basemap OSM
        │     ├── satellite Esri
        │     └── terrain OpenTopoMap
        │
        ├── Weather Controller
        │     ├── auto refresh 2 min
        │     ├── timeout + retry
        │     ├── local cache
        │     ├── online/offline recovery
        │     └── visibility refresh
        │
        ├── Open-Meteo
        │     ├── Geocoding
        │     ├── Current conditions
        │     ├── Hourly forecast
        │     └── Daily forecast
        │
        └── RainViewer
              ├── weather-maps.json
              ├── tiled radar frames
              ├── timeline
              └── animation
```

## Lõi Vietflex / ẢnhMap

Thiết kế kế thừa cách tổ chức **map core / basemap / layer control / responsive map UI** từ:

- `Vietflexmap/anhmap`
- `Vietflexmap/VN`

Vietflex SDK được ghim vào một commit cụ thể để tránh thay đổi không kiểm soát từ CDN. Ứng dụng hỗ trợ cả hai kiểu API:

```js
new Vietflex.TileLayer(...)
new Vietflex.Marker(...)
new Vietflex.DivIcon(...)
```

và helper kiểu Leaflet nếu một phiên bản Vietflex tương lai cung cấp:

```js
Vietflex.tileLayer(...)
Vietflex.marker(...)
Vietflex.divIcon(...)
```

## Nguồn dữ liệu

### Open-Meteo

Dùng cho tra cứu địa danh, điều kiện hiện tại và dự báo. Đây là **dữ liệu mô hình theo tọa độ**, không được trình bày như số đo của một trạm tại chỗ.

### RainViewer

Dùng cho radar tổng hợp. Ứng dụng đọc `weather-maps.json`, lấy các frame radar hiện có và dựng tile overlay trên Vietflex Map. Radar có thể có khu vực không phủ hoặc dữ liệu chậm hơn thời gian thực tuyệt đối.

## Mô hình cập nhật LIVE

```text
Open trang
   ↓
load vị trí đã lưu / URL / Hà Nội
   ↓
Open-Meteo current + hourly + daily
   ↓
render dashboard
   ↓
cache localStorage
   ↓
2 phút → kiểm tra lại thời tiết

RainViewer manifest
   ↓
latest radar frame
   ↓
5 phút → kiểm tra frame mới

Offline
   ↓
giữ dữ liệu gần nhất
   ↓
Online trở lại
   ↓
refresh weather + radar ngay
```

## Chạy local

Không nên mở trực tiếp bằng `file://`. Dùng HTTP server:

```bash
python -m http.server 8080
```

Sau đó mở `http://localhost:8080`.

## GitHub Pages

Workflow trong `.github/workflows/pages.yml` deploy nội dung repository lên GitHub Pages. Nếu repository chưa bật Pages, vào **Settings → Pages → Source → GitHub Actions**.

## Ghi chú an toàn dữ liệu

- Không nhúng API key hay token bí mật vào source public.
- Open-Meteo là dữ liệu mô hình, không phải cảm biến hiện trường tại chính tọa độ người dùng.
- RainViewer là radar tổng hợp gần thời gian thực và không có SLA cho ứng dụng cộng đồng.
- Chỉ báo mưa/gió trong giao diện là logic hỗ trợ quan sát, **không phải cảnh báo thiên tai chính thức**.
- Khi có bão/lũ/thiên tai, cần ưu tiên thông tin của cơ quan khí tượng và phòng chống thiên tai có thẩm quyền.

## Hướng phát triển tiếp

1. **Trạm mưa IoT/VRain public**: hiển thị cảm biến thực địa và so sánh với mô hình Open-Meteo.
2. **Ranh giới hành chính ẢnhMap/PMTiles**: click xã/phường → tự lấy tâm/extent → thời tiết theo địa phương.
3. **Cảnh báo theo polygon**: mưa lớn/gió mạnh gắn với ranh giới xã/huyện/tỉnh.
4. **PWA/offline**: service worker, cache shell và dữ liệu gần nhất.
5. **Web Push**: theo dõi một địa phương và nhận cảnh báo khi điều kiện vượt ngưỡng.
6. **Windy API chính chủ**: container riêng cho gió, mây, áp suất và forecast overlays.
7. **Bản đồ trạm thời gian thực**: clustering, sparkline mưa 1h/3h/6h/24h, trạng thái sensor và thời gian truyền cuối.

---

**Long Ngo · Vietflexmap · 2026**
