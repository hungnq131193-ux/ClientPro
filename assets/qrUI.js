/**
 * qrUI.js
 *
 * UI glue:
 * - openQrTransferBackup(): create QR frames and render them
 * - handleQrImageUpload(files): decode QR from uploaded images and restore
 *
 * Notes:
 * - Customer picker is implemented here (UISelectCustomers.pickIds)
 * - Restore QR uses image upload (no camera scanning)
 */

(function () {
  const PICKER_ID = 'qrCustPickerModal';

  function ensureCustomerPicker() {
    if (window.UISelectCustomers && typeof window.UISelectCustomers.pickIds === 'function') return;

    window.UISelectCustomers = {
      async pickIds() {
        if (typeof db === 'undefined' || !db) {
          alert('DB chưa sẵn sàng');
          return [];
        }

        // Build modal (match app UI)
        let modal = document.getElementById(PICKER_ID);
        if (!modal) {
          modal = document.createElement('div');
          modal.id = PICKER_ID;
          modal.className = 'fixed inset-0 z-[530] hidden items-center justify-center p-4 bg-black/80 backdrop-blur-sm';
          modal.innerHTML = `
            <div class="glass-panel w-full max-w-xl rounded-2xl p-5 sm:p-6 shadow-2xl border border-white/10 modal-animate overflow-auto max-h-[90vh] custom-scrollbar">
              <div class="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div class="text-lg font-extrabold" style="color: var(--text-main)">Chọn khách hàng để Backup QR</div>
                  <div class="text-xs opacity-75" style="color: var(--text-sub)">Bạn có thể tìm kiếm theo tên hoặc số điện thoại.</div>
                </div>
                <button type="button" id="qrCustPickerClose" class="p-2 rounded-full bg-white/10 hover:bg-white/15 active:scale-95 transition" aria-label="Đóng">
                  <i data-lucide="x" class="w-5 h-5" style="color: var(--text-sub)"></i>
                </button>
              </div>

              <div class="flex gap-2 items-center flex-wrap mb-4">
                <input id="qrCustPickerSearch" placeholder="Tìm theo tên / SĐT" class="flex-1 min-w-[220px] border rounded-xl px-4 py-3 outline-none font-bold" style="border-color: var(--border-panel);" />
                <button type="button" id="qrCustPickerSelectAll" class="px-4 py-3 rounded-xl font-bold active:scale-[0.98] transition-transform" style="background: rgba(255,255,255,0.06); color: var(--text-main); border: 1px solid var(--border-panel)">Chọn tất cả</button>
                <button type="button" id="qrCustPickerClear" class="px-4 py-3 rounded-xl font-bold active:scale-[0.98] transition-transform" style="background: rgba(255,255,255,0.06); color: var(--text-main); border: 1px solid var(--border-panel)">Bỏ chọn</button>
              </div>

              <div id="qrCustPickerList" class="flex flex-col gap-2"></div>

              <div class="flex items-center justify-between gap-3 mt-4">
                <div id="qrCustPickerCount" class="text-xs opacity-75" style="color: var(--text-sub)">0 đã chọn</div>
                <button type="button" id="qrCustPickerOk" class="px-5 py-3 rounded-xl font-extrabold text-white shadow-lg active:scale-[0.98] transition-transform" style="background: var(--accent-gradient)">Xác nhận</button>
              </div>
            </div>
          `;
          document.body.appendChild(modal);

          modal.addEventListener('click', (e) => {
            if (e.target === modal) {
              modal.classList.add('hidden');
              modal.classList.remove('flex');
            }
          });
          modal.querySelector('#qrCustPickerClose').addEventListener('click', () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
          });
        }

        const listEl = modal.querySelector('#qrCustPickerList');
        const searchEl = modal.querySelector('#qrCustPickerSearch');
        const countEl = modal.querySelector('#qrCustPickerCount');
        const selected = new Set();

        function setCount() {
          countEl.textContent = `${selected.size} đã chọn`;
        }

        const customers = await new Promise((resolve) => {
          try {
            const tx = db.transaction(['customers'], 'readonly');
            const store = tx.objectStore('customers');
            const req = store.getAll();
            req.onsuccess = (e) => resolve(e.target.result || []);
            req.onerror = () => resolve([]);
          } catch (e) {
            resolve([]);
          }
        });

        const rows = (customers || []).map((c) => {
          const id = String(c.id);
          let name = c.name;
          let phone = c.phone;
          try {
            if (typeof decryptText === 'function') {
              name = decryptText(name);
              phone = decryptText(phone);
            }
          } catch (e) {}
          return { id, name: name || '', phone: phone || '' };
        }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        function render(q) {
          const qq = (q || '').toLowerCase().trim();
          listEl.innerHTML = '';
          const filtered = qq ? rows.filter(r => (r.name || '').toLowerCase().includes(qq) || (r.phone || '').includes(qq)) : rows;
          if (filtered.length === 0) {
            listEl.innerHTML = `<div class="p-4 rounded-2xl border border-white/10 text-center text-xs opacity-80" style="color: var(--text-sub); background: rgba(255,255,255,0.04)">Không tìm thấy khách hàng</div>`;
            return;
          }

          filtered.forEach(r => {
            const item = document.createElement('label');
            item.className = 'flex items-center gap-3 rounded-2xl px-4 py-3 cursor-pointer active:scale-[0.99] transition-transform';
            item.style.border = '1px solid var(--border-panel)';
            item.style.background = 'rgba(255,255,255,0.04)';
            item.innerHTML = `
              <input type="checkbox" data-id="${r.id}" class="w-5 h-5" />
              <div class="flex-1 min-w-0">
                <div class="font-extrabold text-sm truncate" style="color: var(--text-main)">${escapeHTML(r.name || '')}</div>
                <div class="text-xs opacity-75" style="color: var(--text-sub)">${escapeHTML(r.phone || '')}</div>
              </div>
            `;
            const cb = item.querySelector('input');
            cb.checked = selected.has(r.id);
            cb.addEventListener('change', () => {
              if (cb.checked) selected.add(r.id); else selected.delete(r.id);
              setCount();
            });
            listEl.appendChild(item);
          });
        }

        render('');
        setCount();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        try {
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
          }
        } catch (e) {}
        searchEl.value = '';
        searchEl.oninput = () => render(searchEl.value);

        modal.querySelector('#qrCustPickerSelectAll').onclick = () => {
          rows.forEach(r => selected.add(r.id));
          render(searchEl.value);
          setCount();
        };
        modal.querySelector('#qrCustPickerClear').onclick = () => {
          selected.clear();
          render(searchEl.value);
          setCount();
        };

        return await new Promise((resolve) => {
          modal.querySelector('#qrCustPickerOk').onclick = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            resolve(Array.from(selected));
          };
          modal.querySelector('#qrCustPickerClose').onclick = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            resolve([]);
          };
        });
      }
    };
  }

  // Public API: Create QR
  window.openQrTransferBackup = async function () {
    ensureCustomerPicker();

    const scope = document.querySelector('#qrScope')?.value || 'all';
    let customerIds = [];
    if (scope === 'customers') {
      customerIds = await window.UISelectCustomers.pickIds();
      if (!customerIds.length) return alert('Chưa chọn khách hàng');
    }

    const frames = await window.QRTransferEncode.create({ scope, customerIds });
    if (!frames || !frames.length) return;

    const box = document.getElementById('qrBox');
    if (!box) {
      alert('Thiếu vùng hiển thị QR (#qrBox)');
      return;
    }
    box.innerHTML = '';

    const progressEl = document.getElementById('qrProgress');
    if (progressEl) progressEl.textContent = `${frames.length} QR`;

    frames.forEach((frame) => {
      const wrap = document.createElement('div');
      wrap.className = 'glass-panel rounded-2xl p-3 border border-white/10 flex flex-col items-center justify-center gap-2';

      const meta = document.createElement('div');
      meta.className = 'w-full flex items-center justify-between text-[11px] font-bold uppercase tracking-wider opacity-75';
      meta.style.color = 'var(--text-sub)';
      meta.innerHTML = `<span>Phần ${frame.index}/${frame.total}</span><span>${frame.scope === 'customers' ? '1 phần' : 'Toàn bộ'}</span>`;

      const qr = document.createElement('div');
      qr.className = 'bg-white rounded-xl p-2 w-full flex items-center justify-center';

      try {
        new QRCode(qr, {
          text: JSON.stringify(frame),
          width: 220,
          height: 220,
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (e) {
        new QRCode(qr, JSON.stringify(frame));
      }

      wrap.appendChild(meta);
      wrap.appendChild(qr);
      box.appendChild(wrap);
    });
  };

  // Public API: Restore from uploaded images
  window.handleQrImageUpload = async function (files) {
    if (!files || !files.length) return;
    if (!window.QRImageDecoder || typeof window.QRImageDecoder.decode !== 'function') {
      alert('Thiếu QRImageDecoder. Vui lòng đảm bảo assets/qrImageDecoder.js đã được load.');
      return;
    }
    for (const f of files) {
      const txt = await window.QRImageDecoder.decode(f);
      let obj;
      try {
        obj = JSON.parse(txt);
      } catch (e) {
        throw new Error('Ảnh QR không hợp lệ (không phải JSON)');
      }
      await window.QRTransferDecode.input(obj);
    }
  };
})();
