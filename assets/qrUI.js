/*
QR Transfer Backup - UI glue

- Injects minimal modals for:
  1) Backup QR generation (shows QR frames + next/prev)
  2) Receiver status/progress + preview + restore confirm

- Exposes small hooks consumed by index.html buttons:
  window.openQrTransferBackup()
  window.openQrTransferScanner() (already defined in scanner)

This file does not touch existing app flows beyond adding new UI entry points.
*/

(function () {
  'use strict';

  function _getBackupSecret() {
    try {
      return (typeof APP_BACKUP_SECRET !== 'undefined' && APP_BACKUP_SECRET)
        ? APP_BACKUP_SECRET
        : (window.APP_BACKUP_SECRET || '');
    } catch (e) {
      return window.APP_BACKUP_SECRET || '';
    }
  }

  function _el(id) { return document.getElementById(id); }

  const UI = {
    frames: [],
    idx: 0,
    autoplay: null,
  };

  function injectModalsIfMissing() {
    if (_el('qr-transfer-modal')) return;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
<div id="qr-transfer-modal" class="fixed inset-0 z-[210] hidden">
  <div class="absolute inset-0 bg-black/70" onclick="closeQrTransferModal()"></div>
  <div class="relative w-full h-full flex items-end sm:items-center justify-center p-3">
    <div class="glass-panel w-full max-w-lg rounded-2xl border border-white/10 overflow-hidden">
      <div class="px-5 py-4 flex items-center justify-between border-b border-white/10">
        <div>
          <h3 class="text-lg font-bold" style="color: var(--text-main)">QR Transfer Backup</h3>
          <p id="qr-transfer-sub" class="text-xs opacity-70" style="color: var(--text-sub)">Tạo backup dạng QR (dữ liệu đã mã hóa).</p>
        </div>
        <button onclick="closeQrTransferModal()" class="p-2 rounded-xl hover:bg-white/10" style="color: var(--text-main)"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>

      <div class="p-5 space-y-4">
        <div id="qr-transfer-step-setup" class="space-y-3">
          <div class="grid grid-cols-2 gap-2">
            <button id="qr-size-small" class="py-3 rounded-xl font-bold border border-slate-600 bg-white/5" style="color: var(--text-main)">Nhỏ</button>
            <button id="qr-size-medium" class="py-3 rounded-xl font-bold border border-slate-600 bg-white/5" style="color: var(--text-main)">Vừa</button>
          </div>
          <p class="text-xs opacity-70" style="color: var(--text-sub)">Nhỏ: chỉ khách hàng (không TSBĐ). Vừa: khách hàng + TSBĐ. Ảnh không kèm theo.</p>
          <button id="qr-generate-btn" class="w-full py-3.5 rounded-xl font-bold text-white" style="background: var(--accent-gradient)">Tạo QR</button>
          <div id="qr-transfer-setup-msg" class="text-xs opacity-70" style="color: var(--text-sub)"></div>
        </div>

        <div id="qr-transfer-step-show" class="hidden space-y-4">
          <div class="flex items-center justify-between">
            <div id="qr-transfer-frame-label" class="text-xs font-bold opacity-80" style="color: var(--text-sub)"></div>
            <div class="flex gap-2">
              <button id="qr-prev" class="px-3 py-2 rounded-xl bg-white/5 border border-white/10" style="color: var(--text-main)">Trước</button>
              <button id="qr-next" class="px-3 py-2 rounded-xl bg-white/5 border border-white/10" style="color: var(--text-main)">Sau</button>
            </div>
          </div>
          <div class="w-full flex items-center justify-center">
            <div id="qr-transfer-qrcode" class="p-4 rounded-2xl bg-white"></div>
          </div>
          <div class="flex gap-2">
            <button id="qr-autoplay" class="flex-1 py-3 rounded-xl font-bold bg-white/5 border border-white/10" style="color: var(--text-main)">Tự chạy</button>
            <button id="qr-copy" class="flex-1 py-3 rounded-xl font-bold bg-white/5 border border-white/10" style="color: var(--text-main)">Copy frame</button>
          </div>
          <div id="qr-transfer-show-msg" class="text-xs opacity-70" style="color: var(--text-sub)"></div>
        </div>

        <div id="qr-transfer-step-recv" class="hidden space-y-3">
          <div class="text-sm font-bold" style="color: var(--text-main)">Đang nhận dữ liệu...</div>
          <div id="qr-recv-progress" class="text-xs opacity-70" style="color: var(--text-sub)"></div>
          <div class="h-2 rounded-full bg-white/10 overflow-hidden">
            <div id="qr-recv-bar" class="h-2 rounded-full" style="width: 0%; background: var(--accent-gradient)"></div>
          </div>
          <div id="qr-recv-actions" class="hidden space-y-3">
            <div id="qr-recv-preview" class="p-3 rounded-xl bg-black/20 border border-white/10"></div>
            <button id="qr-restore-btn" class="w-full py-3.5 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition">Restore ngay</button>
            <button id="qr-recv-reset" class="w-full py-3 rounded-xl font-bold bg-white/5 border border-white/10" style="color: var(--text-main)">Hủy nhận</button>
          </div>
        </div>
      </div>

      <div class="px-5 py-4 border-t border-white/10">
        <div class="text-[11px] opacity-60" style="color: var(--text-sub)">QR Transfer chỉ hoạt động khi có mạng để xác thực quyền Backup/Restore.</div>
      </div>
    </div>
  </div>
</div>`;

    document.body.appendChild(wrap.firstElementChild);

    // Setup handlers
    const btnS = _el('qr-size-small');
    const btnM = _el('qr-size-medium');
    let chosen = 'small';

    function setChosen(v) {
      chosen = v;
      [btnS, btnM].forEach((b) => b.classList.remove('ring-2', 'ring-emerald-400'));
      const active = v === 'small' ? btnS : btnM;
      active.classList.add('ring-2', 'ring-emerald-400');
    }

    btnS.addEventListener('click', () => setChosen('small'));
    btnM.addEventListener('click', () => setChosen('medium'));
    setChosen('small');

    _el('qr-generate-btn').addEventListener('click', async () => {
      await generateQrFrames(chosen);
    });

    _el('qr-prev').addEventListener('click', () => showFrame(UI.idx - 1));
    _el('qr-next').addEventListener('click', () => showFrame(UI.idx + 1));
    _el('qr-autoplay').addEventListener('click', () => toggleAutoplay());
    _el('qr-copy').addEventListener('click', () => copyCurrentFrame());

    _el('qr-restore-btn').addEventListener('click', async () => {
      await restoreReceived();
    });

    _el('qr-recv-reset').addEventListener('click', () => {
      if (window.QRTransferDecode) window.QRTransferDecode.reset();
      renderRecvProgress();
      _el('qr-recv-actions').classList.add('hidden');
      _el('qr-recv-preview').innerHTML = '';
    });
  }

  function openModal(mode) {
    injectModalsIfMissing();
    const modal = _el('qr-transfer-modal');
    if (!modal) return;

    // reset view
    _el('qr-transfer-step-setup').classList.add('hidden');
    _el('qr-transfer-step-show').classList.add('hidden');
    _el('qr-transfer-step-recv').classList.add('hidden');

    if (mode === 'send') {
      _el('qr-transfer-sub').textContent = 'Tạo backup dạng QR (dữ liệu đã mã hóa).';
      _el('qr-transfer-step-setup').classList.remove('hidden');
    } else {
      _el('qr-transfer-sub').textContent = 'Nhận backup bằng QR. Dữ liệu chỉ giải mã sau khi xác thực quyền.';
      _el('qr-transfer-step-recv').classList.remove('hidden');
      renderRecvProgress();
    }

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  function closeModal() {
    const modal = _el('qr-transfer-modal');
    if (modal) modal.classList.add('hidden');
    stopAutoplay();
  }

  async function generateQrFrames(size) {
    const msg = _el('qr-transfer-setup-msg');
    msg.textContent = '';

    try {
      if (!window.QRTransferEncode) throw new Error('QRTransferEncode missing');

      // Permission gate: must validate with server to obtain APP_BACKUP_SECRET
      if (typeof ensureBackupSecret === 'function') {
        const sec = await ensureBackupSecret();
        if (!sec || !sec.ok || !_getBackupSecret()) {
          msg.textContent = `BẢO MẬT: ${sec && sec.message ? sec.message : 'Không thể xác thực.'}`;
          return;
        }
      } else {
        msg.textContent = 'Thiếu ensureBackupSecret().';
        return;
      }

      // Build frames
      const out = await window.QRTransferEncode.buildFrames({ size });
      if (out && out.fallbackToFile) {
        // fallback uses existing file backup
        showToast('Dữ liệu lớn, chuyển sang backup file như hiện tại.');
        closeModal();
        if (typeof backupData === 'function') await backupData();
        return;
      }

      UI.frames = out.frames || [];
      UI.idx = 0;

      _el('qr-transfer-step-setup').classList.add('hidden');
      _el('qr-transfer-step-show').classList.remove('hidden');

      _el('qr-transfer-show-msg').textContent = out.info || '';
      showFrame(0);

    } catch (e) {
      console.error(e);
      msg.textContent = 'Lỗi tạo QR. Vui lòng thử lại.';
    }
  }

  function clearQrNode() {
    const node = _el('qr-transfer-qrcode');
    if (!node) return;
    node.innerHTML = '';
  }

  function showFrame(i) {
    if (!UI.frames || UI.frames.length === 0) return;
    if (i < 0) i = 0;
    if (i >= UI.frames.length) i = UI.frames.length - 1;
    UI.idx = i;

    const label = _el('qr-transfer-frame-label');
    label.textContent = `Frame ${i + 1} / ${UI.frames.length}`;

    clearQrNode();
    const node = _el('qr-transfer-qrcode');
    const text = UI.frames[i];

    // QRCode.js
    try {
      // eslint-disable-next-line no-undef
      new QRCode(node, {
        text,
        width: 240,
        height: 240,
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (e) {
      console.error(e);
      _el('qr-transfer-show-msg').textContent = 'Không tạo được QR (thiếu thư viện QRCode).';
    }
  }

  function toggleAutoplay() {
    if (UI.autoplay) {
      stopAutoplay();
      return;
    }
    const btn = _el('qr-autoplay');
    btn.textContent = 'Dừng';
    UI.autoplay = setInterval(() => {
      if (!UI.frames || UI.frames.length === 0) return;
      const next = (UI.idx + 1) % UI.frames.length;
      showFrame(next);
    }, 900);
  }

  function stopAutoplay() {
    if (UI.autoplay) {
      clearInterval(UI.autoplay);
      UI.autoplay = null;
    }
    const btn = _el('qr-autoplay');
    if (btn) btn.textContent = 'Tự chạy';
  }

  async function copyCurrentFrame() {
    try {
      const text = UI.frames && UI.frames[UI.idx] ? UI.frames[UI.idx] : '';
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast('Đã copy QR frame');
      }
    } catch (e) {
      // ignore
    }
  }

  function renderRecvProgress() {
    if (!window.QRTransferDecode) return;
    const st = window.QRTransferDecode.getStatus();

    const p = _el('qr-recv-progress');
    const bar = _el('qr-recv-bar');
    if (!p || !bar) return;

    if (!st || !st.active) {
      p.textContent = 'Chưa có dữ liệu. Bấm “Quét QR Restore” để bắt đầu.';
      bar.style.width = '0%';
      return;
    }

    const pct = st.total > 0 ? Math.floor((st.got / st.total) * 100) : 0;
    p.textContent = `Transfer ${st.transferId}: ${st.got}/${st.total} frame (${pct}%).`;
    bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;

    if (st.complete) {
      p.textContent = `Đã nhận đủ ${st.total} frame. Đang xác thực quyền để giải mã...`;
    }
  }

  async function restoreReceived() {
    const previewEl = _el('qr-recv-preview');
    previewEl.innerHTML = '';

    try {
      if (!window.QRTransferDecode) throw new Error('QRTransferDecode missing');

      // Permission gate: must validate with server to obtain APP_BACKUP_SECRET
      const sec = await ensureBackupSecret();
      if (!sec || !sec.ok || !_getBackupSecret()) {
        previewEl.innerHTML = `<div class="text-xs text-red-300">BẢO MẬT: ${sec && sec.message ? sec.message : 'Không thể xác thực.'}</div>`;
        return;
      }

      const out = await window.QRTransferDecode.decryptAndParse();
      if (!out || !out.data) {
        previewEl.innerHTML = `<div class="text-xs text-red-300">Không giải mã được dữ liệu.</div>`;
        return;
      }

      // Preview
      previewEl.innerHTML = out.previewHtml || '';

      if (!confirm('Xác nhận Restore dữ liệu từ QR? Dữ liệu hiện tại sẽ được thay thế.')) return;

      const ok = await window.QRTransferDecode.restoreTransactional(out.data);
      if (ok) {
        showToast('Đã Restore từ QR');
        closeModal();
        try { loadCustomers(); } catch (e) {}
      } else {
        alert('Restore thất bại. Dữ liệu hiện tại được giữ nguyên.');
      }
    } catch (e) {
      console.error(e);
      alert('Lỗi Restore từ QR.');
    }
  }

  // Exposed hooks
  window.openQrTransferBackup = function () {
    openModal('send');
  };

  // openQrTransferScanner is defined in assets/09_qr_scanner_camera.js
  // We only attach helper to show receiver modal and keep progress updated.
  window.openQrTransferReceiverUI = function () {
    openModal('recv');
  };

  window.closeQrTransferModal = function () {
    closeModal();
  };

  // Decoder -> UI callbacks
  function wireDecoderCallbacks() {
    if (!window.QRTransferDecode) return;
    window.QRTransferDecode.onProgress = function (status) {
      try {
        openModal('recv');
        renderRecvProgress();

        if (status && status.complete) {
          const actions = _el('qr-recv-actions');
          if (actions) actions.classList.remove('hidden');
          const previewEl = _el('qr-recv-preview');
          if (previewEl) previewEl.innerHTML = '<div class="text-xs opacity-70">Đã nhận đủ. Bấm “Restore ngay” để xác thực và giải mã.</div>';
        }
      } catch (e) {}
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectModalsIfMissing();
    wireDecoderCallbacks();
  });
})();
