/**
 * CONFIG.JS
 * Chứa toàn bộ hằng số và cấu hình tĩnh của ứng dụng ClientPro.
 * File này cần được load đầu tiên.
 */

// --- CẤU HÌNH DATABASE (INDEXEDDB) ---
const DB_NAME = 'QLKH_Pro_V4';
const DB_VERSION = 3; // Lấy từ req = indexedDB.open(DB_NAME, 3)

// --- CẤU HÌNH LOCAL STORAGE KEYS ---
const PIN_KEY = 'app_pin';
const SEC_KEY = 'app_sec_qa';
const THEME_KEY = 'app_theme';
const ACTIVATED_KEY = 'app_activated';
const EMPLOYEE_KEY  = 'app_employee_id';
const SCRIPT_KEY = 'app_script_url';
const USER_SCRIPT_KEY = 'app_user_script_url';

// --- CẤU HÌNH SERVER & API ---
// Server quản trị trung tâm (Google Apps Script)
const ADMIN_SERVER_URL = "https://script.google.com/macros/s/AKfycbw0e3GftH7hDQJo12uhlPWyZI-YkFTsx-wNEs2BOG4Cklp1oNgo8ryldtWYyyKFzS6cRA/exec";

// --- CẤU HÌNH THỜI TIẾT (OPEN-METEO) ---
const WEATHER_STORAGE_KEY = 'app_weather_cache_v1';
const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 phút
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

// --- CẤU HÌNH DONATE (VIETQR) ---
const DONATE_BANK_ID = 'vietinbank';
const DONATE_ACCOUNT_NO = '888886838888';
const DONATE_ACCOUNT_NAME = 'NGUYEN QUOC HUNG';
const DONATE_DEFAULT_DESC = 'Ung ho tac gia ClientPro';

// --- CẤU HÌNH BẢN ĐỒ (MAP TILES) ---
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// --- CẤU HÌNH GIAO DIỆN (THEME) ---
const VALID_THEMES = ['theme-midnight', 'theme-sunset', 'theme-ocean', 'theme-mint', 'theme-royal'];
const DEFAULT_THEME = 'theme-midnight';
