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

        // Build modal
        let modal = document.getElementById(PICKER_ID);
        if (!modal) {
          modal = document.createElement('div');
          modal.id = PICKER_ID;
          modal.style.position = 'fixed';
          modal.style.inset = '0';
          modal.style.zIndex = '9999';
          modal.style.background = 'rgba(0,0,0,0.55)';
          modal.style.display = 'none';
          modal.style.alignItems = 'center';
          modal.style.justifyContent = 'center';
          modal.style.padding = '12px';
          modal.innerHTML = `
            <div style="width:min(720px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.25);padding:14px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
                <div style="font-weight:800;font-size:16px">Chọn khách hàng để Backup QR</div>
                <button type="button" id="qrCustPickerClose" style="appearance:none;border:1px solid #ddd;background:#f7f7f7;border-radius:10px;padding:8px 10px;cursor:pointer">Đóng</button>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
                <input id="qrCustPickerSearch" placeholder="Tìm theo tên / SĐT" style="flex:1;min-width:220px;border:1px solid #ddd;border-radius:10px;padding:10px" />
                <button type="button" id="qrCustPickerSelectAll" style="appearance:none;border:1px solid #ddd;background:#f7f7f7;border-radius:10px;padding:10px 12px;cursor:pointer">Chọn tất cả</button>
                <button type="button" id="qrCustPickerClear" style="appearance:none;border:1px solid #ddd;background:#f7f7f7;border-radius:10px;padding:10px 12px;cursor:pointer">Bỏ chọn</button>
              </div>
              <div id="qrCustPickerList" style="display:flex;flex-direction:column;gap:8px"></div>
              <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:12px">
                <div id="qrCustPickerCount" style="font-size:12px;color:#666">0 đã chọn</div>
                <button type="button" id="qrCustPickerOk" style="appearance:none;border:1px solid #111;background:#111;color:#fff;border-radius:10px;padding:10px 14px;cursor:pointer;font-weight:700">Xác nhận</button>
              </div>
            </div>
          `;
          document.body.appendChild(modal);

          modal.addEventListener('click', (e) => {
            if (e.target === modal) {
              modal.style.display = 'none';
            }
          });
          modal.querySelector('#qrCustPickerClose').addEventListener('click', () => {
            modal.style.display = 'none';
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
            listEl.innerHTML = `<div style="padding:18px;border:1px dashed #ddd;border-radius:12px;color:#666;font-size:12px;text-align:center">Không tìm thấy khách hàng</div>`;
            return;
          }

          filtered.forEach(r => {
            const item = document.createElement('label');
            item.style.display = 'flex';
            item.style.gap = '10px';
            item.style.alignItems = 'center';
            item.style.border = '1px solid #eee';
            item.style.borderRadius = '12px';
            item.style.padding = '10px 12px';
            item.style.cursor = 'pointer';
            item.innerHTML = `
              <input type="checkbox" data-id="${r.id}" style="width:18px;height:18px" />
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(r.name || '')}</div>
                <div style="font-size:12px;color:#666">${escapeHTML(r.phone || '')}</div>
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
        modal.style.display = 'flex';
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
            modal.style.display = 'none';
            resolve(Array.from(selected));
          };
          modal.querySelector('#qrCustPickerClose').onclick = () => {
            modal.style.display = 'none';
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

    frames.forEach((frame) => {
      const div = document.createElement('div');
      try {
        new QRCode(div, {
          text: JSON.stringify(frame),
          width: 220,
          height: 220,
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (e) {
        // fallback minimal
        new QRCode(div, JSON.stringify(frame));
      }
      box.appendChild(div);
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
