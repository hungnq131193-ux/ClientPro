// --- LOGIC QUÉT QR (CODE MỚI ĐÃ SỬA: FIX ĐEN MÀN HÌNH + CAM SAU) ---
let html5QrCode = null; // Biến giữ camera
let isQrBusy = false;   // Biến chống click đúp
let qrMode = null;      // Biến lưu chế độ (cccd hoặc redbook)

// --- QR Transfer Backup (mode: backup_transfer) ---
function openBackupTransferScanner() {
    qrMode = 'backup_transfer';
    document.getElementById('qr-modal').classList.remove('hidden');
    startMyScanner();
}

// Backward-compatible alias used by UI
function openQrTransferScanner() {
    openBackupTransferScanner();
}

// Hàm mở Modal và bật Camera
function openQrScanner() { 
    qrMode = 'cccd'; 
    document.getElementById('qr-modal').classList.remove('hidden'); 
    startMyScanner(); 
}

function openRedBookScanner() { 
    qrMode = 'redbook'; 
    document.getElementById('qr-modal').classList.remove('hidden'); 
    startMyScanner(); 
}

// Biến lưu vòng lặp tự động Zoom
let autoZoomInterval = null; 

async function closeQrScanner() {
    const modal = getEl('qr-modal');
    
    // 1. Tắt chế độ tự động Zoom ngay lập tức
    if (autoZoomInterval) {
        clearInterval(autoZoomInterval);
        autoZoomInterval = null;
    }

    if (!html5QrCode || isQrBusy) {
        modal.classList.add('hidden');
        return;
    }
    
    isQrBusy = true; 
    try {
        if (html5QrCode.isScanning) {
            await html5QrCode.stop();
        }
    } catch (err) {
        console.warn(err);
    }
    isQrBusy = false; 
    modal.classList.add('hidden');
}

// Hàm khởi động Camera thông minh (Tự tìm Cam sau)
// --- HÀM KHỞI ĐỘNG CAMERA + TÍNH NĂNG ZOOM (PHIÊN BẢN CẬP NHẬT) ---
async function startMyScanner() {
    const regionId = 'qr-reader';
    if (!html5QrCode) html5QrCode = new Html5Qrcode(regionId);
    if (isQrBusy) return;
    isQrBusy = true;

    try {
        const devices = await Html5Qrcode.getCameras();
        let cameraId = null;

        if (devices && devices.length) {
            const backCam = devices.find(d => {
                const l = d.label.toLowerCase();
                return l.includes('back') || l.includes('rear') || l.includes('environment') || l.includes('sau');
            });
            cameraId = backCam ? backCam.id : devices[devices.length - 1].id;
        } else {
            alert("Lỗi Camera!"); closeQrScanner(); return;
        }

        const config = { fps: 30, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0, disableFlip: false };
        
        await html5QrCode.start(cameraId, config,
            (decodedText) => {
                if (navigator.vibrate) navigator.vibrate(200);
                // Tắt Zoom tự động ngay khi quét được
                if (autoZoomInterval) clearInterval(autoZoomInterval);
                
                if (qrMode === 'cccd') handleCccdResult(decodedText);
                else if (qrMode === 'redbook') handleRedBookResult(decodedText);
                else if (qrMode === 'backup_transfer') {
                    try {
                        if (typeof handleBackupTransferQrResult === 'function') {
                            handleBackupTransferQrResult(decodedText);
                        } else if (window.QRTransferDecode && typeof window.QRTransferDecode.handleScanText === 'function') {
                            window.QRTransferDecode.handleScanText(decodedText);
                        } else {
                            alert('Tính năng QR Transfer chưa sẵn sàng.');
                        }
                    } catch (e) {
                        console.error(e);
                        alert('QR không hợp lệ hoặc lỗi xử lý.');
                    }
                }
                closeQrScanner(); 
            }, () => {} 
        );

        // --- TÍNH NĂNG "AUTO-SWEEP ZOOM" (TỰ ĐỘNG DÒ NÉT) ---
        setTimeout(() => {
            try {
                const track = html5QrCode.getRunningTrackCameraCapabilities();
                const zoomCap = track.zoomFeature();

                if (zoomCap.isSupported()) {
                    // 1. Khởi động ngay ở mức 2.2x (Mức vàng cho CCCD)
                    let currentZoom = Math.min(2.2, zoomCap.max());
                    zoomCap.apply(currentZoom);

                    // 2. Vẽ thanh hiển thị trạng thái Zoom (chỉ để nhìn, không cần kéo)
                    const modalContent = document.querySelector('#qr-modal .glass-panel');
                    const oldSlider = document.getElementById('my-zoom-slider-container');
                    if (oldSlider) oldSlider.remove();

                    const sliderDiv = document.createElement('div');
                    sliderDiv.id = 'my-zoom-slider-container';
                    sliderDiv.className = "mt-4 w-full px-4 animate-fade-in text-center";
                    sliderDiv.innerHTML = `
                        <p class="text-[10px] text-emerald-400 font-bold mb-1 uppercase tracking-widest animate-pulse">
                            <i data-lucide="scan-line" class="inline w-3 h-3"></i> Đang tự động dò nét...
                        </p>
                        <input type="range" id="zoom-slider" disabled
                               min="${zoomCap.min()}" max="${zoomCap.max()}" step="0.1" value="${currentZoom}" 
                               class="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-wait">
                    `;
                    if (modalContent) modalContent.appendChild(sliderDiv);
                    if (window.lucide) lucide.createIcons();

                    // 3. Kích hoạt vòng lặp tự động (Zoom vào từ từ... rồi zoom ra)
                    let direction = 1; // 1 là tăng, -1 là giảm
                    const sliderEl = document.getElementById('zoom-slider');
                    const step = 0.05; // Tốc độ trôi (càng nhỏ càng mượt)
                    const maxZ = Math.min(3.5, zoomCap.max()); // Zoom tối đa
                    const minZ = Math.max(1.5, zoomCap.min()); // Zoom tối thiểu

                    if (autoZoomInterval) clearInterval(autoZoomInterval);
                    
                    autoZoomInterval = setInterval(() => {
                        // Nếu camera đã tắt thì dừng
                        if (!html5QrCode.isScanning) { clearInterval(autoZoomInterval); return; }

                        currentZoom += (step * direction);

                        // Đảo chiều nếu chạm ngưỡng
                        if (currentZoom >= maxZ || currentZoom <= minZ) {
                            direction *= -1;
                        }

                        // Áp dụng zoom
                        zoomCap.apply(currentZoom);
                        if(sliderEl) sliderEl.value = currentZoom;
                        
                    }, 50); // Cập nhật 50ms/lần (~20 khung hình/giây)
                }
            } catch (err) { console.log("No Zoom:", err); }
        }, 500);

    } catch (err) {
        console.error(err); closeQrScanner();
    }
    isQrBusy = false;
}

function handleCccdResult(data) {
    let idNum = '';
    let name = '';
    
    try {
        // Cấu trúc CCCD Chip: 001097005097|123456789|PHAM HOANG NAM|...
        // parts[0]: Số CCCD
        // parts[1]: Số CMND cũ (Code cũ đang nhầm lấy cái này làm tên)
        // parts[2]: Họ và tên (Cần lấy cái này)

        if (data.includes('|')) {
            const parts = data.split('|');
            
            idNum = parts[0] ? parts[0].trim() : '';
            
            // SỬA Ở ĐÂY: Đổi từ parts[1] thành parts[2]
            name = parts[2] ? parts[2].trim().toUpperCase() : ''; 
        } else {
            // Trường hợp dự phòng nếu không phải QR CCCD chuẩn
            idNum = data.trim();
        }
        
        // Điền vào ô Số CCCD
        if (idNum) {
            const cccdInput = document.getElementById('new-cccd');
            if (cccdInput) cccdInput.value = idNum;
        }
        
        // Điền vào ô Tên Khách Hàng
        if (name) {
            const nameInput = document.getElementById('new-name');
            if (nameInput) nameInput.value = name;
        }

    } catch (e) {
        console.error("Lỗi phân tích QR:", e);
        // Nếu lỗi thì vẫn điền chuỗi gốc vào ô CCCD để người dùng tự sửa
        const cccdInput = document.getElementById('new-cccd');
        if (cccdInput) cccdInput.value = data;
    }
}

function handleRedBookResult(data) {
    // 1. Vẫn lưu chuỗi gốc vào ô ẨN để tính năng "Xem thông tin bìa" hoạt động
    // (Nếu không lưu dòng này, nút xem lại thông tin sẽ bị trắng trơn)
    const hiddenInput = document.getElementById('asset-ocr-data');
    if (hiddenInput) hiddenInput.value = data;

    // 2. Xóa trắng ô "Vị trí/Ghi chú" (Không điền chuỗi dài vào đây nữa theo yêu cầu)
    const noteInput = document.getElementById('asset-onland');
    if (noteInput) noteInput.value = ''; 

    // 3. Logic tách lấy "Số bìa đỏ" (AQ 04258571)
    let redBookNum = '';
    
    // ƯU TIÊN 1: Tách theo dấu gạch đứng | (Chuẩn VNeID/ILIS)
    if (data.includes('|')) {
        const parts = data.split('|');
        // Trong ví dụ bạn gửi: 05...|H44...|ILIS...|H44...|AQ 04258571|...
        // Nó nằm ở vị trí thứ 5 (tức là index 4)
        if (parts[4] && parts[4].length > 4) {
            redBookNum = parts[4].trim();
        }
    } 
    
    // ƯU TIÊN 2: Nếu cách trên trượt, dùng Regex quét tìm mẫu (2 chữ hoa + số)
    // Ví dụ: Tìm đoạn giống "AQ 04258571" hoặc "CS 123456"
    if (!redBookNum) {
        const match = data.match(/([A-Z]{2}\s*[0-9]{6,9})/);
        if (match) redBookNum = match[1];
    }

    // 4. Điền kết quả vào ô "Tên Tài Sản"
    const nameInput = document.getElementById('asset-name');
    if (nameInput) {
        if (redBookNum) {
            // Điền số bìa vào
            nameInput.value = "Bìa đỏ " + redBookNum; 
            showToast('Đã lấy số bìa: ' + redBookNum);
        } else {
            // Nếu không tìm thấy số bìa trong QR thì điền tạm chữ này
            nameInput.value = "Bìa đỏ (Chưa rõ số)";
            showToast('Đã quét (Không tìm thấy số bìa)');
        }
    }
}
// Stubbed functions to override removed OCR utilities (in case leftover calls exist)
function parseRedBookInfo(text) { return {}; }
function renderRedBookInfo(info) { return ''; }
