// ============================================================
// CALENDAR & REMINDERS - Lịch nhắc nhở công việc
// ============================================================

const REMINDERS_STORE = 'reminders';

// Current calendar state
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();
let selectedDate = null;

// ============================================================
// CALENDAR NAVIGATION
// ============================================================

function openCalendar() {
    const screen = getEl('screen-calendar');
    const dashboard = getEl('screen-dashboard');
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

    renderCalendar();
    loadDayReminders(selectedDate);
    requestNotificationPermission();
    try { lucide.createIcons(); } catch (e) { }
}

function closeCalendar() {
    const screen = getEl('screen-calendar');
    const dashboard = getEl('screen-dashboard');

    screen.classList.add('translate-x-full');
    dashboard.style.transform = '';

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

        let classes = 'calendar-day';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';
        if (hasReminder) classes += ' has-reminder';

        html += `<div class="${classes}" onclick="selectDay('${dateStr}')">
            <span>${day}</span>
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
    const select = getEl('rem-customer');
    if (!select) return;

    try {
        const tx = db.transaction(['customers'], 'readonly');
        const store = tx.objectStore('customers');
        const req = store.getAll();

        req.onsuccess = (e) => {
            const customers = e.target.result || [];
            let html = '<option value="">-- Không liên kết --</option>';

            customers.forEach(c => {
                const name = decryptText(c.name) || 'Không tên';
                html += `<option value="${c.id}">${escapeHTML(name)}</option>`;
            });

            select.innerHTML = html;
        };
    } catch (e) { }
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
