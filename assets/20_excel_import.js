// ============================================================
// EXCEL IMPORT - Nhập khách hàng từ file Excel
// ============================================================

// Column name patterns to detect
const EXCEL_COL_PATTERNS = {
    name: ['tên', 'ten', 'họ tên', 'ho ten', 'khách hàng', 'khach hang', 'name', 'customer'],
    phone: ['điện thoại', 'dien thoai', 'sđt', 'sdt', 'phone', 'số điện thoại', 'so dien thoai', 'mobile'],
    cccd: ['cccd', 'căn cước', 'can cuoc', 'cmnd', 'cmtnd', 'cccd/cmnd', 'số cccd', 'so cccd'],
    creditLimit: ['hạn mức', 'han muc', 'limit', 'hạn mức cấp', 'số tiền', 'so tien', 'credit']
};

// Normalize Vietnamese text for comparison
function normalizeText(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .trim();
}

// Find matching column index for each field
function detectColumns(headers) {
    const mapping = {};
    const normalizedHeaders = headers.map(h => normalizeText(h));

    for (const [field, patterns] of Object.entries(EXCEL_COL_PATTERNS)) {
        for (let i = 0; i < normalizedHeaders.length; i++) {
            const header = normalizedHeaders[i];
            for (const pattern of patterns) {
                if (header.includes(normalizeText(pattern))) {
                    mapping[field] = i;
                    break;
                }
            }
            if (mapping[field] !== undefined) break;
        }
    }

    return mapping;
}

// Clean Excel text format (removes leading ' used for text numbers)
function cleanExcelText(value) {
    if (value == null) return '';
    let str = String(value);
    // Remove leading apostrophe (Excel text format)
    if (str.startsWith("'")) str = str.slice(1);
    return str.trim();
}

// Parse phone number to standard format
function normalizePhone(phone) {
    if (!phone) return '';
    let p = cleanExcelText(phone).replace(/[^0-9]/g, '');
    if (p.startsWith('84') && p.length > 9) p = '0' + p.slice(2);
    if (!p.startsWith('0') && p.length === 9) p = '0' + p;
    return p;
}

// Normalize CCCD (12 digits, add leading 0 if needed)
function normalizeCCCD(cccd) {
    if (!cccd) return '';
    let c = cleanExcelText(cccd).replace(/[^0-9]/g, '');
    // CCCD có 12 số, nếu thiếu số 0 đầu thì thêm vào
    if (c.length === 11 && !c.startsWith('0')) c = '0' + c;
    // CMND cũ có 9 số, nếu thiếu số 0 đầu thì thêm vào
    if (c.length === 8 && !c.startsWith('0')) c = '0' + c;
    return c;
}

// Parse date from various formats
function parseDate(value) {
    if (!value) return null;

    // If already a Date object
    if (value instanceof Date) {
        return value.getTime();
    }

    // If it's a number (Excel date serial)
    if (typeof value === 'number') {
        // Excel date serial number (days since 1900-01-01)
        const date = new Date((value - 25569) * 86400 * 1000);
        return date.getTime();
    }

    // Try parsing string date
    let str = cleanExcelText(value);
    if (!str) return null;

    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const dmyMatch = str.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})$/);
    if (dmyMatch) {
        const [, d, m, y] = dmyMatch;
        console.log('[Excel Import] DMY parsed:', d, m, y);
        return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).getTime();
    }

    // YYYY-MM-DD or YYYY/MM/DD
    const ymdMatch = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (ymdMatch) {
        const [, y, m, d] = ymdMatch;
        console.log('[Excel Import] YMD parsed:', y, m, d);
        return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).getTime();
    }

    // Fallback: try native Date parsing
    const fallback = Date.parse(str);
    if (!isNaN(fallback)) {
        return fallback;
    }

    return null;
}

// Main import function
async function importFromExcel() {
    // Create file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Show loader
        const loader = getEl('loader');
        const loaderText = getEl('loader-text');
        if (loader) loader.classList.remove('hidden');
        if (loaderText) loaderText.textContent = 'Đang đọc file Excel...';

        try {
            const data = await readExcelFile(file);
            await processExcelData(data);
        } catch (err) {
            console.error('Excel import error:', err);
            alert('Lỗi đọc file: ' + err.message);
        } finally {
            if (loader) loader.classList.add('hidden');
        }
    };

    input.click();
}

// Read Excel file using SheetJS
async function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                if (typeof XLSX === 'undefined') {
                    throw new Error('Thư viện XLSX chưa được tải. Vui lòng kiểm tra kết nối mạng.');
                }

                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                // Get first sheet
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];

                // Convert to JSON
                const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });

                resolve(json);
            } catch (err) {
                reject(err);
            }
        };

        reader.onerror = () => reject(new Error('Không thể đọc file'));
        reader.readAsArrayBuffer(file);
    });
}

// Process Excel data
async function processExcelData(rows) {
    if (!rows || rows.length < 2) {
        alert('File Excel trống hoặc không có dữ liệu!');
        return;
    }

    const loaderText = getEl('loader-text');

    // First row is headers
    const headers = rows[0];
    const colMap = detectColumns(headers);

    // Check required columns
    if (colMap.phone === undefined) {
        alert('Không tìm thấy cột Số điện thoại!\n\nCác cột được hỗ trợ:\n- Số điện thoại, SĐT, Phone, Mobile...');
        return;
    }

    // Get existing customers for matching
    const existingCustomers = await getAllCustomers();
    const phoneIndex = new Map();
    existingCustomers.forEach(c => {
        const phone = normalizePhone(typeof decryptText === 'function' ? decryptText(c.phone) : c.phone);
        if (phone) phoneIndex.set(phone, c);
    });

    let created = 0, updated = 0, skipped = 0;

    // Process each row (skip header)
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        if (loaderText) loaderText.textContent = `Xử lý dòng ${i}/${rows.length - 1}...`;

        const rawPhone = colMap.phone !== undefined ? row[colMap.phone] : null;
        const phone = normalizePhone(rawPhone);

        if (!phone || phone.length < 9) {
            skipped++;
            continue;
        }

        const rowData = {
            name: colMap.name !== undefined ? cleanExcelText(row[colMap.name]) : '',
            phone: phone,
            cccd: colMap.cccd !== undefined ? normalizeCCCD(row[colMap.cccd]) : '',
            creditLimit: colMap.creditLimit !== undefined ? cleanExcelText(row[colMap.creditLimit]) : ''
        };

        const existing = phoneIndex.get(phone);

        if (existing) {
            // Update existing customer - only fill empty fields
            const wasUpdated = await updateExistingCustomer(existing, rowData);
            if (wasUpdated) updated++;
        } else {
            // Create new customer
            await createNewCustomer(rowData);
            created++;
        }

        // Yield to UI
        if (i % 10 === 0) {
            await new Promise(r => setTimeout(r, 0));
        }
    }

    // Show result
    const msg = `✅ Import hoàn tất!\n\n` +
        `📥 Tạo mới: ${created} khách hàng\n` +
        `📝 Cập nhật: ${updated} khách hàng\n` +
        `⏭️ Bỏ qua: ${skipped} dòng (thiếu SĐT)`;

    alert(msg);

    // Reload customer list
    if (typeof loadCustomers === 'function') {
        loadCustomers();
    }
}

// Get all customers from DB
function getAllCustomers() {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve([]);
            return;
        }

        const tx = db.transaction(['customers'], 'readonly');
        const store = tx.objectStore('customers');
        const req = store.getAll();

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// Update existing customer - only fill empty fields
async function updateExistingCustomer(existing, newData) {
    let hasChanges = false;

    // Decrypt existing data to check
    const decName = typeof decryptText === 'function' ? decryptText(existing.name) : existing.name;
    const decCccd = typeof decryptText === 'function' ? decryptText(existing.cccd) : existing.cccd;
    const decLimit = existing.creditLimit || '';

    // Only update if existing field is empty
    if (!decName && newData.name) {
        existing.name = typeof encryptText === 'function' ? encryptText(newData.name) : newData.name;
        hasChanges = true;
    }

    if (!decCccd && newData.cccd) {
        existing.cccd = typeof encryptText === 'function' ? encryptText(newData.cccd) : newData.cccd;
        hasChanges = true;
    }

    if (!decLimit && newData.creditLimit) {
        existing.creditLimit = newData.creditLimit;
        hasChanges = true;
        // Has credit limit = approved
        if (existing.status === 'pending') {
            existing.status = 'approved';
        }
    }



    if (hasChanges) {
        existing.updatedAt = Date.now();
        await saveCustomer(existing);
    }

    return hasChanges;
}

// Create new customer from Excel data
async function createNewCustomer(data) {
    const hasLimit = data.creditLimit && data.creditLimit.length > 0;

    const customer = {
        id: 'cust_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: typeof encryptText === 'function' ? encryptText(data.name) : data.name,
        phone: typeof encryptText === 'function' ? encryptText(data.phone) : data.phone,
        cccd: typeof encryptText === 'function' ? encryptText(data.cccd || '') : (data.cccd || ''),
        creditLimit: data.creditLimit || '',
        status: hasLimit ? 'approved' : 'pending',
        assets: [],
        notes: '',
        driveLink: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    await saveCustomer(customer);
}

// Save customer to DB
function saveCustomer(customer) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not ready'));
            return;
        }

        const tx = db.transaction(['customers'], 'readwrite');
        const store = tx.objectStore('customers');
        const req = store.put(customer);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// Export for global access
window.importFromExcel = importFromExcel;
