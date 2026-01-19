/**
 * 09_qr_modal.js
 * Transfer Backup modal UI (Text chunks only)
 * - Create: generates ciphertext chunks and shows Copy/Share controls
 * - Receive: paste chunks (one or many) and restore
 *
 * Hooks required:
 *   - window.openQrTransferBackup()          (create)
 *   - window.copyAllTransferText()           (copy all)
 *   - window.shareAllTransferText()          (share all)
 *   - window.importTransferText()            (receive)
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
      #${MODAL_ID} .btn.ghost{background:transparent}
      #${MODAL_ID} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0}
      #${MODAL_ID} .tabs{display:flex;gap:8px;margin:6px 0 12px}
      #${MODAL_ID} .tab{padding:8px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);cursor:pointer;font-weight:700;font-size:12px;opacity:.8}
      #${MODAL_ID} .tab.active{opacity:1;background:rgba(59,130,246,.18);border-color:rgba(59,130,246,.35)}
      #${MODAL_ID} select{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e5e7eb;border-radius:12px;padding:9px 10px}
      #${MODAL_ID} .hint{font-size:12px;color:rgba(229,231,235,.75)}
      #${MODAL_ID} .meta{font-size:12px;color:rgba(229,231,235,.85);margin-top:6px}
      #${MODAL_ID} #qrBox{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px;margin-top:12px}
      #${MODAL_ID} .txt-frame{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:10px}
      #${MODAL_ID} .txt-label{font-weight:700;font-size:12px;color:rgba(229,231,235,.90);margin-bottom:8px;display:flex;justify-content:space-between;gap:10px}
      #${MODAL_ID} .txt-label .muted{opacity:.7;font-weight:600}
      #${MODAL_ID} .txt-area{width:100%;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:#e5e7eb;border-radius:12px;padding:10px;font-size:12px;line-height:1.35;white-space:pre-wrap;word-break:break-all}
      #${MODAL_ID} .txt-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap}
      #${MODAL_ID} .import-area{width:100%;min-height:140px}
      #${MODAL_ID} .section{display:none}
      #${MODAL_ID} .section.show{display:block}
      @media (max-width:480px){ #${MODAL_ID} #qrBox{grid-template-columns:1fr} }
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
      <div class="panel" role="dialog" aria-modal="true" aria-label="Transfer Backup">
        <div class="head">
          <div>
            <div class="title">Transfer Backup (Text)</div>
            <div class="hint">Dữ liệu là ciphertext đã mã hóa. Người ngoài copy cũng không đọc được.</div>
          </div>
          <button class="btn danger" id="qrModalCloseBtn" type="button">Đóng</button>
        </div>

        <div class="tabs">
          <button type="button" class="tab active" data-tab="create">Tạo Transfer</button>
          <button type="button" class="tab" data-tab="receive">Nhận Transfer</button>
        </div>

        <div id="qrCreateSection" class="section show">
          <div class="row">
            <label class="hint">Chế độ:</label>
            <select id="qrScope">
              <option value="all">Backup toàn bộ</option>
              <option value="customers">Backup khách hàng đã chọn</option>
            </select>

            <button class="btn primary" id="qrCreateBtn" type="button">Tạo</button>
            <button class="btn" id="qrCopyAllBtn" type="button">Copy tất cả</button>
            <button class="btn" id="qrShareAllBtn" type="button">Gửi tất cả</button>
          </div>

          <div class="hint">
            Máy A: bấm Tạo, sau đó Copy/Gửi. Máy B: chuyển sang tab Nhận Transfer và dán nội dung.
          </div>
          <div class="meta" id="qrMeta"></div>
          <div id="qrBox"></div>
        </div>

        <div id="qrReceiveSection" class="section">
          <div class="hint">Dán 1 đoạn hoặc nhiều đoạn (mỗi đoạn là 1 dòng JSON). App sẽ tự ghép đủ và restore.</div>
          <div class="row">
            <button class="btn primary" id="qrImportBtn" type="button">Nhận</button>
            <button class="btn ghost" id="qrClearImportBtn" type="button">Xóa nội dung</button>
            <div class="spacer"></div>
            <div class="hint" id="qrImportStatus"></div>
          </div>
          <textarea id="qrImportText" class="txt-area import-area" placeholder='Dán nội dung Transfer tại đây...'></textarea>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeQrModal();
    });
    modal.querySelector('#qrModalCloseBtn').addEventListener('click', closeQrModal);

    // Tabs
    const tabs = Array.from(modal.querySelectorAll('.tab'));
    const createSec = modal.querySelector('#qrCreateSection');
    const recvSec = modal.querySelector('#qrReceiveSection');
    function setTab(name) {
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
      createSec.classList.toggle('show', name === 'create');
      recvSec.classList.toggle('show', name === 'receive');
    }
    tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

    // Actions
    modal.querySelector('#qrCreateBtn').addEventListener('click', async () => {
      try {
        if (typeof window.openQrTransferBackup === 'function') {
          await window.openQrTransferBackup();
        } else {
          alert('Thiếu openQrTransferBackup(). Hãy đảm bảo qrUI.js đã được load.');
        }
      } catch (err) {
        alert('Không thể tạo Transfer: ' + (err && err.message ? err.message : err));
      }
    });

    modal.querySelector('#qrCopyAllBtn').addEventListener('click', async () => {
      try {
        if (typeof window.copyAllTransferText === 'function') {
          await window.copyAllTransferText();
        } else {
          alert('Thiếu copyAllTransferText().');
        }
      } catch (err) {
        alert('Không thể copy: ' + (err && err.message ? err.message : err));
      }
    });

    modal.querySelector('#qrShareAllBtn').addEventListener('click', async () => {
      try {
        if (typeof window.shareAllTransferText === 'function') {
          await window.shareAllTransferText();
        } else {
          alert('Thiếu shareAllTransferText().');
        }
      } catch (err) {
        alert('Không thể gửi: ' + (err && err.message ? err.message : err));
      }
    });

    modal.querySelector('#qrImportBtn').addEventListener('click', async () => {
      try {
        if (typeof window.importTransferText === 'function') {
          await window.importTransferText();
        } else {
          alert('Thiếu importTransferText().');
        }
      } catch (err) {
        alert('Không thể nhận: ' + (err && err.message ? err.message : err));
      }
    });

    modal.querySelector('#qrClearImportBtn').addEventListener('click', () => {
      const ta = modal.querySelector('#qrImportText');
      if (ta) ta.value = '';
      const st = modal.querySelector('#qrImportStatus');
      if (st) st.textContent = '';
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
