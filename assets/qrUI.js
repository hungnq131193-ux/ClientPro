/*
 * qrUI.js
 * UI glue for Transfer Backup (Text chunks)
 * - No QR image generation/decoding.
 * - Chunks are JSON strings (ciphertext-only) that user can Copy/Share/Paste.
 */
(function () {
  const uiState = {
    chunks: [],
    scope: 'all',
    customerIds: [],
    activeTransferId: ''
  };

  function $(sel) { return document.querySelector(sel); }

  function resetCreated() {
    uiState.chunks = [];
    uiState.activeTransferId = '';
    const box = document.getElementById('qrBox');
    if (box) box.innerHTML = '';
    const meta = document.getElementById('qrMeta');
    if (meta) meta.textContent = '';
  }

  function stringifyChunk(c) {
    // Keep stable ordering for readability
    return JSON.stringify({
      transfer_id: c.transfer_id,
      index: c.index,
      total: c.total,
      createdAt: c.createdAt,
      scope: c.scope,
      data: c.data
    });
  }

  function renderChunks(chunks) {
    const box = document.getElementById('qrBox');
    if (!box) throw new Error('Thiếu #qrBox');
    box.innerHTML = '';

    chunks.forEach((c) => {
      const str = stringifyChunk(c);

      const frame = document.createElement('div');
      frame.className = 'txt-frame';

      const head = document.createElement('div');
      head.className = 'txt-label';
      head.innerHTML = `<span>ĐOẠN ${c.index}/${c.total}</span><span class="muted">${c.transfer_id}</span>`;

      const ta = document.createElement('textarea');
      ta.className = 'txt-area';
      ta.readOnly = true;
      ta.value = str;
      ta.rows = 5;

      const actions = document.createElement('div');
      actions.className = 'txt-actions';

      const btnCopy = document.createElement('button');
      btnCopy.type = 'button';
      btnCopy.className = 'btn';
      btnCopy.textContent = 'Copy đoạn';
      btnCopy.addEventListener('click', async () => {
        await copyText(str);
        toast('Đã copy đoạn ' + c.index + '/' + c.total);
      });

      const btnShare = document.createElement('button');
      btnShare.type = 'button';
      btnShare.className = 'btn';
      btnShare.textContent = 'Gửi';
      btnShare.addEventListener('click', async () => {
        await shareText(str);
      });

      actions.appendChild(btnCopy);
      actions.appendChild(btnShare);

      frame.appendChild(head);
      frame.appendChild(ta);
      frame.appendChild(actions);
      box.appendChild(frame);
    });
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  async function shareText(text) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'ClientPro Transfer Backup',
          text
        });
        return;
      } catch (e) {
        // user cancelled or not supported
      }
    }
    await copyText(text);
    alert('Thiết bị không hỗ trợ chia sẻ trực tiếp. App đã copy nội dung để bạn dán qua Zalo/Mail.');
  }

  function toast(msg) {
    if (typeof showToast === 'function') return showToast(msg);
    // fallback
    try { console.log('[toast]', msg); } catch (e) {}
  }

  function parseChunksFromText(raw) {
    const text = (raw || '').trim();
    if (!text) return [];

    // 1) If user pasted multiple JSON lines
    const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const chunks = [];
    const tryParse = (s) => {
      try { return JSON.parse(s); } catch (e) { return null; }
    };

    if (lines.length > 1) {
      for (const ln of lines) {
        const obj = tryParse(ln);
        if (obj) chunks.push(obj);
      }
      if (chunks.length) return chunks;
    }

    // 2) If user pasted a JSON array
    const obj = tryParse(text);
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === 'object') return [obj];
    return [];
  }

  window.openQrTransferBackup = async function () {
    resetCreated();

    const scope = ($('#qrScope') && $('#qrScope').value) || 'all';
    let customerIds = [];
    if (scope === 'customers') {
      customerIds = await UISelectCustomers.pickIds();
      if (!customerIds.length) return alert('Chưa chọn khách hàng');
    }

    // Text transfer allows bigger chunks (copy/paste friendly)
    const chunks = await QRTransferEncode.create({ scope, customerIds, maxQrText: 12000 });

    uiState.chunks = chunks;
    uiState.scope = scope;
    uiState.customerIds = customerIds;
    uiState.activeTransferId = (chunks[0] && chunks[0].transfer_id) ? chunks[0].transfer_id : '';

    const meta = document.getElementById('qrMeta');
    if (meta) {
      meta.textContent = uiState.activeTransferId
        ? ('Transfer ID: ' + uiState.activeTransferId + ' • ' + chunks.length + ' đoạn')
        : ('' + chunks.length + ' đoạn');
    }

    renderChunks(chunks);
  };

  window.copyAllTransferText = async function () {
    if (!uiState.chunks.length) return alert('Chưa có dữ liệu để copy');
    const all = uiState.chunks.map(stringifyChunk).join('\n');
    await copyText(all);
    alert('Đã copy toàn bộ (' + uiState.chunks.length + ' đoạn). Dán sang máy B để nhận.');
  };

  window.shareAllTransferText = async function () {
    if (!uiState.chunks.length) return alert('Chưa có dữ liệu để gửi');
    const all = uiState.chunks.map(stringifyChunk).join('\n');
    await shareText(all);
  };

  window.importTransferText = async function () {
    const ta = document.getElementById('qrImportText');
    const raw = ta ? ta.value : '';
    const chunks = parseChunksFromText(raw);
    if (!chunks.length) return alert('Nội dung dán không hợp lệ. Hãy copy đúng JSON của đoạn Transfer.');

    // Hook progress to UI
    const statusEl = document.getElementById('qrImportStatus');
    if (window.QRTransferDecode && typeof window.QRTransferDecode.onProgress === 'function') {
      window.QRTransferDecode.onProgress((p) => {
        if (!statusEl) return;
        statusEl.textContent = 'Đang nhận: ' + p.received + '/' + p.total + ' (Transfer ' + p.transfer_id + ')';
      });
    }

    try {
      for (const c of chunks) {
        await QRTransferDecode.input(c);
      }
      if (statusEl) statusEl.textContent = 'Đã nhận xong. Nếu đủ đoạn app sẽ tự restore.';
    } catch (err) {
      throw err;
    }
  };
})();
