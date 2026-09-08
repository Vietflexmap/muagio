# 🌧️ Mưa Gió · Vietflex Weather GIS

WebGIS thời tiết theo địa phương cho Việt Nam, tối ưu để chạy trực tiếp bằng **GitHub Pages** và không yêu cầu backend ở phiên bản mặc định.

## Tính năng

- 🔎 Tìm tỉnh/thành/huyện/địa danh và xem thời tiết theo tọa độ.
- 📍 Lấy GPS của người dùng hoặc click trực tiếp lên bản đồ.
- 🌡️ Điều kiện hiện tại: nhiệt độ, cảm giác, độ ẩm, mưa, mây, áp suất, gió và gió giật.
- 🕐 Dự báo 24 giờ và xu hướng 7 ngày.
- 🌧️ Radar mưa gần thời gian thực với timeline và animation.
- 🗺️ Ba nền bản đồ: OpenStreetMap, Esri World Imagery, OpenTopoMap.
- 📱 Responsive cho desktop/mobile.
- 🔄 Tự làm mới thời tiết 5 phút và radar 10 phút.

## Kiến trúc

```text
Browser / GitHub Pages
        │
        ├── Vietflex Map SDK
        │     ├── basemap OSM
        │     ├── satellite Esri
        │     └── terrain OpenTopoMap
        │
        ├── Open-Meteo
        │     ├── Geocoding
        │     ├── Current conditions
        │     ├── Hourly forecast
        │     └── Daily forecast
        │
        └── RainViewer
              └── tiled radar frames + timeline
```

## Nguồn mã được tái sử dụng

Thiết kế này kế thừa cách tổ chức **map core / basemap / layer control / responsive map UI** từ hệ sinh thái:

- `Vietflexmap/anhmap`
- `Vietflexmap/VN`

Các bundle Apple MapKit, Windy và VRain trong nguồn tham khảo chỉ được dùng để học mô hình kiến trúc (container/layer/state); dự án **không sao chép khóa API, token hoặc mã thư viện đóng gói của bên thứ ba**.

## Chạy local

Không mở trực tiếp bằng `file://`. Dùng HTTP server:

```bash
python -m http.server 8080
```

Sau đó mở `http://localhost:8080`.

## GitHub Pages

Workflow trong `.github/workflows/pages.yml` deploy nội dung repository lên GitHub Pages. Nếu repository chưa bật Pages, vào **Settings → Pages → Source → GitHub Actions**.

## Ghi chú dữ liệu

- Open-Meteo là dữ liệu mô hình theo tọa độ, không được trình bày như một trạm đo tại chỗ.
- RainViewer là radar tổng hợp gần thời gian thực và có thể có vùng không phủ radar.
- Khi có bão/lũ/thiên tai, cần ưu tiên thông tin cảnh báo chính thức của cơ quan khí tượng và phòng chống thiên tai.

## Phát triển tiếp

Các lớp có thể bổ sung sau:

1. Trạm mưa IoT/VRain public nếu endpoint và CORS cho phép sử dụng hợp lệ.
2. Cảnh báo mưa lớn theo polygon địa phương.
3. Lớp ranh giới hành chính từ ẢnhMap/PMTiles.
4. PWA/offline cache cho basemap và dự báo gần nhất.
5. Web Push theo địa phương người dùng theo dõi.
6. Windy overlay ở container riêng bằng API key chính chủ.
