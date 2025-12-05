/* config.js - Cấu hình hệ thống & Biến toàn cục */

// --- CẤU HÌNH LIÊN KẾT SERVER ---
const ADMIN_SERVER_URL = "https://script.google.com/macros/s/AKfycbw0e3GftH7hDQJo12uhlPWyZI-YkFTsx-wNEs2BOG4Cklp1oNgo8ryldtWYyyKFzS6cRA/exec";
const SCRIPT_KEY = 'app_script_url';
const USER_SCRIPT_KEY = 'app_user_script_url';

// --- HẰNG SỐ HỆ THỐNG ---
const DB_NAME = 'QLKH_Pro_V4';
const PIN_KEY = 'app_pin';
const SEC_KEY = 'app_sec_qa';
const THEME_KEY = 'app_theme';
const ACTIVATED_KEY = 'app_activated';
const EMPLOYEE_KEY = 'app_employee_id';
const WEATHER_STORAGE_KEY = 'app_weather_cache_v1';
const WEATHER_CACHE_TTL = 30 * 60 * 1000;

// --- CẤU HÌNH DONATE & MAP ---
const DONATE_BANK_ID = 'vietinbank';
const DONATE_ACCOUNT_NO = '888886838888';
const DONATE_ACCOUNT_NAME = 'NGUYEN QUOC HUNG';
const DONATE_DEFAULT_DESC = 'Ung ho tac gia ClientPro';

const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const WEATHER_CODE_TEXT = {
    0: 'Trời quang', 1: 'Gần như quang', 2: 'Có mây', 3: 'Nhiều mây',
    45: 'Sương mù', 48: 'Sương mù', 51: 'Mưa phùn nhẹ', 53: 'Mưa phùn',
    55: 'Mưa phùn to', 61: 'Mưa nhẹ', 63: 'Mưa vừa', 65: 'Mưa to',
    71: 'Tuyết nhẹ', 80: 'Mưa rào', 81: 'Mưa rào vừa', 82: 'Mưa rào to', 95: 'Dông'
};

// --- BIẾN TOÀN CỤC (GLOBAL STATE) ---
let db;
let map = null;
let markers = [];
let masterKey = null;
let APP_BACKUP_SECRET = '';
let currentPin = '';

// Dữ liệu Runtime
let currentCustomerId = null;
let currentCustomerData = null;
let currentAssetId = null;
let activeListTab = 'pending';
let isSelectionMode = false;
let selectedImages = new Set();
let isCustSelectionMode = false;
let selectedCustomers = new Set();

// Camera & QR
let captureMode = 'profile';
let stream = null;
let currentImageId = null;
let currentImageBase64 = null;
let html5QrCode = null;
let isQrBusy = false;
let qrMode = null;
let autoZoomInterval = null;

// Lightbox
let currentLightboxIndex = 0;
let currentLightboxList = [];
let newWorker;

// Helper viết tắt
function getEl(id) { return document.getElementById(id); }
