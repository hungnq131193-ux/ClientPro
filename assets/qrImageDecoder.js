/**
 * qrImageDecoder.js
 *
 * Decode QR content from an image file selected from the device library.
 * Uses html5-qrcode's scanFile API (already loaded in index.html).
 */

(function () {
  const EL_ID = 'qrFileScanTmp';

  function ensureEl() {
    let el = document.getElementById(EL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = EL_ID;
    // keep it out of view
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    el.style.top = '-9999px';
    el.style.width = '1px';
    el.style.height = '1px';
    document.body.appendChild(el);
    return el;
  }

  async function decodeWithHtml5Qr(file) {
    if (typeof Html5Qrcode === 'undefined') {
      throw new Error('Thiếu thư viện html5-qrcode');
    }
    ensureEl();
    const qr = new Html5Qrcode(EL_ID);
    try {
      // (file, showImage) -> returns decoded text
      const decodedText = await qr.scanFile(file, true);
      try { await qr.clear(); } catch (e) {}
      return decodedText;
    } finally {
      try { await qr.clear(); } catch (e) {}
      try { await qr.stop(); } catch (e) {}
    }
  }

  window.QRImageDecoder = {
    async decode(file) {
      if (!file) throw new Error('Thiếu file ảnh');
      return await decodeWithHtml5Qr(file);
    }
  };
})();
