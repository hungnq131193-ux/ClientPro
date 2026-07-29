    // --- LOGIC UPLOAD DRIVE & CẤU HÌNH ---

function toggleDashboardDriveConfig() {
    const panel = getEl('dashboard-drive-config');
    const input = getEl('dashboard-drive-url');
    if (!panel) {
        if (input) input.focus();
        return;
    }
    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen);
    panel.setAttribute('aria-hidden', willOpen ? 'false' : 'true');
    if (willOpen) {
        // Prefill token tại thời điểm mở panel (app đã mở khóa nên đọc được token niêm phong).
        const tokenInput = getEl('dashboard-drive-token');
        if (tokenInput && !tokenInput.value) {
            const savedToken = getUserToken();
            if (savedToken) tokenInput.value = savedToken;
        }
        if (input) setTimeout(() => input.focus(), 80);
    }
}
// Đưa người dùng về Dashboard rồi mở panel "Cài đặt Google Drive".
// GAS cá nhân nay cấu hình ở Dashboard (#dashboard-drive-config), KHÔNG còn trong menu Cài đặt —
// nên các confirm "Chưa cấu hình Drive" phải hướng tới đây thay vì gọi toggleMenu().
function openDashboardDriveConfigGuide() {
    // 1) Đóng menu Cài đặt nếu đang mở.
    if (typeof _closeMenuIfOpen === 'function') _closeMenuIfOpen();

    // 2) Đóng các màn đang chồng lên Dashboard (folder / danh sách KH) để lộ nút cấu hình.
    try {
        const folderScreen = getEl('screen-folder');
        if (folderScreen && !folderScreen.classList.contains('hidden')
            && !folderScreen.classList.contains('translate-x-full')
            && typeof closeFolder === 'function') {
            closeFolder();
        }
    } catch (e) { }
    try {
        const listScreen = getEl('screen-customer-list');
        if (listScreen && !listScreen.classList.contains('hidden')
            && !listScreen.classList.contains('translate-x-full')
            && typeof closeCustomerList === 'function') {
            closeCustomerList();
        }
    } catch (e) { }

    // 3) Mở panel cấu hình — CHỈ toggle khi đang ẩn để không vô tình đóng panel đã mở.
    //    Chờ animation đóng màn (slideScreenOut ~300-360ms) trước khi mở & cuộn tới.
    setTimeout(() => {
        const panel = getEl('dashboard-drive-config');
        if (panel && panel.classList.contains('hidden') && typeof toggleDashboardDriveConfig === 'function') {
            toggleDashboardDriveConfig();
        }
        try {
            if (panel && typeof panel.scrollIntoView === 'function') {
                panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } catch (e) { }
    }, 380);
}

// Mã bảo mật (Access Token) cho Script Drive cá nhân (UserAPI).
// Server UserAPI bắt buộc token; app gửi kèm mỗi request (trong body, KHÔNG qua query URL).
//
// BẢO MẬT: token được "niêm phong" trong localStorage bằng masterKey (AES qua
// encryptText/decryptText của 02_security.js) dưới dạng:
//     'sealed.v1:' + <ciphertext>
// - Chưa mở khóa app (chưa có masterKey) -> getUserToken() trả '' (server sẽ từ chối,
//   không lộ token khi localStorage bị đọc trộm qua XSS lúc app còn khóa).
// - Token cũ dạng plaintext: tự niêm phong lại ở lần đọc đầu tiên sau khi mở khóa
//   (lazy migration, không bắt user nhập lại).
const USER_TOKEN_SEALED_PREFIX = 'sealed.v1:';

function _userTokenStorageKey() {
    return (typeof USER_TOKEN_KEY !== 'undefined') ? USER_TOKEN_KEY : 'app_user_script_token';
}

function _hasMasterKeyForToken() {
    return typeof masterKey !== 'undefined' && !!masterKey;
}

/** Niêm phong token bằng masterKey (ASYNC — AES-GCM). Không có masterKey thì trả plaintext như cũ. */
async function sealUserToken(token) {
    const t = String(token || '').trim();
    if (!t || !_hasMasterKeyForToken() || typeof encryptText !== 'function') return t;
    try {
        const ct = await encryptText(t);
        // encryptText trả lại nguyên bản khi mã hóa thất bại -> chỉ dán prefix khi thực sự đổi.
        if (typeof ct === 'string' && ct && ct !== t) return USER_TOKEN_SEALED_PREFIX + ct;
    } catch (e) { }
    return t;
}

function getUserToken() {
    const key = _userTokenStorageKey();
    const raw = (localStorage.getItem(key) || '').trim();
    if (!raw) return '';

    if (raw.startsWith(USER_TOKEN_SEALED_PREFIX)) {
        if (!_hasMasterKeyForToken() || typeof decryptText !== 'function') return '';
        const ct = raw.slice(USER_TOKEN_SEALED_PREFIX.length);
        try {
            const pt = decryptText(ct);
            // decryptText trả lại input khi giải mã thất bại (sai khóa) -> coi như không có token.
            if (typeof pt === 'string' && pt && pt !== ct) return pt.trim();
        } catch (e) { }
        return '';
    }

    // Token cũ dạng plaintext: niêm phong lại NỀN (không chặn trả về) khi masterKey sẵn sàng.
    // sealUserToken nay async (AES-GCM) nên chạy fire-and-forget, vẫn trả plaintext ngay.
    if (_hasMasterKeyForToken()) {
        (async () => {
            try {
                const sealed = await sealUserToken(raw);
                if (sealed !== raw) localStorage.setItem(key, sealed);
            } catch (e) { }
        })();
    }
    return raw;
}

// Trạng thái inline trong panel cấu hình Drive (chỉ trình bày — không đổi
// cách lưu, token hay bất kỳ payload Drive/GAS nào).
function _setDriveConfigStatus(msg, kind) {
    const el = getEl('dashboard-drive-config-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden', 'is-success', 'is-error');
    el.classList.add(kind === 'error' ? 'is-error' : 'is-success');
}

async function saveScriptUrl() {
    const input = getEl('dashboard-drive-url');
    const url = input ? input.value.trim() : '';
    if (!url.startsWith('https://script.google.com/')) {
        _setDriveConfigStatus('Link kết nối chưa đúng. Link phải bắt đầu bằng https://script.google.com/', 'error');
        ErrorHandler.showError('VALIDATION', "Link kết nối Drive không đúng định dạng. Link phải bắt đầu bằng https://script.google.com/");
        return;
    }
    const tokenInput = getEl('dashboard-drive-token');
    const token = tokenInput ? tokenInput.value.trim() : getUserToken();
    if (!token) {
        _setDriveConfigStatus('Vui lòng nhập mã bảo mật của link kết nối Drive.', 'error');
        ErrorHandler.showWarning("Vui lòng nhập Mã bảo mật của link kết nối Drive!");
        if (tokenInput) tokenInput.focus();
        return;
    }
    // Lưu link Script cá nhân và token (niêm phong AES-GCM bằng masterKey nếu app đã mở khóa)
    const saveBtn = getEl('btn-save-drive-config');
    try { LoadingManager.showButtonLoading(saveBtn, 'Đang lưu…'); } catch (e) {}
    try {
        localStorage.setItem(USER_SCRIPT_KEY, url);
        localStorage.setItem(_userTokenStorageKey(), await sealUserToken(token));
        _setDriveConfigStatus('Đã lưu kết nối Google Drive cá nhân.', 'success');
        ErrorHandler.showSuccess("Đã lưu kết nối Drive cá nhân");
    } catch (e) {
        _setDriveConfigStatus('Không lưu được kết nối. Vui lòng thử lại.', 'error');
        ErrorHandler.showError('STORAGE', 'Không lưu được kết nối Drive.', e);
    } finally {
        try { LoadingManager.hideButtonLoading(saveBtn); } catch (e) {}
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const savedUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if(savedUrl) {
        const input = getEl('dashboard-drive-url');
        if (input) input.value = savedUrl;
    }
    // KHÔNG prefill token ở đây: lúc DOMContentLoaded app còn khóa (masterKey chưa có)
    // nên token niêm phong chưa đọc được. Prefill khi mở panel (toggleDashboardDriveConfig).
});

// =============================
// Helpers (decrypt display fields, keep backward compatibility)
// =============================
// Tên hàm giữ nguyên ("CryptoJS") để tránh đổi diện rộng, nhưng nay nhận diện CẢ 2 dạng
// ciphertext: legacy CryptoJS ("U2FsdGVkX1...") và AES-GCM mới ("cpg1:..."). Trước đây chỉ
// check tiền tố legacy -> field asset.name/driveLink đã migrate sang "cpg1:" bị coi nhầm là
// plaintext, khiến chuỗi mã hóa lọt vào folderName Drive / hiển thị UI (xem _looksEncrypted
// trong 05_customers.js, cùng bug với renderAssets() ở 06_assets.js).
function _isCryptoJSCiphertext(s) {
    if (typeof _looksEncrypted === 'function') return _looksEncrypted(s);
    return typeof s === 'string' && (s.startsWith('U2FsdGVkX1') || s.startsWith('cpg1:'));
}

function _safeDecryptMaybe(s) {
    if (s == null) return '';
    const str = String(s);
    try {
        if (typeof decryptText === 'function') {
            const out = decryptText(str);
            // decryptText() fail-open: cache-miss trả nguyên ciphertext — từ chối nếu vẫn mã hóa.
            if (typeof out === 'string' && out.length > 0 && !_isCryptoJSCiphertext(out)) return out;
        }
    } catch (e) {}
    // Nếu đầu vào đã là plaintext (không phải ciphertext) thì trả nguyên.
    if (!_isCryptoJSCiphertext(str)) return str;
    return '';
}

function _displayText(s) {
    if (typeof _displayPlain === 'function') return _displayPlain(s, '');
    const out = _safeDecryptMaybe(s);
    return (out && out !== 'undefined' && out !== 'null') ? out : '';
}

function _normalizeDriveUrl(url) {
    if (!url) return '';
    const str = String(url);
    if (_isCryptoJSCiphertext(str)) {
        // Old data sometimes stored encrypted driveLink. Only render if we can decrypt to a real URL.
        const dec = _safeDecryptMaybe(str);
        if (dec && ! _isCryptoJSCiphertext(dec) && /^https?:\/\//i.test(dec)) return dec;
        return '';
    }
    return str;
}

// Legacy duplicate uploadToGoogleDrive implementation removed; canonical function is defined once below.

// =============================================================================
// KẾT QUẢ UPLOAD DRIVE — 4 phán quyết, KHÔNG gộp "không biết" vào "thất bại"
// -----------------------------------------------------------------------------
// GAS (handleUploadImages_ trong gas/UserDriveAPI.gs) tạo file TRƯỚC khi response
// về tới máy. Mọi lỗi xảy ra SAU thời điểm đó — fetch reject vì mạng rớt giữa
// chừng trên 4G, body rỗng, GAS trả HTML (trang đăng nhập / deployment sai) —
// không nói lên điều gì về việc ảnh đã lên Drive hay chưa. Báo "thất bại" ở đó
// là FALSE-NEGATIVE: người dùng thấy file trên Drive nhưng app nói hỏng, rồi tải
// lại và tạo bản trùng.
//
//   OK          — mọi ảnh đã lên Drive, đối chiếu được từng ảnh.
//   PARTIAL     — một phần lên được; `succeeded` là danh sách đối chiếu được.
//   UNCONFIRMED — KHÔNG biết: có thể đã lên hết. Giữ nguyên ảnh gốc, gợi ý
//                 "Tìm kết nối cũ". Tuyệt đối không xóa ảnh nào.
//   REJECTED    — server nói rõ là hỏng (Unauthorized, thiếu folderName, mọi
//                 entry đều .error). Đây mới là "thất bại" thật.
//
// Chỉ xóa ảnh gốc khi chắc chắn có files[i].id ứng với đúng ảnh đó (OK/PARTIAL).
// =============================================================================
const DRIVE_UPLOAD_OK = 'OK';
const DRIVE_UPLOAD_PARTIAL = 'PARTIAL';
const DRIVE_UPLOAD_UNCONFIRMED = 'UNCONFIRMED';
const DRIVE_UPLOAD_REJECTED = 'REJECTED';

/**
 * Giải mã + kiểm chứng ảnh TRƯỚC khi gửi lên Drive.
 * decryptImageData fail-open (trả nguyên ciphertext khi mất masterKey) nên nếu
 * app tự khóa giữa chừng, payload sẽ chứa ciphertext: GAS vẫn tạo folder rồi
 * báo lỗi từng ảnh — người dùng thấy folder trên Drive mà app nói thất bại.
 * Xác nhận từng ảnh là plaintext và session còn mở khóa; sai một ảnh là DỪNG,
 * không gửi request nào.
 * @returns {Promise<Array|null>} null = không đủ điều kiện gửi.
 */
async function _resolveImagesForUpload(imagesToUpload, namePrefix) {
    const stamp = Date.now();
    const resolved = [];
    for (let i = 0; i < imagesToUpload.length; i++) {
        const img = imagesToUpload[i];
        const data = (typeof decryptImageData === 'function')
            ? await decryptImageData(img.data)
            : img.data;
        // Re-check SAU await: auto-lock có thể rơi vào đúng khe này.
        if (typeof isAppUnlocked === 'function' && !isAppUnlocked()) return null;
        if (typeof data !== 'string' || !data) return null;
        if (typeof _looksEncrypted === 'function' && _looksEncrypted(data)) return null;
        resolved.push({ name: `${namePrefix}_${stamp}_${i}.jpg`, data });
    }
    return resolved;
}

/**
 * POST payload upload và đọc body. KHÔNG dùng response.json() trần: mọi lỗi
 * mạng/parse phải phân biệt được với "server trả lời là hỏng".
 * @returns {Promise<{result?: object, unconfirmed?: true, reason?: string, error?: Error}>}
 */
async function _postDriveUpload(scriptUrl, payload) {
    let response;
    try {
        response = await fetch(scriptUrl, { method: 'POST', body: JSON.stringify(payload) });
    } catch (err) {
        // Request có thể đã tới GAS và ảnh đã nằm trên Drive.
        return { unconfirmed: true, reason: 'network', error: err };
    }

    let text = '';
    try {
        text = await response.text();
    } catch (err) {
        return { unconfirmed: true, reason: 'body', error: err };
    }

    let result = null;
    try {
        result = JSON.parse(text);
    } catch (err) {
        // Body rỗng hoặc HTML (đăng nhập Google / lỗi triển khai GAS).
        return { unconfirmed: true, reason: response.ok ? 'parse' : 'http', error: err };
    }
    if (!result || typeof result !== 'object') {
        return { unconfirmed: true, reason: 'parse' };
    }
    return { result };
}

/**
 * Đọc response JSON của GAS thành phán quyết.
 * Server v4 trả status 'success' | 'partial' | 'error' + files[] đúng 1 entry /
 * 1 ảnh gửi lên (đúng thứ tự, entry lỗi có .error thay vì .id); server cũ (v3)
 * luôn 'success' và không kèm files[].
 */
function _classifyUploadResult(result, imagesToUpload) {
    const total = Array.isArray(imagesToUpload) ? imagesToUpload.length : 0;
    const base = {
        succeeded: [],
        failedCount: total,
        uploadedCount: null,
        url: '',
        message: '',
    };
    if (!result || typeof result !== 'object') {
        return Object.assign({}, base, { verdict: DRIVE_UPLOAD_UNCONFIRMED });
    }

    base.url = String(result.url || result.folderUrl || '');
    base.message = (typeof result.message === 'string') ? result.message : '';
    const status = String(result.status || '');
    const files = Array.isArray(result.files) ? result.files : null;
    const isOkEntry = (f) => !!(f && f.id && !f.error);

    // (a) files[] khớp số lượng -> đối chiếu theo index, nguồn tin cậy nhất.
    if (files && total > 0 && files.length === total) {
        const succeeded = imagesToUpload.filter((img, i) => isOkEntry(files[i]));
        if (succeeded.length === total) {
            return Object.assign({}, base, {
                verdict: DRIVE_UPLOAD_OK, succeeded, failedCount: 0, uploadedCount: total,
            });
        }
        if (succeeded.length > 0) {
            return Object.assign({}, base, {
                verdict: DRIVE_UPLOAD_PARTIAL,
                succeeded,
                failedCount: total - succeeded.length,
                uploadedCount: succeeded.length,
            });
        }
        // Không ảnh nào có id. Chỉ là thất bại thật khi server nói rõ ràng:
        // hoặc TỪNG entry mang .error, hoặc status top-level là 'error'. Một
        // deployment GAS cũ/lạ trả entry không có cả .id lẫn .error thì đây vẫn
        // là "không biết" — báo thất bại ở đó chính là false-negative cần tránh.
        const everyEntryErrored = files.every((f) => f && f.error);
        if (everyEntryErrored || status === 'error') {
            return Object.assign({}, base, { verdict: DRIVE_UPLOAD_REJECTED, uploadedCount: 0 });
        }
        return Object.assign({}, base, { verdict: DRIVE_UPLOAD_UNCONFIRMED, uploadedCount: 0 });
    }

    // (b) files[] lệch số lượng nhưng có entry mang id: đã có file trên Drive,
    //     chỉ là không map được về ảnh nào trong máy -> KHÔNG xóa ảnh gốc nào.
    const okEntries = files ? files.filter(isOkEntry) : [];
    if (okEntries.length > 0) {
        return Object.assign({}, base, {
            verdict: DRIVE_UPLOAD_UNCONFIRMED, uploadedCount: okEntries.length,
        });
    }

    // (c) Server v3 cũ: 'success' trần, không files[], không failed -> tin như trước.
    if (status === 'success' && !files && !(Number(result.failed) > 0)) {
        return Object.assign({}, base, {
            verdict: DRIVE_UPLOAD_OK,
            succeeded: imagesToUpload.slice(),
            failedCount: 0,
            uploadedCount: total,
        });
    }

    // (d) Server nói rõ 'error' và không entry nào có id -> từ chối thật.
    if (status === 'error') {
        return Object.assign({}, base, { verdict: DRIVE_UPLOAD_REJECTED, uploadedCount: 0 });
    }

    // (e) Còn lại (status lạ, 'partial' rỗng, files[] rỗng…): không đủ căn cứ.
    return Object.assign({}, base, { verdict: DRIVE_UPLOAD_UNCONFIRMED });
}

/** POST + phân loại. KHÔNG bao giờ throw — mọi lỗi thành một phán quyết. */
async function _runDriveImageUpload(scriptUrl, payload, imagesToUpload) {
    const posted = await _postDriveUpload(scriptUrl, payload);
    if (posted.unconfirmed) {
        return {
            verdict: DRIVE_UPLOAD_UNCONFIRMED,
            succeeded: [],
            failedCount: Array.isArray(imagesToUpload) ? imagesToUpload.length : 0,
            uploadedCount: null,
            url: '',
            message: '',
            transport: posted.reason,
            error: posted.error || null,
        };
    }
    return _classifyUploadResult(posted.result, imagesToUpload);
}

// Ghi driveLink: RAM chỉ được mang giá trị mới khi DB đã commit. url rỗng thì
// KHÔNG đụng vào link cũ — gán đè sẽ xóa mất link đang hiển thị mà chẳng lưu
// được gì. Hai hàm dưới giữ cho hai đường (hồ sơ / tài sản) cùng một thứ tự.
async function _persistCustomerDriveLink(url) {
    if (!url) return false;
    const ok = await new Promise((resolve) => {
        persistCurrentCustomer((rec) => { rec.driveLink = url; }, resolve);
    });
    if (ok) currentCustomerData.driveLink = url;
    return ok;
}

async function _persistAssetDriveLink(assetIndex, url) {
    if (!url) return false;
    // persistCurrentCustomer chép `rec.assets = currentCustomerData.assets` nên
    // buộc phải sửa RAM trước; ghi hỏng thì trả nguyên giá trị cũ.
    const prev = currentCustomerData.assets[assetIndex].driveLink;
    currentCustomerData.assets[assetIndex].driveLink = url;
    const ok = await new Promise((resolve) => {
        persistCurrentCustomer((rec) => { rec.assets = currentCustomerData.assets; }, resolve);
    });
    if (!ok) currentCustomerData.assets[assetIndex].driveLink = prev;
    return ok;
}

/** Thông báo cho phán quyết UNCONFIRMED: không khẳng định hỏng, chỉ ra việc cần làm. */
function _unconfirmedUploadMessage(outcome, total) {
    const n = (outcome && Number.isFinite(outcome.uploadedCount)) ? outcome.uploadedCount : null;
    const head = (n !== null && n > 0)
        ? `Drive báo đã nhận ${n}/${total} ảnh nhưng ứng dụng không đối chiếu được từng ảnh.`
        : 'Chưa nhận được xác nhận từ Drive (mạng chập chờn hoặc link kết nối trả về dữ liệu lạ). Ảnh CÓ THỂ đã được tải lên.';
    return `${head}\nẢnh gốc trong máy được giữ nguyên. Hãy bấm "Tìm kết nối cũ" để kiểm tra thư mục trên Drive trước khi tải lại (tránh tạo bản trùng).`;
}

// Xóa CHỈ những ảnh gốc đã upload thành công (không đụng ảnh lỗi), rồi gọi onDone().
function _deleteSucceededUploadsOnly(succeededImgs, onDone) {
    const txDel = db.transaction(['images'], 'readwrite');
    succeededImgs.forEach(img => txDel.objectStore('images').delete(img.id));
    txDel.oncomplete = () => { if (typeof onDone === 'function') onDone(); };
    // onabort bắt buộc: tx có thể abort KHÔNG kèm request error (quota, versionchange) —
    // khi đó onerror không bắn, ảnh gốc còn nguyên mà không ai báo. Settled guard vì
    // request error bubble lên tx.onerror rồi tx abort bắn tiếp onabort (2 sự kiện/1 thất bại).
    let delSettled = false;
    const delFail = () => {
        if (delSettled) return;
        delSettled = true;
        ErrorHandler.showError('STORAGE', 'Không xóa được ảnh gốc trong máy.', txDel.error);
    };
    txDel.onerror = delFail;
    txDel.onabort = delFail;
}

// UI thường trú sau upload phải nói đúng mức chắc chắn: 'done' (mặc định) chỉ
// dùng khi đã đối chiếu được từng ảnh; 'unconfirmed' cho phán quyết UNCONFIRMED
// — có thư mục để mở, nhưng KHÔNG được khẳng định "đã tải ảnh lên". Toast cảnh
// báo biến mất sau vài giây, dòng chú thích này thì ở lại.
const DRIVE_STATUS_UNCONFIRMED = 'unconfirmed';

// 3. Hàm hiển thị nút mở Drive
function renderDriveStatus(url, state) {
    const area = getEl('drive-status-area');
    const btnUp = getEl('btn-upload-drive');

    if (!area) return;

    const safeUrl = _normalizeDriveUrl(url).trim();
    const hasSafeDriveUrl = typeof isSafeDriveUrl === 'function' && isSafeDriveUrl(safeUrl);
    const safeHref = hasSafeDriveUrl ? escapeHTML(safeUrl) : '';
    const unconfirmed = state === DRIVE_STATUS_UNCONFIRMED;
    if (hasSafeDriveUrl) {
        // ĐÃ CÓ LINK → hiện nút Mở Drive
        area.classList.remove('hidden');
        area.innerHTML = `
      <a href="${safeHref}" target="_blank" rel="noopener noreferrer"
         class="w-full py-3 ${unconfirmed ? 'bg-amber-600 border-amber-400/30' : 'bg-emerald-600 border-emerald-400/30'}
                text-white rounded-xl font-bold
                flex items-center justify-center gap-2 shadow-lg mb-1
                animate-fade-in border">
        <i data-lucide="external-link" class="w-5 h-5"></i> Mở thư mục ảnh
      </a>
      <p class="text-[10px] text-center italic mb-2 ${unconfirmed ? 'text-amber-300/80' : 'text-emerald-400/70'}">
        ${unconfirmed ? 'Chưa xác nhận đủ ảnh — mở thư mục để kiểm tra' : 'Đã tải ảnh lên Drive'}
      </p>
    `;

        if (btnUp) btnUp.classList.remove('hidden'); // vẫn cho phép upload thêm
    } else {
        // CHƯA CÓ LINK → hiện nút tìm lại + nút upload
        area.classList.remove('hidden');
        area.innerHTML = `
      <button data-action="reconnectDriveFolder"
              class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600
                     rounded-lg text-xs font-medium text-slate-300
                     flex items-center justify-center gap-2 hover:bg-slate-700 transition">
        <i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ
      </button>
    `;
        if (btnUp) btnUp.classList.remove('hidden');
    }
    
    if (window.lucide) lucide.createIcons();
}

// --- LOGIC UPLOAD DRIVE CHO TÀI SẢN (TSBĐ) ---

async function uploadAssetToDrive() {
    // Lấy link Script cá nhân
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (await ErrorHandler.confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Vào màn hình chính → Cài đặt Google Drive để nhập link kết nối Drive của bạn.", { title: "Chưa cấu hình Drive", confirmText: "Cài đặt Drive" })) {
            openDashboardDriveConfigGuide();
        }
        return;
    }
    const scriptUrl = userUrl;

    if (!currentCustomerData || !currentAssetId) return;

    // Tìm xem đang thao tác với Tài sản nào trong mảng assets
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    if (assetIndex === -1) return;
    const currentAsset = currentCustomerData.assets[assetIndex];

    LoadingManager.showGlobal("Đang lấy ảnh tài sản…");

    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId'); // Lấy tất cả ảnh của khách này trước

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        
        // LỌC QUAN TRỌNG: Chỉ lấy ảnh có assetId TRÙNG VỚI assetId hiện tại
        let imagesToUpload = allImages.filter(img => img.assetId === currentAssetId);

        if (imagesToUpload.length === 0) {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showWarning("Tài sản này chưa có ảnh nào!");
            return;
        }

        // v1.0.0: asset.name mã hóa at rest — decrypt async THẬT trước khi dựng
        // folderName; không giải mã được thì DỪNG, không đưa ciphertext/rỗng lên Drive.
        const assetNamePlain = (typeof _displayPlainAsync === 'function')
            ? await _displayPlainAsync(currentAsset.name, '')
            : _displayText(currentAsset.name);
        const custNamePlain = (typeof _displayPlainAsync === 'function')
            ? await _displayPlainAsync(currentCustomerData.name, '')
            : _displayText(currentCustomerData.name);
        if (!assetNamePlain || !custNamePlain) {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showWarning('Không thể đọc tên tài sản/khách hàng (dữ liệu chưa giải mã được). Vui lòng thử lại.');
            return;
        }
        if (!(await ErrorHandler.confirm(`Tải lên ${imagesToUpload.length} ảnh của tài sản "${assetNamePlain}" lên Drive?`, { title: "Tải ảnh lên Drive", confirmText: "Tải lên" }))) {
            LoadingManager.hideGlobal(true);
            return;
        }

        LoadingManager.showGlobal("Đang tải ảnh lên Drive…");

        // Đặt tên Folder: [Tên Khách] - [Tên Tài Sản]
        // Ví dụ: Nguyen Van A - Nhà Đất 50m2
        const folderName = `${custNamePlain} - Tài sản: ${assetNamePlain}`;

        // Giải mã + kiểm chứng plaintext TRƯỚC khi gửi: app tự khóa giữa chừng thì
        // dừng hẳn, không để GAS tạo folder rồi báo lỗi từng ảnh.
        const resolvedImages = await _resolveImagesForUpload(imagesToUpload, 'asset_img');
        if (!resolvedImages) {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showWarning('Không giải mã được ảnh để tải lên (ứng dụng có thể đã tự khóa). Vui lòng mở khóa và thử lại — chưa có ảnh nào được gửi đi.');
            return;
        }

        const payload = {
            token: getUserToken(),
            folderName: folderName,
            images: resolvedImages,
        };

        // Cờ này quyết định cách diễn giải lỗi ở catch: sau khi Drive đã nhận ảnh,
        // một lỗi ghi DB / render KHÔNG được báo thành "tải ảnh thất bại".
        let reachedDrive = false;
        try {
            const outcome = await _runDriveImageUpload(scriptUrl, payload, imagesToUpload);

            // Server nói rõ là hỏng -> đây mới là thất bại thật.
            if (outcome.verdict === DRIVE_UPLOAD_REJECTED) {
                LoadingManager.hideGlobal(true);
                ErrorHandler.showError('BACKUP',
                    outcome.message
                        ? `Tải ảnh lên Drive thất bại: ${outcome.message}`
                        : 'Tải ảnh lên Drive thất bại. Vui lòng kiểm tra kết nối và link kết nối Drive.',
                    outcome.error || null);
                return;
            }

            // Không xác nhận được: KHÔNG khẳng định hỏng, KHÔNG xóa ảnh gốc.
            if (outcome.verdict === DRIVE_UPLOAD_UNCONFIRMED) {
                reachedDrive = true;
                if (await _persistAssetDriveLink(assetIndex, outcome.url)) {
                    // Có thư mục để mở, nhưng UI KHÔNG được nói "đã tải xong".
                    renderAssetDriveStatus(outcome.url, DRIVE_STATUS_UNCONFIRMED);
                }
                LoadingManager.hideGlobal(true);
                ErrorHandler.showWarning(_unconfirmedUploadMessage(outcome, imagesToUpload.length));
                return;
            }

            // OK / PARTIAL: có files[i].id đối chiếu được từng ảnh.
            reachedDrive = true;
            const succeededImgs = outcome.succeeded;

            // 1+2. Lưu Link vào đúng đối tượng Asset rồi ghi Database (không put()
            //    nguyên currentCustomerData vì name/phone/cccd trên object đó đã bị
            //    giải mã trong openFolder). Await kết quả ghi: KHÔNG báo thành công /
            //    hỏi xóa ảnh gốc khi ghi link thất bại (mirror pattern _doSaveAsset
            //    ở 06_assets.js).
            const ok = await _persistAssetDriveLink(assetIndex, outcome.url);

            LoadingManager.hideGlobal(true);

            if (!ok) {
                ErrorHandler.showWarning('Ảnh đã lên Drive nhưng CHƯA lưu được link vào hồ sơ. Hãy dùng "Tìm kết nối cũ" sau.');
                return;
            }

            // 3. Cập nhật giao diện
            renderAssetDriveStatus(outcome.url);
            if (outcome.failedCount > 0) {
                ErrorHandler.showWarning(`Đã tải ${succeededImgs.length}/${imagesToUpload.length} ảnh tài sản lên Drive — ${outcome.failedCount} ảnh lỗi vẫn còn trong máy, hãy thử tải lại sau.`);
            } else {
                ErrorHandler.showSuccess("Đã tải ảnh tài sản lên Drive");
            }

            // 4. Hỏi xóa ảnh — CHỈ xóa ảnh đã lên Drive thành công
            const msgDel = outcome.failedCount > 0
                ? `Xóa ${succeededImgs.length} ảnh đã tải lên Drive khỏi máy để giảm dung lượng?\n(${outcome.failedCount} ảnh lỗi sẽ được giữ nguyên)`
                : "Đã tải ảnh tài sản lên Drive.\n\nXóa ảnh gốc trong máy để giảm dung lượng?";
            if (await ErrorHandler.confirm(msgDel, { title: "Dọn dẹp bộ nhớ", confirmText: "Xóa ảnh gốc" })) {
                _deleteSucceededUploadsOnly(succeededImgs, () => {
                    loadAssetImages(currentAssetId); // Load lại lưới ảnh
                    ErrorHandler.showSuccess("Đã xóa ảnh gốc của tài sản");
                });
            }
        } catch (err) {
            LoadingManager.hideGlobal(true);
            if (reachedDrive) {
                ErrorHandler.logError('uploadAssetToDrive: lỗi SAU khi Drive đã nhận ảnh', err);
                ErrorHandler.showWarning('Ảnh đã lên Drive nhưng ứng dụng gặp lỗi khi cập nhật hồ sơ. Ảnh gốc trong máy được giữ nguyên — hãy dùng "Tìm kết nối cũ".');
            } else {
                ErrorHandler.showError('BACKUP', "Tải ảnh lên Drive thất bại. Vui lòng kiểm tra kết nối và link kết nối Drive.", err);
            }
        }
    };
}

// 1. Cập nhật giao diện: Thêm nút Tìm kết nối cũ
function renderAssetDriveStatus(url, state) {
    const area = getEl('asset-drive-status-area');
    const btnUp = getEl('btn-asset-upload');
    if (!area) return;
    area.classList.remove('hidden');

    const safeUrl = _normalizeDriveUrl(url).trim();
    const hasSafeDriveUrl = typeof isSafeDriveUrl === 'function' && isSafeDriveUrl(safeUrl);
    const safeHref = hasSafeDriveUrl ? escapeHTML(safeUrl) : '';
    const unconfirmed = state === DRIVE_STATUS_UNCONFIRMED;
    if (hasSafeDriveUrl) {
        // Đã có link -> Hiện nút mở (xem chú thích ở renderDriveStatus về 'unconfirmed')
        area.innerHTML = `
            <a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="w-full py-3 ${unconfirmed ? 'bg-amber-600 border-amber-400/30' : 'bg-teal-600 border-teal-400/30'} text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg mb-1 animate-fade-in border">
                <i data-lucide="external-link" class="w-5 h-5"></i> Xem thư mục tài sản
            </a>
            ${unconfirmed ? '<p class="text-[10px] text-center italic mb-2 text-amber-300/80">Chưa xác nhận đủ ảnh — mở thư mục để kiểm tra</p>' : ''}`;
        if (btnUp) btnUp.classList.remove('hidden');
    } else {
        // Chưa có link -> Hiện nút TÌM LẠI
        area.innerHTML = `
            <button data-action="reconnectAssetDriveFolder" class="w-full py-2 mb-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs font-medium text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-700 transition">
                <i data-lucide="search" class="w-4 h-4"></i> Tìm kết nối cũ
            </button>`;
        if (btnUp) btnUp.classList.remove('hidden');
    }
    if(window.lucide) lucide.createIcons();
}

// 2. Logic tìm kiếm (Sử dụng Script cá nhân USER_SCRIPT_KEY)
async function reconnectAssetDriveFolder() {
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (await ErrorHandler.confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Vào màn hình chính → Cài đặt Google Drive để nhập link kết nối Drive của bạn.", { title: "Chưa cấu hình Drive", confirmText: "Cài đặt Drive" })) openDashboardDriveConfigGuide();
        return;
    }

    if (!currentCustomerData || !currentAssetId) return;
    const assetIndex = currentCustomerData.assets.findIndex(a => a.id === currentAssetId);
    if (assetIndex === -1) return;

    LoadingManager.showGlobal("Đang tìm thư mục tài sản…");
    
    // v1.0.0: asset.name mã hóa at rest — folderName phải được dựng từ plaintext
    // decrypt THẬT (async), tuyệt đối không đưa ciphertext vào tên folder Drive.
    const custNamePlain = (typeof _displayPlainAsync === 'function')
        ? await _displayPlainAsync(currentCustomerData.name, '')
        : _displayText(currentCustomerData.name);

    let assetNamePlain = '';
    // 1) Ưu tiên lấy từ UI gallery (đã decrypt để hiển thị)
    try {
        const uiName = (getEl && getEl('gallery-asset-name') ? getEl('gallery-asset-name').textContent : '') || '';
        const uiTrim = String(uiName).trim();
        if (uiTrim && uiTrim !== 'Đang tải...' && !_isCryptoJSCiphertext(uiTrim)) assetNamePlain = uiTrim;
    } catch (e) {}
    // 2) Fallback: decrypt async THẬT từ data hiện tại (không dựa cache nóng)
    if (!assetNamePlain) {
        assetNamePlain = (typeof _displayPlainAsync === 'function')
            ? await _displayPlainAsync(currentCustomerData.assets[assetIndex].name, '')
            : _displayText(currentCustomerData.assets[assetIndex].name);
    }
    // 3) Không giải mã được -> KHÔNG dựng folderName sai; báo rõ và dừng.
    if (!custNamePlain || !assetNamePlain || _isCryptoJSCiphertext(assetNamePlain) || _isCryptoJSCiphertext(custNamePlain)) {
        LoadingManager.hideGlobal(true);
        ErrorHandler.showWarning('Không thể đọc tên tài sản/khách hàng (dữ liệu chưa giải mã được). Vui lòng thử lại sau khi mở khóa.');
        return;
    }

    const folderName = `${custNamePlain} - Tài sản: ${assetNamePlain}`;
    // (v1.0.0: bỏ auto-migrate ghi plaintext asset.name ngược vào DB — name giữ mã hóa at rest.)
    // Đổi prefix hiển thị folder Drive từ "TSBĐ:" sang "Tài sản:" (chuẩn hóa từ ngữ).
    // Folder cũ đã tạo trước đây mang tên "... - TSBĐ: ..." nên khi tìm kết nối cũ phải
    // thử CẢ HAI pattern (mới trước, legacy sau) — nếu không, tài sản có folder cũ sẽ
    // không bao giờ khớp lại được.
    const candidateFolderNames = [
        folderName,
        `${custNamePlain} - TSBĐ: ${assetNamePlain}`,
    ];

    try {
        let result = null;
        for (const candidate of candidateFolderNames) {
            const response = await fetch(userUrl, {
                method: "POST",
                body: JSON.stringify({ action: 'search', folderName: candidate, token: getUserToken() })
            });
            const r = await response.json();
            if (r && r.status === 'found') { result = r; break; }
            result = r;
        }

        if (result && result.status === 'found') {
            // Store as plaintext going forward (older records may be encrypted; rendering handles both).
            const plainUrl = result.url;
            
            const tx = db.transaction(['customers'], 'readwrite');
            const store = tx.objectStore('customers');
            store.get(currentCustomerData.id).onsuccess = (e) => {
                let dbRecord = e.target.result;
                if (dbRecord && dbRecord.assets && dbRecord.assets[assetIndex]) {
                    dbRecord.assets[assetIndex].driveLink = plainUrl;
                    store.put(dbRecord);
                }
            };
            tx.oncomplete = () => {
                currentCustomerData.assets[assetIndex].driveLink = plainUrl; // Cập nhật hiển thị
                LoadingManager.hideGlobal(true);
                renderAssetDriveStatus(plainUrl);
                ErrorHandler.showSuccess("Đã kết nối lại thư mục tài sản");
            };
            // Transaction lỗi: phải tắt loading (nếu không overlay treo vĩnh viễn) + báo lỗi.
            // onabort bắt buộc: tx có thể abort KHÔNG kèm request error (quota, versionchange)
            // — khi đó onerror không bắn và loader "Đang tìm TSBĐ..." kẹt tới khi reload.
            // Settled guard: error bubble rồi abort bắn tiếp — chỉ báo lỗi một lần.
            let txSettled = false;
            const txFail = (e) => {
                if (txSettled) return;
                txSettled = true;
                LoadingManager.hideGlobal(true);
                ErrorHandler.showError('STORAGE', 'Tìm thấy thư mục nhưng CHƯA lưu được link vào hồ sơ. Vui lòng thử lại.', e);
            };
            tx.onerror = txFail;
            tx.onabort = txFail;
        } else {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showWarning("Không tìm thấy thư mục: " + folderName);
        }
    } catch (err) {
        LoadingManager.hideGlobal(true);
        ErrorHandler.showError('NETWORK', "Không kết nối được tới Drive. Vui lòng thử lại.", err);
    }
}
// --- TÍNH NĂNG TÌM LẠI FOLDER THẤT LẠC ---
async function reconnectDriveFolder() {
    // Lấy link Script cá nhân; nếu chưa cấu hình thì nhắc người dùng cài đặt
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (await ErrorHandler.confirm("Chưa cấu hình kết nối Drive! Vào màn hình chính → Cài đặt Google Drive ngay?", { title: "Chưa cấu hình Drive", confirmText: "Cài đặt Drive" })) openDashboardDriveConfigGuide();
        return;
    }
    // Không có dữ liệu khách hàng hiện tại thì dừng
    if (!currentCustomerData) return;

    // Hiển thị loader và cập nhật thông báo
    LoadingManager.showGlobal("Đang tìm trên Drive...");

    // Lấy thông tin tên, SĐT và CCCD sau khi giải mã (hàm decryptText sẽ trả lại nguyên bản nếu đầu vào đã giải mã)
    const name = _displayText(currentCustomerData.name);
    const phone = _displayText(currentCustomerData.phone);
    const cccd = _displayText(currentCustomerData.cccd);

    // Tạo danh sách tên thư mục có thể có: ưu tiên theo CCCD trước, sau đó là SĐT
    const possibleNames = [];
    if (cccd) possibleNames.push(`${name} - ${cccd}`);
    if (phone) possibleNames.push(`${name} - ${phone}`);

    let foundUrl = null;

    // Thử tìm lần lượt các tên trong danh sách
    for (const folderName of possibleNames) {
        try {
            getEl('loader-text').textContent = `Đang tìm: ${folderName}...`;
            const response = await fetch(userUrl, {
                method: "POST",
                body: JSON.stringify({ action: 'search', folderName: folderName, token: getUserToken() })
            });
            const result = await response.json();
            if (result.status === 'found') {
                foundUrl = result.url;
                break;
            }
        } catch (e) {
            ErrorHandler.logError("reconnectDriveFolder: lỗi tìm kiếm", e);
        }
    }

    // Nếu tìm thấy thì lưu và cập nhật giao diện, ngược lại báo lỗi
    if (foundUrl) {
        currentCustomerData.driveLink = foundUrl;
        persistCurrentCustomer((rec) => { rec.driveLink = foundUrl; }, (ok) => {
            LoadingManager.hideGlobal(true);
            if (!ok) {
                currentCustomerData.driveLink = null;
                ErrorHandler.showError('STORAGE', 'Tìm thấy link nhưng lưu vào hồ sơ thất bại. Vui lòng thử lại.');
                return;
            }
            renderDriveStatus(foundUrl);
            ErrorHandler.showSuccess("Đã kết nối lại thành công!");
        });
    } else {
        LoadingManager.hideGlobal(true);
        ErrorHandler.showWarning("Không tìm thấy thư mục nào khớp với Tên + CCCD hoặc Tên + SĐT.");
    }
}

// Legacy upload variants removed; canonical uploadToGoogleDrive is below.

// --- LOGIC UPLOAD ẢNH HỒ SƠ ---
async function uploadToGoogleDrive() {
    // Lấy link Script cá nhân cho upload tài sản
    const userUrl = localStorage.getItem(USER_SCRIPT_KEY);
    if (!userUrl || userUrl.length < 10) {
        if (await ErrorHandler.confirm("Bạn chưa cấu hình nơi lưu ảnh cá nhân! Vào màn hình chính → Cài đặt Google Drive để nhập link kết nối Drive của bạn.", { title: "Chưa cấu hình Drive", confirmText: "Cài đặt Drive" })) {
            openDashboardDriveConfigGuide();
        }
        return;
    }
    const scriptUrl = userUrl;

    if (!currentCustomerData) return;

    // 1. Lấy ảnh từ Database
    LoadingManager.showGlobal("Đang kiểm tra ảnh...");
    
    const tx = db.transaction(['images'], 'readonly');
    const store = tx.objectStore('images');
    const index = store.index('customerId');

    index.getAll(currentCustomerId).onsuccess = async (e) => {
        let allImages = e.target.result || [];
        // Lấy ảnh hồ sơ (không có assetId)
        let imagesToUpload = allImages.filter(img => !img.assetId);

        if (imagesToUpload.length === 0) {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showWarning("Không có ảnh hồ sơ nào để tải lên!");
            return;
        }

        if (!(await ErrorHandler.confirm(`Tải lên ${imagesToUpload.length} ảnh hồ sơ?`, { title: "Tải ảnh lên Drive", confirmText: "Tải lên" }))) {
            LoadingManager.hideGlobal(true);
            return;
        }

        LoadingManager.showGlobal("Đang tải ảnh lên Drive…");

        // Tên folder Drive phải dựng từ decrypt async THẬT (§13): _displayText đồng bộ
        // fail-open khi cold-cache — folder tên rác kiểu " - " vẫn upload. Không giải mã
        // được -> dừng + báo lỗi (mirror guard trong reconnectAssetDriveFolder).
        const namePlain = (typeof _displayPlainAsync === 'function')
            ? await _displayPlainAsync(currentCustomerData.name, '')
            : _displayText(currentCustomerData.name);
        const cccdPlain = (typeof _displayPlainAsync === 'function')
            ? await _displayPlainAsync(currentCustomerData.cccd, '')
            : _displayText(currentCustomerData.cccd);
        const phonePlain = (typeof _displayPlainAsync === 'function')
            ? await _displayPlainAsync(currentCustomerData.phone, '')
            : _displayText(currentCustomerData.phone);
        const folderSuffix = cccdPlain || phonePlain;
        if (!namePlain || !folderSuffix || _looksEncrypted(namePlain) || _looksEncrypted(folderSuffix)) {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showWarning('Không thể đọc tên/CCCD/SĐT khách hàng (dữ liệu chưa giải mã được). Vui lòng thử lại sau khi mở khóa.');
            return;
        }

        // Giải mã + kiểm chứng plaintext TRƯỚC khi gửi (xem _resolveImagesForUpload).
        const resolvedImages = await _resolveImagesForUpload(imagesToUpload, 'hoso');
        if (!resolvedImages) {
            LoadingManager.hideGlobal(true);
            ErrorHandler.showWarning('Không giải mã được ảnh để tải lên (ứng dụng có thể đã tự khóa). Vui lòng mở khóa và thử lại — chưa có ảnh nào được gửi đi.');
            return;
        }

        // 2. Chuẩn bị gói dữ liệu
        const payload = {
            action: 'upload', // <--- Báo cho Script biết là muốn Upload
            token: getUserToken(),
            // Ưu tiên đặt tên folder theo CCCD, fallback sang SĐT nếu chưa có CCCD
            folderName: `${namePlain} - ${folderSuffix}`,
            images: resolvedImages,
        };

        // Xem chú thích cùng cờ này trong uploadAssetToDrive.
        let reachedDrive = false;
        try {
            const outcome = await _runDriveImageUpload(scriptUrl, payload, imagesToUpload);

            if (outcome.verdict === DRIVE_UPLOAD_REJECTED) {
                LoadingManager.hideGlobal(true);
                ErrorHandler.showError('BACKUP',
                    outcome.message
                        ? `Tải ảnh lên Drive thất bại: ${outcome.message}`
                        : 'Tải ảnh lên Drive thất bại. Vui lòng kiểm tra kết nối và link kết nối Drive.',
                    outcome.error || null);
                return;
            }

            if (outcome.verdict === DRIVE_UPLOAD_UNCONFIRMED) {
                reachedDrive = true;
                if (await _persistCustomerDriveLink(outcome.url)) {
                    // Có thư mục để mở, nhưng UI KHÔNG được nói "đã tải xong".
                    renderDriveStatus(outcome.url, DRIVE_STATUS_UNCONFIRMED);
                }
                LoadingManager.hideGlobal(true);
                ErrorHandler.showWarning(_unconfirmedUploadMessage(outcome, imagesToUpload.length));
                return;
            }

            reachedDrive = true;
            const succeededImgs = outcome.succeeded;

            // Lưu link Folder (ghi an toàn, giữ nguyên ciphertext các trường khác).
            // Await kết quả ghi: KHÔNG báo thành công / hỏi xóa ảnh gốc khi ghi
            // link thất bại (mirror pattern _doSaveAsset ở 06_assets.js).
            const ok = await _persistCustomerDriveLink(outcome.url);

            LoadingManager.hideGlobal(true);

            if (!ok) {
                ErrorHandler.showWarning('Ảnh đã lên Drive nhưng CHƯA lưu được link vào hồ sơ. Hãy dùng "Tìm kết nối cũ" sau.');
                return;
            }

            renderDriveStatus(outcome.url);
            if (outcome.failedCount > 0) {
                ErrorHandler.showWarning(`Đã tải ${succeededImgs.length}/${imagesToUpload.length} ảnh hồ sơ lên Drive — ${outcome.failedCount} ảnh lỗi vẫn còn trong máy, hãy thử tải lại sau.`);
            } else {
                ErrorHandler.showSuccess("Đã tải ảnh hồ sơ lên Drive");
            }

            // CHỈ xóa ảnh đã lên Drive thành công
            const msgDel = outcome.failedCount > 0
                ? `Xóa ${succeededImgs.length} ảnh đã tải lên Drive khỏi ứng dụng để giảm dung lượng?\n(${outcome.failedCount} ảnh lỗi sẽ được giữ nguyên)`
                : "Đã tải ảnh hồ sơ lên Drive.\nXóa ảnh gốc trong ứng dụng để giảm dung lượng?";
            if (await ErrorHandler.confirm(msgDel, { title: "Dọn dẹp bộ nhớ", confirmText: "Xóa ảnh gốc" })) {
                _deleteSucceededUploadsOnly(succeededImgs, () => {
                    loadProfileImages();
                    ErrorHandler.showSuccess("Đã xóa ảnh gốc");
                });
            }
        } catch (err) {
            LoadingManager.hideGlobal(true);
            if (reachedDrive) {
                ErrorHandler.logError('uploadToGoogleDrive: lỗi SAU khi Drive đã nhận ảnh', err);
                ErrorHandler.showWarning('Ảnh đã lên Drive nhưng ứng dụng gặp lỗi khi cập nhật hồ sơ. Ảnh gốc trong máy được giữ nguyên — hãy dùng "Tìm kết nối cũ".');
            } else {
                ErrorHandler.showError('BACKUP', "Tải ảnh lên Drive thất bại. Vui lòng kiểm tra kết nối và link kết nối Drive.", err);
            }
        }
    };
}
