// ============================================================
// CONFIG.JS - CẤU HÌNH & BIẾN TOÀN CỤC (LOAD ĐẦU TIÊN)
// ============================================================

// 1. CẤU HÌNH HỆ THỐNG (CONSTANTS)
const DB_NAME = 'QLKH_Pro_V4';
const ADMIN_SERVER_URL = "https://script.google.com/macros/s/AKfycbw0e3GftH7hDQJo12uhlPWyZI-YkFTsx-wNEs2BOG4Cklp1oNgo8ryldtWYyyKFzS6cRA/exec";

// Các Key lưu trữ trong LocalStorage
const PIN_KEY = 'app_pin';
const SEC_KEY = 'app_sec_qa';
const THEME_KEY = 'app_theme';
const ACTIVATED_KEY = 'app_activated';
const EMPLOYEE_KEY = 'app_employee_id';
const WEATHER_STORAGE_KEY = 'app_weather_cache_v1';
const USER_SCRIPT_KEY = 'app_user_script_url';
const SCRIPT_KEY = 'app_script_url'; // Legacy key

// Cấu hình Donate & Ngân hàng
const DONATE_BANK_ID = 'vietinbank';
const DONATE_ACCOUNT_NO = '888886838888';
const DONATE_ACCOUNT_NAME = 'NGUYEN QUOC HUNG';
const DONATE_DEFAULT_DESC = 'Ung ho tac gia ClientPro';

// Cấu hình Bản đồ (Tile Layers)
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// Cấu hình Thời tiết
const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 phút
const WEATHER_CODE_TEXT = {
    0: 'Trời quang', 1: 'Gần như quang', 2: 'Có mây', 3: 'Nhiều mây',
    45: 'Sương mù', 48: 'Sương mù', 51: 'Mưa phùn nhẹ', 53: 'Mưa phùn',
    55: 'Mưa phùn to', 61: 'Mưa nhẹ', 63: 'Mưa vừa', 65: 'Mưa to',
    71: 'Tuyết nhẹ', 80: 'Mưa rào', 81: 'Mưa rào vừa', 82: 'Mưa rào to', 95: 'Dông'
};

// ============================================================
// 2. BIẾN TRẠNG THÁI (GLOBAL VARIABLES)
// ============================================================

// Database & Map
let db;                 // Biến chứa kết nối IndexedDB
let map = null;         // Biến chứa đối tượng bản đồ Leaflet
let markers = [];       // Mảng chứa các điểm marker trên bản đồ

// Bảo mật & Auth
let masterKey = null;       // Khóa giải mã chính (lưu trong RAM sau khi đăng nhập)
let APP_BACKUP_SECRET = ''; // Khóa bí mật để backup/restore (lấy từ Server)
let currentPin = '';        // Mã PIN đang nhập tạm thời

// Trạng thái Giao diện & Dữ liệu
let currentCustomerId = null;   // ID khách hàng đang xem
let currentCustomerData = null; // Dữ liệu khách hàng đang xem (đã giải mã)
let currentAssetId = null;      // ID tài sản đang xem
let activeListTab = 'pending';  // Tab danh sách đang chọn ('pending' hoặc 'approved')

// Trạng thái Chọn nhiều (Selection Mode)
let isSelectionMode = false;        // Chế độ chọn ảnh
let selectedImages = new Set();     // Danh sách ID ảnh đã chọn
let isCustSelectionMode = false;    // Chế độ chọn khách hàng
let selectedCustomers = new Set();  // Danh sách ID khách hàng đã chọn

// Camera & Lightbox
let captureMode = 'profile';    // Chế độ chụp ('profile' hoặc 'asset')
let stream = null;              // Luồng Video Camera
let currentImageId = null;      // ID ảnh đang xem trong Lightbox
let currentImageBase64 = null;  // Data ảnh đang xem
let currentLightboxIndex = 0;   // Vị trí ảnh trong album
let currentLightboxList = [];   // Danh sách ảnh trong album hiện tại
let currentOcrBase64 = null;    // Biến tạm cho OCR (nếu dùng lại)

// Biến cho QR Scanner
let html5QrCode = null;
let isQrBusy = false;
let qrMode = null;
let autoZoomInterval = null; 

// ============================================================
// 3. CÁC HÀM TIỆN ÍCH CƠ BẢN (UTILS)
// ============================================================

// Lấy phần tử theo ID (Viết tắt cho nhanh)
function getEl(id) { 
    return document.getElementById(id); 
}

// Chuyển đổi chuỗi tiền tệ thành số (VD: "1.200.000" -> 1200000)
function parseMoneyToNumber(str) { 
    if(!str) return 0; 
    return parseInt(str.toString().replace(/\D/g, '')) || 0; 
}

// Định dạng Link bản đồ (thêm https nếu thiếu)
function formatLink(link) { 
    if(!link) return ''; 
    if(link.startsWith('http')) return link; 
    return 'https://' + link; 
}

// Chống XSS khi hiển thị dữ liệu người dùng nhập
function escapeHTML(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Chặn thông báo Console log rác để App nhìn sạch hơn
console.warn = function() {};
