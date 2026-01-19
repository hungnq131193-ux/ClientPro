/*
 * qrUI.js
 * UI glue for QR Transfer Backup
 */
(function () {
  const uiState = { chunks: [], frames: [] };

  function reset() {
    uiState.chunks = [];
    uiState.frames = [];
  }

  function getQrBinaryEl(frame) {
    return frame.querySelector('canvas') || frame.querySelector('img');
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), 'image/png');
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function frameToBlob(frame) {
    const el = getQrBinaryEl(frame);
    if (!el) throw new Error('Không tìm thấy QR trong khung');
    if (el.tagName && el.tagName.toLowerCase() == 'canvas') {
      const blob = await canvasToBlob(el);
      if (!blob) throw new Error('Không thể xuất ảnh QR');
      return blob;
    }
    const src = el.getAttribute('src') || '';
    const resp = await fetch(src);
    return await resp.blob();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function exportFiles() {
    const blobs = [];
    const files = [];
    const ts = Date.now();

    for (let i = 0; i < uiState.frames.length; i++) {
      const blob = await frameToBlob(uiState.frames[i]);
      blobs.push(blob);
      const name = 'CLIENTPRO_QR_' + ts + '_p' + (i + 1) + '_of_' + uiState.frames.length + '.png';
      try {
        files.push(new File([blob], name, { type: 'image/png' }));
      } catch (e) {
        // Older browsers might not support File; keep blobs for download fallback
      }
    }

    return { blobs, files };
  }

  window.openQrTransferBackup = async function () {
    const scope = (document.querySelector('#qrScope') && document.querySelector('#qrScope').value) || 'all';
    let customerIds = [];
    if (scope === 'customers') {
      customerIds = await UISelectCustomers.pickIds();
      if (!customerIds.length) return alert('Chưa chọn khách hàng');
    }

    const chunks = await QRTransferEncode.create({ scope, customerIds });
    const box = document.getElementById('qrBox');
    if (!box) throw new Error('Thiếu #qrBox');

    reset();
    uiState.chunks = chunks;
    box.innerHTML = '';

    chunks.forEach((c) => {
      const frame = document.createElement('div');
      frame.className = 'qr-frame';

      const label = document.createElement('div');
      label.className = 'qr-label';
      label.textContent = 'PHẦN ' + c.index + '/' + c.total;

      const holder = document.createElement('div');
      holder.className = 'qr-holder';

      frame.appendChild(label);
      frame.appendChild(holder);
      box.appendChild(frame);

      new QRCode(holder, {
        text: JSON.stringify(c),
        width: 220,
        height: 220,
        correctLevel: QRCode.CorrectLevel.M
      });

      uiState.frames.push(frame);
    });
  };

  window.shareQrTransfer = async function () {
    if (!uiState.frames.length) return alert('Chưa có QR để gửi');
    const { blobs, files } = await exportFiles();

    if (navigator.share && navigator.canShare && files.length && navigator.canShare({ files })) {
      await navigator.share({
        title: 'ClientPro QR Backup',
        text: 'ClientPro QR Backup (ciphertext)',
        files
      });
      return;
    }

    // Fallback: download images so user can attach to Zalo/Mail
    blobs.forEach((b, idx) => {
      downloadBlob(b, 'CLIENTPRO_QR_part_' + (idx + 1) + '_of_' + blobs.length + '.png');
    });
    alert('Thiết bị không hỗ trợ chia sẻ trực tiếp. App đã tự tải ảnh QR để bạn gửi qua Zalo/Mail.');
  };

  window.downloadQrTransfer = async function () {
    if (!uiState.frames.length) return alert('Chưa có QR để lưu');
    const { blobs } = await exportFiles();
    blobs.forEach((b, idx) => {
      downloadBlob(b, 'CLIENTPRO_QR_part_' + (idx + 1) + '_of_' + blobs.length + '.png');
    });
  };

  window.handleQrImageUpload = async function (files) {
    if (!files || !files.length) return;
    if (typeof QRImageDecoder === 'undefined' || typeof QRImageDecoder.decode !== 'function') {
      throw new Error('Thiếu QRImageDecoder.decode()');
    }
    for (const f of files) {
      const txt = await QRImageDecoder.decode(f);
      await QRTransferDecode.input(JSON.parse(txt));
    }
  };
})();
