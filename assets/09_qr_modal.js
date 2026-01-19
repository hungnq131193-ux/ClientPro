/**
 * 09_qr_modal.js
 * QR Transfer modal UI (create / import) – designed as an OPTIONAL layer.
 * - Does not assume any framework.
 * - Calls existing hooks if present:
 *   - window.openQrTransferBackup() for creating QR
 *   - window.handleQrImageUpload(files) for importing QR images
 *
 * Expected elements (will be created if missing):
 *   - #qrModal (overlay)
 *   - #qrBox (container for generated QR frames)
 *   - #qrScope (select: all/customers)
 *
 * Usage:
 *   - call window.openQrModal() to show
 *   - call window.closeQrModal() to hide
 */
(function () {
  const MODAL_ID = 'qrModal';
  const STYLE_ID = 'qrModalStyle';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID}{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:none;align-items:center;justify-content:center;padding:14px}
      #${MODAL_ID}.show{display:flex}
      #${MODAL_ID} .panel{width:min(920px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.25);padding:14px}
      #${MODAL_ID} .head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
      #${MODAL_ID} .title{font-weight:700;font-size:16px}
      #${MODAL_ID} .btn{appearance:none;border:1px solid #ddd;background:#f7f7f7;border-radius:10px;padding:8px 10px;cursor:pointer}
      #${MODAL_ID} .btn.primary{background:#111;color:#fff;border-color:#111}
      #${MODAL_ID} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0}
      #${MODAL_ID} select,#${MODAL_ID} input[type="file"]{border:1px solid #ddd;border-radius:10px;padding:8px}
      #${MODAL_ID} .hint{font-size:12px;color:#666}
      #${MODAL_ID} #qrBox{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:12px}
      #${MODAL_ID} #qrBox > div{display:flex;align-items:center;justify-content:center;border:1px dashed #ddd;border-radius:12px;min-height:200px;padding:8px}
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    ensureStyle();

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" aria-label="QR Transfer Backup">
        <div class="head">
          <div class="title">QR Transfer Backup</div>
          <button class="btn" id="qrModalCloseBtn" type="button">Đóng</button>
        </div>

        <div class="row">
          <label class="hint">Chế độ:</label>
          <select id="qrScope">
            <option value="all">Backup toàn bộ</option>
            <option value="customers">Backup khách hàng đã chọn</option>
          </select>

          <button class="btn primary" id="qrCreateBtn" type="button">Tạo QR</button>
        </div>

        <div class="row">
          <label class="hint">Nhập ảnh QR từ thư viện (máy B):</label>
          <input id="qrImgInput" type="file" accept="image/*" multiple />
        </div>

        <div class="hint">
          Gợi ý: Nếu dữ liệu quá lớn, app sẽ tự chuyển sang cơ chế backup file như hiện tại (nếu bạn đã bật cơ chế đó trong qrEncode/qrUI).
        </div>

        <div id="qrBox"></div>
      </div>
    `;

    document.body.appendChild(modal);

    // close handlers
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeQrModal();
    });
    modal.querySelector('#qrModalCloseBtn').addEventListener('click', closeQrModal);

    // actions
    modal.querySelector('#qrCreateBtn').addEventListener('click', async () => {
      try {
        // If app's openQrTransferBackup reads #qrScope, it will pick up the user's selection.
        if (typeof window.openQrTransferBackup === 'function') {
          await window.openQrTransferBackup();
        } else {
          alert('Thiếu hàm openQrTransferBackup(). Vui lòng đảm bảo assets/qrUI.js đã được load.');
        }
      } catch (err) {
        alert('Không thể tạo QR: ' + (err && err.message ? err.message : err));
      }
    });

    modal.querySelector('#qrImgInput').addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files || !files.length) return;
      try {
        if (typeof window.handleQrImageUpload === 'function') {
          await window.handleQrImageUpload(files);
        } else {
          alert('Thiếu hàm handleQrImageUpload(). Vui lòng đảm bảo assets/qrUI.js đã được load.');
        }
      } catch (err) {
        alert('Không thể đọc ảnh QR: ' + (err && err.message ? err.message : err));
      } finally {
        e.target.value = '';
      }
    });

    return modal;
  }

  function openQrModal() {
    const modal = ensureModal();
    modal.classList.add('show');
  }

  function closeQrModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.classList.remove('show');
  }

  // expose
  window.openQrModal = openQrModal;
  window.closeQrModal = closeQrModal;
})();