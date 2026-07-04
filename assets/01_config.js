        // --- WEATHER CONFIG (Open-Meteo: không cần API key) ---
const WEATHER_STORAGE_KEY = 'app_weather_cache_v1';
const WEATHER_CACHE_TTL = 15 * 60 * 1000; // 15 phút
const SCRIPT_KEY = 'app_script_url';
// --- CẤU HÌNH SERVER TRUNG TÂM ---
const ADMIN_SERVER_URL = "https://script.google.com/macros/s/AKfycbyXsfCbZTaRTTM5nEmwA6YS6PS2lRFp3yxEI-d5I4UQgIB45CRYAuNWa0Y98kEB9oxK-g/exec"; 
const USER_SCRIPT_KEY = 'app_user_script_url';
const USER_TOKEN_KEY = 'app_user_script_token';
// map weathercode -> text tiếng Việt đơn giản
const WEATHER_CODE_TEXT = {
    0: 'Trời quang',
    1: 'Gần như quang',
    2: 'Có mây',
    3: 'Nhiều mây',
    45: 'Sương mù',
    48: 'Sương mù',
    51: 'Mưa phùn nhẹ',
    53: 'Mưa phùn',
    55: 'Mưa phùn to',
    61: 'Mưa nhẹ',
    63: 'Mưa vừa',
    65: 'Mưa to',
    71: 'Tuyết nhẹ',
    80: 'Mưa rào',
    81: 'Mưa rào vừa',
    82: 'Mưa rào to',
    95: 'Dông'
};
// --- END WEATHER CONFIG ---
        // --- DONATE CONFIG ---
const DONATE_BANK_ID = 'vietinbank'; // dùng theo chuẩn VietQR Quick Link 0
const DONATE_ACCOUNT_NO = '888886838888';
const DONATE_ACCOUNT_NAME = 'NGUYEN QUOC HUNG';
const DONATE_DEFAULT_DESC = 'Ung ho tac gia ClientPro';
// --- END DONATE CONFIG ---
// --- ROAD DISTANCE CONFIG (OSRM: không cần API key) ---
// Server chính: FOSSGIS (routing.openstreetmap.de) — server routing chính thức của
// openstreetmap.org, dữ liệu OSM cập nhật hàng tuần, miễn phí, không cần key.
// Server dự phòng: OSRM demo (router.project-osrm.org) — dữ liệu cũ hơn nhiều,
// chỉ dùng khi server chính không phản hồi.
const OSRM_TABLE_URLS = [
    'https://routing.openstreetmap.de/routed-car/table/v1/driving/',
    'https://router.project-osrm.org/table/v1/driving/'
];
const ROAD_DIST_TIMEOUT_MS = 8000;
// v2: đổi key để loại bỏ các quãng đường sai đã cache từ bản cũ (chưa kiểm tra điểm bám đường)
const ROAD_DIST_CACHE_KEY = 'app_road_dist_cache_v2';
const ROAD_DIST_CACHE_OLD_KEYS = ['app_road_dist_cache_v1'];
const ROAD_DIST_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const ROAD_DIST_CACHE_MAX = 600; // số cặp tọa độ tối đa trong cache
// Tọa độ bị OSRM "bám" vào đường xa hơn mức này (mét) -> bản đồ thiếu đường quanh đó,
// quãng đường trả về không đáng tin -> bỏ, giữ khoảng cách đường chim bay.
const ROAD_DIST_SNAP_MAX_M = 500;
// --- END ROAD DISTANCE CONFIG ---
