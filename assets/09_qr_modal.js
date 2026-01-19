/**
 * 09_qr_modal.js
 * QR Transfer modal UI (create / import)
 * - Uses app-like "glass" styling.
 * - Hooks:
 *   - window.openQrTransferBackup()
 *   - window.handleQrImageUpload(files)
 *   - window.shareQrTransfer()
 *   - window.downloadQrTransfer()
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
      #${MODAL_ID} .panel{width:min(980px,100%);max-height:90vh;overflow:auto;border-radius:18px;padding:14px;
        background:rgba(15,23,42,.92);color:#e5e7eb;border:1px solid rgba(255,255,255,.10);box-shadow:0 18px 60px rgba(0,0,0,.35)}
      #${MODAL_ID} .head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
      #${MODAL_ID} .title{font-weight:800;font-size:16px;letter-spacing:.2px}
      #${MODAL_ID} .btn{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#e5e7eb;border-radius:12px;padding:9px 12px;cursor:pointer}
      #${MODAL_ID} .btn.primary{background:rgba(16,185,129,.20);border-color:rgba(16,185,129,.35)}
      #${MODAL_ID} .btn.danger{background:rgba(239,68,68,.18);border-color:rgba(239,68,68,.35)}
      #${MODAL_ID} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0}
      #${MODAL_ID} .row .spacer{flex:1}
      #${MODAL_ID} select,#${MODAL_ID} input[type="file"]{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e5e7eb;border-radius:12px;padding:9px 10px}
      #${MODAL_ID} .hint{font-size:12px;color:rgba(229,231,235,.75)}
      #${MODAL_ID} #qrBox{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:12px}
      #${MODAL_ID} .qr-frame{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:10px}
      #${MODAL_ID} .qr-label{font-weight:700;font-size:12px;color:rgba(229,231,235,.85);margin-bottom:8px;display:flex;justify-content:space-between}
      #${MODAL_ID} .qr-holder{display:flex;align-items:center;justify-content:center;background:#fff;border-radius:14px;padding:10px}
      @media (max-width:480px){
        #${MODAL_ID} #qrBox{grid-template-columns:1fr}
      }
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
          <button class="btn danger" id="qrModalCloseBtn" type="button">Đóng</button>
        </div>

        <div class="row">
          <label class="hint">Chế độ:</label>
          <select id="qrScope">
            <option value="all">Backup toàn bộ</option>
            <option value="customers">Backup khách hàng đã chọn</option>
          </select>

          <button class="btn primary" id="qrCreateBtn" type="button">Tạo QR</button>
          <button class="btn" id="qrShareBtn" type="button">Gửi QR</button>
          <button class="btn" id="qrDownloadBtn" type="button">Lưu ảnh</button>
        </div>

        <div class="row">
          <label class="hint">Restore QR bằng ảnh (máy B):</label>
          <input id="qrImgInput" type="file" accept="image/*" multiple />
        </div>

        <div class="hint">
          Gợi ý: Nếu dữ liệu lớn, app sẽ tự chia nhiều QR. Bạn có thể bấm “Gửi QR” để xuất ảnh và gửi qua Zalo/Mail.
        </div>

        <div id="qrBox"></div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeQrModal();
    });
    modal.querySelector('#qrModalCloseBtn').addEventListener('click', closeQrModal);

    modal.querySelector('#qrCreateBtn').addEventListener('click', async () => {
      try {
        if (typeof window.openQrTransferBackup === 'function') {
          await window.openQrTransferBackup();
        } else {
          alert('Thiếu openQrTransferBackup(). Hãy đảm bảo qrUI.js đã được load.');
        }
      } catch (err) {
        alert('Không thể tạo QR: ' + (err && err.message ? err.message : err));
      }
    });

    modal.querySelector('#qrShareBtn').addEventListener('click', async () => {
      try {
        if (typeof window.shareQrTransfer === 'function') {
          await window.shareQrTransfer();
        } else {
          alert('Thiếu shareQrTransfer(). Hãy đảm bảo qrUI.js đã được load.');
        }
      } catch (err) {
        alert('Không thể gửi QR: ' + (err && err.message ? err.message : err));
      }
    });

    modal.querySelector('#qrDownloadBtn').addEventListener('click', async () => {
      try {
        if (typeof window.downloadQrTransfer === 'function') {
          await window.downloadQrTransfer();
        } else {
          alert('Thiếu downloadQrTransfer(). Hãy đảm bảo qrUI.js đã được load.');
        }
      } catch (err) {
        alert('Không thể lưu ảnh QR: ' + (err && err.message ? err.message : err));
      }
    });

    modal.querySelector('#qrImgInput').addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files || !files.length) return;
      try {
        if (typeof window.handleQrImageUpload === 'function') {
          await window.handleQrImageUpload(files);
        } else {
          alert('Thiếu handleQrImageUpload(). Hãy đảm bảo qrUI.js đã được load.');
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

  window.openQrModal = openQrModal;
  window.closeQrModal = closeQrModal;
})();
