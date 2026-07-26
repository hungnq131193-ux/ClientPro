# Dữ liệu tra cứu sáp nhập đơn vị hành chính (DVHC)

File `dvhc.v1.json` là dữ liệu offline cho tool "Tra cứu sáp nhập ĐVHC"
(`assets/dvhc-lookup/`). Ứng dụng KHÔNG gọi API ngoài lúc chạy — toàn bộ tra
cứu dùng file này (precache bởi Service Worker).

## Nguồn và căn cứ

- Nguồn dữ liệu: package npm [`vietnam-address-database`](https://github.com/quangtam/vietnam-address-database)
  phiên bản 1.0.0, giấy phép MIT.
- Căn cứ pháp lý của dữ liệu: Nghị quyết 202/2025/QH15 (sắp xếp ĐVHC cấp
  tỉnh: 63 → 34), các Nghị quyết của UBTVQH về sắp xếp ĐVHC cấp xã năm 2025
  (~10.000 xã cũ → 3.321 xã/phường/đặc khu), Quyết định 19/2025/QĐ-TTg
  (bảng danh mục và mã số ĐVHC).
- Dữ liệu chỉ mang tính đối chiếu tham khảo; khi lập hồ sơ pháp lý phải kiểm
  tra văn bản gốc.

## Cách sinh lại dữ liệu

```
node scripts/build-dvhc-data.mjs                 # tải nguồn từ npm registry
node scripts/build-dvhc-data.mjs --input <path>  # dùng file address.json có sẵn
```

Script chuẩn hoá + tự kiểm tra toàn vẹn (mọi dòng đối chiếu phải trỏ được tới
xã mới hợp lệ; 1 tỉnh cũ thuộc trọn 1 tỉnh mới; đủ 34 tỉnh mới, 63 tỉnh cũ)
và exit khác 0 nếu dữ liệu nguồn có vấn đề. 5 huyện đảo cũ không có cấp xã
(Bạch Long Vĩ, Côn Đảo, Cồn Cỏ, Hoàng Sa, Lý Sơn) được bổ sung thông tin đơn
vị cũ thủ công trong script.

## Schema `dvhc.v1.json`

```
{
  meta: { schema, source, legal, generatedAt, counts },
  provinces:    [[maTinhMoi, tenTinhMoi], ...]           // 34, index = pIdx
  oldProvinces: [[tenTinhCu, pIdx], ...]                 // 63, index = opIdx
  oldDistricts: [[tenHuyenCu, opIdx], ...]               // index = dIdx
  wards:        [[maXaMoi, tenXaMoi, pIdx], ...]         // 3321, index = wIdx
  map:          [[tenXaCu, dIdx, wIdx], ...]             // 10977 dòng cũ → mới
}
```

- `map` dùng chỉ mục (dIdx → oldDistricts → opIdx → oldProvinces → pIdx) để
  nén dung lượng; một xã cũ có thể xuất hiện nhiều dòng (chia tách về nhiều
  xã mới); dòng có `tenXaCu` rỗng là huyện đảo cũ không có cấp xã.
- Xã "mới" giữ nguyên (không sáp nhập) vẫn có dòng đối chiếu (cũ = mới).

## Thôn / tổ dân phố (đợt sắp xếp 2026)

Đợt sắp xếp thôn/tổ dân phố theo Quyết định 758/QĐ-TTg (hoàn thành trước
31/5/2026) CHƯA có dataset tập trung máy-đọc-được — mỗi tỉnh ban hành quyết
định riêng. Tool hỗ trợ nạp "gói dữ liệu thôn/TDP theo tỉnh" từ file JSON do
người dùng cung cấp (xem `assets/dvhc-lookup/dvhc_data.js`, hàm
`importPack`), lưu trong `localStorage` key `clientpro_dvhc_pack`.
