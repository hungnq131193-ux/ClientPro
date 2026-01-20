        // --- WEATHER CONFIG (Open-Meteo: không cần API key) ---
const WEATHER_STORAGE_KEY = 'app_weather_cache_v1';
const WEATHER_CACHE_TTL = 15 * 60 * 1000; // 15 phút
const SCRIPT_KEY = 'app_script_url';
// --- CẤU HÌNH SERVER TRUNG TÂM ---
const ADMIN_SERVER_URL = "https://script.google.com/macros/s/AKfycbyXsfCbZTaRTTM5nEmwA6YS6PS2lRFp3yxEI-d5I4UQgIB45CRYAuNWa0Y98kEB9oxK-g/exec"; 
const USER_SCRIPT_KEY = 'app_user_script_url';
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
