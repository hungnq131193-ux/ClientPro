// ============================================================
// CALENDAR & REMINDERS - Lịch nhắc nhở công việc
// ============================================================

const REMINDERS_STORE = 'reminders';

// Current calendar state
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();
let selectedDate = null;

// ============================================================
// VIETNAMESE LUNAR CALENDAR CONVERSION
// Based on Ho Ngoc Duc's algorithm
// ============================================================

const PI = Math.PI;

function jdFromDate(dd, mm, yy) {
    const a = Math.floor((14 - mm) / 12);
    const y = yy + 4800 - a;
    const m = mm + 12 * a - 3;
    let jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
    if (jd < 2299161) {
        jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
    }
    return jd;
}

function getNewMoonDay(k) {
    const T = k / 1236.85;
    const T2 = T * T;
    const T3 = T2 * T;
    const dr = PI / 180;
    let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
    Jd1 = Jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
    const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
    const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
    C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
    C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
    C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
    C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
    C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
    C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
    let deltat;
    if (T < -11) {
        deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
    } else {
        deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
    }
    return Math.floor(Jd1 + C1 - deltat + 0.5 + 0.5);
}

function getSunLongitude(jdn) {
    const T = (jdn - 2451545.5 - 0.5) / 36525;
    const T2 = T * T;
    const dr = PI / 180;
    const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
    const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
    DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
    let L = L0 + DL;
    L = L * dr;
    L = L - PI * 2 * (Math.floor(L / (PI * 2)));
    return Math.floor(L / PI * 6);
}

function getLunarMonth11(yy) {
    const off = jdFromDate(31, 12, yy) - 2415021;
    const k = Math.floor(off / 29.530588853);
    let nm = getNewMoonDay(k);
    const sunLong = getSunLongitude(nm);
    if (sunLong >= 9) {
        nm = getNewMoonDay(k - 1);
    }
    return nm;
}

function getLeapMonthOffset(a11) {
    const k = Math.floor((a11 - 2415021.076998695) / 29.530588853 + 0.5);
    let last = 0;
    let i = 1;
    let arc = getSunLongitude(getNewMoonDay(k + i));
    do {
        last = arc;
        i++;
        arc = getSunLongitude(getNewMoonDay(k + i));
    } while (arc !== last && i < 14);
    return i - 1;
}

function convertSolar2Lunar(dd, mm, yy) {
    const dayNumber = jdFromDate(dd, mm, yy);
    const k = Math.floor((dayNumber - 2415021.076998695) / 29.530588853);
    let monthStart = getNewMoonDay(k + 1);
    if (monthStart > dayNumber) {
        monthStart = getNewMoonDay(k);
    }
    let a11 = getLunarMonth11(yy);
    let b11 = a11;
    let lunarYear;
    if (a11 >= monthStart) {
        lunarYear = yy;
        a11 = getLunarMonth11(yy - 1);
    } else {
        lunarYear = yy + 1;
        b11 = getLunarMonth11(yy + 1);
    }
    const lunarDay = dayNumber - monthStart + 1;
    const diff = Math.floor((monthStart - a11) / 29);
    let lunarLeap = 0;
    let lunarMonth = diff + 11;
    if (b11 - a11 > 365) {
        const leapMonthDiff = getLeapMonthOffset(a11);
        if (diff >= leapMonthDiff) {
            lunarMonth = diff + 10;
            if (diff === leapMonthDiff) {
                lunarLeap = 1;
            }
        }
    }
    if (lunarMonth > 12) {
        lunarMonth = lunarMonth - 12;
    }
    if (lunarMonth >= 11 && diff < 4) {
        lunarYear -= 1;
    }
    return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap };
}

// Get lunar date string for display
function getLunarDateStr(dd, mm, yy) {
    const lunar = convertSolar2Lunar(dd, mm, yy);
    return `${lunar.day}/${lunar.month}${lunar.leap ? ' nhuận' : ''}`;
}

// ============================================================
// CALENDAR NAVIGATION
// ============================================================

function openCalendar() {
    const screen = getEl('screen-calendar');
    const dashboard = getEl('screen-dashboard');
    const fab = getEl('fab-add-reminder');
    if (!screen) return;

    // Reset to current month
    calendarYear = new Date().getFullYear();
    calendarMonth = new Date().getMonth();
    selectedDate = new Date().toISOString().split('T')[0];

    // Show calendar screen with slide animation
    screen.classList.remove('hidden');
    setTimeout(() => {
        screen.classList.remove('translate-x-full');
        dashboard.style.transform = 'translateX(-30%)';
    }, 10);

    // Show FAB button
    if (fab) fab.style.display = 'flex';

    renderCalendar();
    loadDayReminders(selectedDate);
    requestNotificationPermission();
    try { lucide.createIcons(); } catch (e) { }
}

function closeCalendar() {
    const screen = getEl('screen-calendar');
    const dashboard = getEl('screen-dashboard');
    const fab = getEl('fab-add-reminder');

    screen.classList.add('translate-x-full');
    dashboard.style.transform = '';

    // Hide FAB button
    if (fab) fab.style.display = 'none';

    setTimeout(() => {
        screen.classList.add('hidden');
    }, 300);
}

function prevMonth() {
    calendarMonth--;
    if (calendarMonth < 0) {
        calendarMonth = 11;
        calendarYear--;
    }
    renderCalendar();
}

function nextMonth() {
    calendarMonth++;
    if (calendarMonth > 11) {
        calendarMonth = 0;
        calendarYear++;
    }
    renderCalendar();
}

function goToToday() {
    calendarYear = new Date().getFullYear();
    calendarMonth = new Date().getMonth();
    selectedDate = new Date().toISOString().split('T')[0];
    renderCalendar();
    loadDayReminders(selectedDate);
}

// ============================================================
// CALENDAR RENDERING
// ============================================================

async function renderCalendar() {
    const monthNames = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
        'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];

    const monthLabel = getEl('calendar-month-label');
    if (monthLabel) {
        monthLabel.textContent = `${monthNames[calendarMonth]}, ${calendarYear}`;
    }

    const grid = getEl('calendar-grid');
    if (!grid) return;

    // Get reminders for this month to mark dots
    const monthReminders = await getMonthReminders(calendarYear, calendarMonth);
    const reminderDates = new Set(monthReminders.map(r => {
        const d = new Date(r.datetime);
        return d.toISOString().split('T')[0];
    }));

    // Calculate first day and days in month
    const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const today = new Date().toISOString().split('T')[0];

    let html = '';

    // Empty cells before first day (adjust for Sunday = 0)
    const startOffset = firstDay === 0 ? 6 : firstDay - 1; // Monday start
    for (let i = 0; i < startOffset; i++) {
        html += '<div class="calendar-day empty"></div>';
    }

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = dateStr === today;
        const isSelected = dateStr === selectedDate;
        const hasReminder = reminderDates.has(dateStr);

        // Get lunar date
        const lunar = convertSolar2Lunar(day, calendarMonth + 1, calendarYear);
        const lunarStr = lunar.day === 1 ? `${lunar.day}/${lunar.month}` : lunar.day;

        let classes = 'calendar-day';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';
        if (hasReminder) classes += ' has-reminder';

        html += `<div class="${classes}" onclick="selectDay('${dateStr}')">
            <span class="solar-day">${day}</span>
            <span class="lunar-day">${lunarStr}</span>
            ${hasReminder ? '<span class="reminder-dot"></span>' : ''}
        </div>`;
    }

    grid.innerHTML = html;
}

function selectDay(dateStr) {
    selectedDate = dateStr;
    renderCalendar();
    loadDayReminders(dateStr);
}

// ============================================================
// REMINDERS DATA
// ============================================================

async function getMonthReminders(year, month) {
    return new Promise((resolve) => {
        try {
            const startDate = new Date(year, month, 1).getTime();
            const endDate = new Date(year, month + 1, 0, 23, 59, 59).getTime();

            const tx = db.transaction([REMINDERS_STORE], 'readonly');
            const store = tx.objectStore(REMINDERS_STORE);
            const req = store.getAll();

            req.onsuccess = (e) => {
                const all = e.target.result || [];
                const filtered = all.filter(r => r.datetime >= startDate && r.datetime <= endDate);
                resolve(filtered);
            };
            req.onerror = () => resolve([]);
        } catch (e) {
            resolve([]);
        }
    });
}

async function getDayReminders(dateStr) {
    return new Promise((resolve) => {
        try {
            const [year, month, day] = dateStr.split('-').map(Number);
            const startDate = new Date(year, month - 1, day, 0, 0, 0).getTime();
            const endDate = new Date(year, month - 1, day, 23, 59, 59).getTime();

            const tx = db.transaction([REMINDERS_STORE], 'readonly');
            const store = tx.objectStore(REMINDERS_STORE);
            const req = store.getAll();

            req.onsuccess = (e) => {
                const all = e.target.result || [];
                const filtered = all.filter(r => r.datetime >= startDate && r.datetime <= endDate);
                filtered.sort((a, b) => a.datetime - b.datetime);
                resolve(filtered);
            };
            req.onerror = () => resolve([]);
        } catch (e) {
            resolve([]);
        }
    });
}

async function loadDayReminders(dateStr) {
    const container = getEl('day-reminders');
    if (!container) return;

    const reminders = await getDayReminders(dateStr);
    const [year, month, day] = dateStr.split('-').map(Number);
    const dateLabel = `${day}/${month}/${year}`;

    if (reminders.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 opacity-60" style="color: var(--text-sub)">
                <i data-lucide="calendar-off" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
                <p class="text-sm">Không có nhắc nhở ngày ${dateLabel}</p>
            </div>`;
        try { lucide.createIcons(); } catch (e) { }
        return;
    }

    let html = `<p class="text-xs font-bold uppercase opacity-60 mb-3 px-1" style="color: var(--text-sub)">
        Nhắc nhở ngày ${dateLabel} (${reminders.length})
    </p>`;

    for (const rem of reminders) {
        const time = new Date(rem.datetime);
        const timeStr = time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        const isDone = rem.status === 'done';
        const statusClass = isDone ? 'opacity-50 line-through' : '';
        const statusIcon = isDone ? 'check-circle' : 'circle';

        html += `
        <div class="glass-panel p-3 rounded-xl mb-2 flex items-start gap-3 ${statusClass}">
            <button onclick="toggleReminderStatus('${rem.id}')" class="mt-0.5 flex-shrink-0">
                <i data-lucide="${statusIcon}" class="w-5 h-5" style="color: var(--accent)"></i>
            </button>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-xs font-bold px-2 py-0.5 rounded-full" 
                          style="background: var(--accent); color: white;">${timeStr}</span>
                    ${rem.customerId ? '<i data-lucide="user" class="w-3 h-3 opacity-50"></i>' : ''}
                </div>
                <p class="font-medium text-sm truncate" style="color: var(--text-main)">${escapeHTML(rem.title)}</p>
                ${rem.note ? `<p class="text-xs opacity-60 truncate" style="color: var(--text-sub)">${escapeHTML(rem.note)}</p>` : ''}
            </div>
            <div class="flex gap-1 flex-shrink-0">
                <button onclick="editReminder('${rem.id}')" class="p-2 rounded-lg hover:bg-white/10">
                    <i data-lucide="pencil" class="w-4 h-4" style="color: var(--text-sub)"></i>
                </button>
                <button onclick="deleteReminder('${rem.id}')" class="p-2 rounded-lg hover:bg-red-500/20">
                    <i data-lucide="trash-2" class="w-4 h-4 text-red-400"></i>
                </button>
            </div>
        </div>`;
    }

    container.innerHTML = html;
    try { lucide.createIcons(); } catch (e) { }
}

// ============================================================
// REMINDER MODAL
// ============================================================

async function openReminderModal(editId = null) {
    const modal = getEl('reminder-modal');
    if (!modal) return;

    // Populate customer dropdown
    await populateCustomerDropdown();

    // Reset form
    getEl('rem-edit-id').value = '';
    getEl('rem-title').value = '';
    getEl('rem-note').value = '';
    getEl('rem-customer').value = '';
    getEl('rem-notify').value = '15';

    // Set default date/time
    const now = selectedDate ? new Date(selectedDate) : new Date();
    now.setHours(9, 0, 0, 0);
    getEl('rem-date').value = now.toISOString().split('T')[0];
    getEl('rem-time').value = '09:00';

    const titleEl = getEl('reminder-modal-title');

    if (editId) {
        // Edit mode
        const rem = await getReminderById(editId);
        if (rem) {
            getEl('rem-edit-id').value = rem.id;
            getEl('rem-title').value = rem.title || '';
            getEl('rem-note').value = rem.note || '';
            getEl('rem-customer').value = rem.customerId || '';
            getEl('rem-notify').value = String(rem.notifyBefore || 15);

            const dt = new Date(rem.datetime);
            getEl('rem-date').value = dt.toISOString().split('T')[0];
            getEl('rem-time').value = dt.toTimeString().slice(0, 5);

            if (titleEl) titleEl.textContent = 'Sửa nhắc nhở';
        }
    } else {
        if (titleEl) titleEl.textContent = 'Thêm nhắc nhở';
    }

    modal.classList.remove('hidden');
    try { lucide.createIcons(); } catch (e) { }
}

function closeReminderModal() {
    const modal = getEl('reminder-modal');
    if (modal) modal.classList.add('hidden');
}

async function populateCustomerDropdown() {
    const container = getEl('rem-customer-container');
    if (!container) return;

    try {
        const tx = db.transaction(['customers'], 'readonly');
        const store = tx.objectStore('customers');
        const req = store.getAll();

        req.onsuccess = (e) => {
            const customers = e.target.result || [];
            // Store customers globally for search
            window._reminderCustomers = customers.map(c => ({
                id: c.id,
                name: decryptText(c.name) || 'Không tên'
            }));

            // Render full list initially
            renderCustomerOptions('');
        };
    } catch (e) { }
}

function renderCustomerOptions(searchTerm) {
    const list = getEl('rem-customer-list');
    const hiddenInput = getEl('rem-customer');
    if (!list) return;

    const customers = window._reminderCustomers || [];
    const term = searchTerm.toLowerCase().trim();
    const selectedId = hiddenInput ? hiddenInput.value : '';

    // Filter customers by search term
    const filtered = term
        ? customers.filter(c => c.name.toLowerCase().includes(term))
        : customers;

    let html = `<div class="customer-option ${selectedId === '' ? 'selected' : ''}" onclick="selectCustomer('', '')">
        <i data-lucide="x-circle" class="w-4 h-4 opacity-50"></i>
        <span class="opacity-60">-- Không liên kết --</span>
    </div>`;

    filtered.forEach(c => {
        const isSelected = selectedId === c.id;
        html += `<div class="customer-option ${isSelected ? 'selected' : ''}" onclick="selectCustomer('${c.id}', '${escapeHTML(c.name).replace(/'/g, "\\'")}')">
            <i data-lucide="user" class="w-4 h-4 opacity-50"></i>
            <span>${escapeHTML(c.name)}</span>
        </div>`;
    });

    if (filtered.length === 0 && term) {
        html = `<div class="text-center py-4 opacity-50 text-sm" style="color: var(--text-sub)">Không tìm thấy "${escapeHTML(searchTerm)}"</div>`;
    }

    list.innerHTML = html;
    try { lucide.createIcons(); } catch (e) { }
}

function selectCustomer(id, name) {
    const hiddenInput = getEl('rem-customer');
    const searchInput = getEl('rem-customer-search');

    if (hiddenInput) hiddenInput.value = id;
    if (searchInput) searchInput.value = name;

    // Re-render to show selected state
    renderCustomerOptions(searchInput ? searchInput.value : '');
}

function onCustomerSearch(e) {
    renderCustomerOptions(e.target.value);
}


async function getReminderById(id) {
    return new Promise((resolve) => {
        try {
            const tx = db.transaction([REMINDERS_STORE], 'readonly');
            const store = tx.objectStore(REMINDERS_STORE);
            const req = store.get(id);
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = () => resolve(null);
        } catch (e) {
            resolve(null);
        }
    });
}

// ============================================================
// REMINDER CRUD
// ============================================================

async function saveReminder() {
    const title = getEl('rem-title').value.trim();
    const dateVal = getEl('rem-date').value;
    const timeVal = getEl('rem-time').value;
    const customerId = getEl('rem-customer').value || null;
    const note = getEl('rem-note').value.trim();
    const notifyBefore = parseInt(getEl('rem-notify').value) || 0;
    const editId = getEl('rem-edit-id').value;

    if (!title) {
        showToast('Vui lòng nhập tiêu đề');
        return;
    }
    if (!dateVal || !timeVal) {
        showToast('Vui lòng chọn ngày giờ');
        return;
    }

    const datetime = new Date(`${dateVal}T${timeVal}`).getTime();

    const reminder = {
        id: editId || `rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title,
        datetime,
        customerId,
        note,
        notifyBefore,
        status: 'pending',
        createdAt: editId ? undefined : Date.now(),
        updatedAt: Date.now()
    };

    // Preserve createdAt on edit
    if (editId) {
        const existing = await getReminderById(editId);
        if (existing) reminder.createdAt = existing.createdAt;
    }

    try {
        const tx = db.transaction([REMINDERS_STORE], 'readwrite');
        tx.objectStore(REMINDERS_STORE).put(reminder);
        tx.oncomplete = () => {
            showToast(editId ? 'Đã cập nhật nhắc nhở' : 'Đã thêm nhắc nhở');
            closeReminderModal();
            renderCalendar();
            loadDayReminders(selectedDate || dateVal);

            // Schedule notification if supported
            scheduleReminderNotification(reminder);
        };
    } catch (e) {
        showToast('Lỗi lưu nhắc nhở');
    }
}

async function deleteReminder(id) {
    if (!confirm('Xóa nhắc nhở này?')) return;

    try {
        const tx = db.transaction([REMINDERS_STORE], 'readwrite');
        tx.objectStore(REMINDERS_STORE).delete(id);
        tx.oncomplete = () => {
            showToast('Đã xóa nhắc nhở');
            renderCalendar();
            if (selectedDate) loadDayReminders(selectedDate);
        };
    } catch (e) {
        showToast('Lỗi xóa nhắc nhở');
    }
}

async function editReminder(id) {
    await openReminderModal(id);
}

async function toggleReminderStatus(id) {
    const rem = await getReminderById(id);
    if (!rem) return;

    rem.status = rem.status === 'done' ? 'pending' : 'done';
    rem.updatedAt = Date.now();

    try {
        const tx = db.transaction([REMINDERS_STORE], 'readwrite');
        tx.objectStore(REMINDERS_STORE).put(rem);
        tx.oncomplete = () => {
            showToast(rem.status === 'done' ? 'Đã hoàn thành' : 'Đánh dấu chưa hoàn thành');
            if (selectedDate) loadDayReminders(selectedDate);
        };
    } catch (e) { }
}

// ============================================================
// NOTIFICATIONS
// ============================================================

function scheduleReminderNotification(reminder) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') {
        Notification.requestPermission();
        return;
    }

    if (reminder.notifyBefore <= 0) return;

    const notifyTime = reminder.datetime - (reminder.notifyBefore * 60 * 1000);
    const now = Date.now();

    if (notifyTime <= now) return; // Already passed

    const delay = notifyTime - now;

    // Store timeout ID for potential cancellation
    setTimeout(() => {
        if (Notification.permission === 'granted') {
            new Notification('ClientPro - Nhắc nhở', {
                body: reminder.title,
                icon: '/icon-192.png',
                tag: reminder.id,
                requireInteraction: true
            });
        }
    }, delay);
}

// Check pending reminders on app start
async function checkPendingReminders() {
    try {
        const tx = db.transaction([REMINDERS_STORE], 'readonly');
        const store = tx.objectStore(REMINDERS_STORE);
        const req = store.getAll();

        req.onsuccess = (e) => {
            const all = e.target.result || [];
            const now = Date.now();
            const upcoming = all.filter(r =>
                r.status === 'pending' &&
                r.datetime > now &&
                r.notifyBefore > 0
            );

            upcoming.forEach(r => scheduleReminderNotification(r));
        };
    } catch (e) { }
}

// Request notification permission on first calendar open
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}
