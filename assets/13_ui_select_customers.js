/*
 * 13_ui_select_customers.js
 * Simple picker UI for selecting customers for partial backup/transfer .
 */
(function () {
  async function loadCustomersForPick() {
    if (typeof db === 'undefined' || !db) throw new Error('DB chưa sẵn sàng');
    const list = await new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(['customers'], 'readonly');
        const req = tx.objectStore('customers').getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = (e) => reject(e);
      } catch (err) {
        reject(err);
      }
    });

    // decrypt for display
    list.forEach((c) => {
      try {
        if (typeof decryptCustomerObject === 'function') {
          decryptCustomerObject(c);
        } else {
          c.name = typeof decryptText === 'function' ? decryptText(c.name) : (c.name || '');
          c.phone = typeof decryptText === 'function' ? decryptText(c.phone) : (c.phone || '');
        }
      } catch (e) {
        // ignore
      }
    });

    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return list;
  }

  function escapeHTML(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderPicker(list, resolve) {
    const overlay = document.createElement('div');
    // IMPORTANT: must be above other modals (z-index 9999) to avoid being hidden behind it.
    overlay.className = 'fixed inset-0 z-[10050] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';

    overlay.innerHTML = `
      <div class="glass-panel w-full max-w-md rounded-2xl border border-white/10 overflow-hidden">
        <div class="px-4 py-3 flex items-center justify-between border-b border-white/10">
          <div>
            <div class="text-base font-extrabold" style="color: var(--text-main)">Chọn khách hàng</div>
            <div class="text-[11px] opacity-70" style="color: var(--text-sub)">Chọn 1 hoặc nhiều KH để sao lưu/gửi một phần dữ liệu</div>
          </div>
          <button class="p-2 rounded-xl hover:bg-white/10" data-act="close" style="color: var(--text-main)">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>

        <div class="p-4 space-y-3">
          <input id="qrPickSearch" placeholder="Tìm tên hoặc SĐT..." class="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm" style="color: var(--text-main)" />

          <div class="flex gap-2">
            <button class="flex-1 py-2.5 rounded-xl font-bold bg-white/5 border border-white/10" data-act="all" style="color: var(--text-main)">Chọn tất cả</button>
            <button class="flex-1 py-2.5 rounded-xl font-bold bg-white/5 border border-white/10" data-act="none" style="color: var(--text-main)">Bỏ chọn</button>
          </div>

          <div id="qrPickList" class="max-h-[52vh] overflow-auto space-y-2 pr-1 custom-scrollbar"></div>

          <div class="flex gap-2 pt-1">
            <button class="flex-1 py-3 rounded-xl font-extrabold text-white" data-act="ok" style="background: var(--accent-gradient)">Xong</button>
            <button class="flex-1 py-3 rounded-xl font-bold bg-white/5 border border-white/10" data-act="cancel" style="color: var(--text-main)">Hủy</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    if (window.lucide) lucide.createIcons();

    const selected = new Set();
    const listEl = overlay.querySelector('#qrPickList');
    const searchEl = overlay.querySelector('#qrPickSearch');

    function draw(items) {
      listEl.innerHTML = '';
      items.forEach((c) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'w-full text-left p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition flex items-center gap-3';
        row.dataset.id = c.id;

        const isOn = selected.has(c.id);
        row.innerHTML = `
          <div class="w-5 h-5 rounded-md border border-white/20 flex items-center justify-center ${isOn ? 'bg-emerald-500/20' : 'bg-transparent'}">
            ${isOn ? '<span style="color:#34d399;font-weight:900">✓</span>' : ''}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-bold truncate" style="color: var(--text-main)">${escapeHTML(c.name || '---')}</div>
            <div class="text-[11px] opacity-70 truncate" style="color: var(--text-sub)">${escapeHTML(c.phone || '')}</div>
          </div>
        `;

        row.addEventListener('click', () => {
          if (selected.has(c.id)) selected.delete(c.id);
          else selected.add(c.id);
          draw(filterList());
        });

        listEl.appendChild(row);
      });
    }

    function filterList() {
      const q = String(searchEl.value || '').trim().toLowerCase();
      if (!q) return list;
      return list.filter((c) => {
        const name = String(c.name || '').toLowerCase();
        const phone = String(c.phone || '');
        return name.includes(q) || phone.includes(q);
      });
    }

    function close(result) {
      overlay.remove();
      resolve(result);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close([]);
    });

    overlay.querySelector('[data-act="close"]').addEventListener('click', () => close([]));
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close([]));
    overlay.querySelector('[data-act="ok"]').addEventListener('click', () => close(Array.from(selected)));

    overlay.querySelector('[data-act="all"]').addEventListener('click', () => {
      list.forEach((c) => selected.add(c.id));
      draw(filterList());
    });
    overlay.querySelector('[data-act="none"]').addEventListener('click', () => {
      selected.clear();
      draw(filterList());
    });

    searchEl.addEventListener('input', () => draw(filterList()));

    draw(list);
  }

  window.UISelectCustomers = {
    async pickIds() {
      try {
        const list = await loadCustomersForPick();
        if (!list.length) {
          alert('Chưa có khách hàng');
          return [];
        }
        return await new Promise((resolve) => renderPicker(list, resolve));
      } catch (err) {
        console.error(err);
        alert('Không thể tải danh sách khách hàng');
        return [];
      }
    }
  };
})();
