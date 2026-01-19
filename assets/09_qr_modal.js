/**
 * 09_qr_modal.js
 * QR Transfer Backup modal (create / import via image upload).
 *
 * Goals:
 * - Match the app's existing UI (glass-panel + tailwind utility classes already used in index.html)
 * - Do NOT use camera scanning (restore = upload QR image from library)
 * - Keep logic isolated: call window.openQrTransferBackup() and window.handleQrImageUpload(files)
 */

(function () {
  const MODAL_ID = 'qrModal';

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'fixed inset-0 z-[520] hidden items-center justify-center p-4 bg-black/80 backdrop-blur-sm';

    modal.innerHTML = `
      <div class="glass-panel w-full max-w-lg rounded-2xl p-5 sm:p-6 shadow-2xl border border-white/10 modal-animate">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-lg sm:text-xl font-extrabold tracking-tight" style="color: var(--text-main)">QR Transfer Backup</h3>
            <p class="text-xs sm:text-sm mt-1 opacity-80" style="color: var(--text-sub)">Tạo QR ciphertext để chuyển dữ liệu sang máy khác. Restore bằng cách chọn ảnh QR từ thư viện.</p>
          </div>
          <button id="qrModalCloseBtn" type="button" class="p-2 rounded-full bg-white/10 hover:bg-white/15 active:scale-95 transition" aria-label="Đóng">
            <i data-lucide="x" class="w-5 h-5" style="color: var(--text-sub)"></i>
          </button>
        </div>

        <div class="mt-5 space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div class="sm:col-span-2">
              <label class="block text-[11px] font-bold uppercase tracking-wider mb-2 opacity-70" style="color: var(--text-sub)">Chế độ</label>
              <select id="qrScope" class="w-full border rounded-xl px-4 py-3 outline-none font-bold" style="border-color: var(--border-panel);">
                <option value="all">Backup toàn bộ</option>
                <option value="customers">Backup 1 phần khách hàng</option>
              </select>
            </div>
            <button id="qrCreateBtn" type="button" class="w-full py-3 rounded-xl font-extrabold text-white shadow-lg active:scale-[0.98] transition-transform" style="background: var(--accent-gradient)">Tạo QR</button>
          </div>

          <div class="glass-panel rounded-2xl p-4 border border-white/10">
            <div class="flex items-center justify-between gap-3 mb-3">
              <div>
                <div class="text-sm font-extrabold" style="color: var(--text-main)">Restore QR (chọn ảnh từ thư viện)</div>
                <div class="text-xs opacity-75" style="color: var(--text-sub)">Chọn nhiều ảnh nếu QR bị chia thành nhiều phần.</div>
              </div>
            </div>
            <label class="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold cursor-pointer active:scale-[0.98] transition-transform" style="background: rgba(255,255,255,0.06); color: var(--text-main); border: 1px solid var(--border-panel)">
              <i data-lucide="image" class="w-5 h-5"></i>
              <span>Chọn ảnh QR</span>
              <input id="qrImgInput" type="file" accept="image/*" multiple class="hidden" />
            </label>
            <div class="text-[11px] mt-3 opacity-75" style="color: var(--text-sub)">
              Gợi ý: Nếu dữ liệu quá lớn, app sẽ tự chuyển sang cơ chế backup file (.cpb) như hiện tại.
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <div class="text-sm font-extrabold" style="color: var(--text-main)">Mã QR đã tạo</div>
              <div id="qrProgress" class="text-xs opacity-70" style="color: var(--text-sub)"></div>
            </div>
            <div id="qrBox" class="grid grid-cols-2 sm:grid-cols-3 gap-3"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Overlay click closes
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeQrModal();
    });

    modal.querySelector('#qrModalCloseBtn').addEventListener('click', closeQrModal);

    modal.querySelector('#qrCreateBtn').addEventListener('click', async () => {
      try {
        const progressEl = modal.querySelector('#qrProgress');
        if (progressEl) progressEl.textContent = '';

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
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    } catch (e) {}
  }

  function closeQrModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  window.openQrModal = openQrModal;
  window.closeQrModal = closeQrModal;
})();
