// assets/pdf-toolkit/pdf_toolkit_images.js
// ============================================================================
// PDF Toolkit — ẢNH THÀNH PDF. JPG/PNG/WebP -> PDF, một ảnh mỗi trang.
// Giữ đúng tỷ lệ ảnh (không kéo méo). Khổ/hướng/lề/cách đặt tùy chọn.
// ============================================================================
(function () {
  'use strict';
  const TK = window.__PdfTK;
  const U = TK.U;

  TK.registerTool({
    id: 'img2pdf',
    name: 'Ảnh thành PDF',
    desc: 'Gộp ảnh JPG/PNG/WebP thành PDF',
    icon: 'image-plus',
    async mount(container, ctx) {
      const w = TK.widgets;
      let items = []; // { id, file, url, iw, ih, kind, rotation, error }
      let uid = 0;

      const gridEl = document.createElement('div');
      gridEl.className = 'pdftk-thumb-grid';

      const picker = w.filePicker({
        label: 'Chọn ảnh', icon: 'image-plus', accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp', multiple: true,
        onFiles: (files) => addFiles(files),
      });

      const sizeSeg = w.segmented('Khổ trang', [
        { value: 'image', label: 'Theo ảnh' }, { value: 'a4', label: 'A4' },
      ], 'a4');
      const orientSeg = w.segmented('Hướng', [
        { value: 'auto', label: 'Tự động' }, { value: 'portrait', label: 'Dọc' }, { value: 'landscape', label: 'Ngang' },
      ], 'auto');
      const marginSeg = w.segmented('Lề', [
        { value: 'none', label: 'Không' }, { value: 'small', label: 'Nhỏ' }, { value: 'medium', label: 'Vừa' },
      ], 'small');
      const fitSeg = w.segmented('Đặt ảnh', [
        { value: 'fit', label: 'Vừa trang' }, { value: 'fill', label: 'Lấp đầy' },
      ], 'fit');

      const nameField = w.filenameField('Tên file kết quả', 'anh-thanh-pdf');
      const resultHost = document.createElement('div');
      const exportBtn = w.button('Xuất PDF', { icon: 'file-output', block: true, onClick: () => doExport() });
      exportBtn.disabled = true;

      container.appendChild(w.section('', [
        w.hint('Ảnh được giữ đúng tỷ lệ, mỗi ảnh một trang. WebP cần trình duyệt hỗ trợ giải mã.'),
        picker,
      ]));
      container.appendChild(gridEl);
      container.appendChild(w.section('Tùy chọn trang', [sizeSeg.el, orientSeg.el, marginSeg.el, fitSeg.el]));
      container.appendChild(w.section('', [nameField.el]));
      container.appendChild(w.section('', [exportBtn, resultHost]));

      ctx.registerCleanup(() => {
        for (const it of items) { if (it.url) TK.revokeObjectURL(it.url); }
        items = [];
      });

      function validCount() { return items.filter((x) => !x.error).length; }
      function updateBtn() { exportBtn.disabled = validCount() < 1; }

      async function decodeImage(url) {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('decode'));
          img.src = url;
        });
      }

      async function addFiles(files) {
        if (items.length + files.length > U.PDF_TOOLKIT_LIMITS.maxFiles) {
          if (window.ErrorHandler) ErrorHandler.showWarning('Chỉ chọn tối đa ' + U.PDF_TOOLKIT_LIMITS.maxFiles + ' ảnh.');
          files = files.slice(0, Math.max(0, U.PDF_TOOLKIT_LIMITS.maxFiles - items.length));
        }
        for (const file of files) {
          const id = ++uid;
          const rec = { id, file, url: null, iw: 0, ih: 0, kind: null, rotation: 0, error: null };
          items.push(rec);
          renderGrid();
          try {
            // Chặn ảnh vượt hard limit TRƯỚC khi đọc vào bộ nhớ.
            const sizeCheck = U.checkFileSize(file.size);
            if (!sizeCheck.ok) { rec.error = sizeCheck.error; renderGrid(); updateBtn(); continue; }
            const bytes = await TK.readFileBytes(file);
            let kind = U.detectFileKind(bytes);
            if (!U.isImageKind(kind)) kind = U.imageMimeToKind(file.type);
            if (!U.isImageKind(kind)) { rec.error = U.MSG.badImage; renderGrid(); updateBtn(); continue; }
            rec.kind = kind;
            rec.url = TK.createObjectURL(new Blob([bytes], { type: file.type || ('image/' + kind) }));
            const img = await decodeImage(rec.url);
            rec.iw = img.naturalWidth; rec.ih = img.naturalHeight;
            if (rec.iw * rec.ih > U.PDF_TOOLKIT_LIMITS.maxImagePixels) { rec.error = U.MSG.imageTooLarge; }
          } catch (e) {
            rec.error = U.MSG.badImage;
          }
          if (!ctx.isActive()) return;
          renderGrid(); updateBtn();
        }
      }

      function move(id, dir) {
        const idx = items.findIndex((x) => x.id === id);
        if (idx === -1) return;
        items = U.moveItem(items, idx, dir);
        renderGrid();
      }
      function rotate(id) {
        const rec = items.find((x) => x.id === id);
        if (rec) { rec.rotation = U.rotateBy(rec.rotation, 90); renderGrid(); }
      }
      function remove(id) {
        const rec = items.find((x) => x.id === id);
        if (rec && rec.url) TK.revokeObjectURL(rec.url);
        items = items.filter((x) => x.id !== id);
        renderGrid(); updateBtn();
      }

      function renderGrid() {
        gridEl.replaceChildren();
        if (!items.length) { gridEl.appendChild(w.hint('Chưa có ảnh nào.')); return; }
        items.forEach((rec, idx) => {
          const thumbInner = rec.error
            ? el('div', { className: 'pdftk-thumb-err', text: '!' })
            : el('img', { className: 'pdftk-thumb-img', src: rec.url || '', alt: '', style: 'transform:rotate(' + rec.rotation + 'deg)' });
          const ctrls = el('div', { className: 'pdftk-thumb-ctrls' }, [
            el('button', { type: 'button', className: 'pdftk-mini-btn', 'aria-label': 'Lên', on: { click: () => move(rec.id, -1) } }, [ctx.icon('chevron-up', 'w-4 h-4')]),
            el('button', { type: 'button', className: 'pdftk-mini-btn', 'aria-label': 'Xuống', on: { click: () => move(rec.id, 1) } }, [ctx.icon('chevron-down', 'w-4 h-4')]),
            el('button', { type: 'button', className: 'pdftk-mini-btn', 'aria-label': 'Xoay', on: { click: () => rotate(rec.id) } }, [ctx.icon('rotate-cw', 'w-4 h-4')]),
            el('button', { type: 'button', className: 'pdftk-mini-btn pdftk-mini-danger', 'aria-label': 'Xóa', on: { click: () => remove(rec.id) } }, [ctx.icon('trash-2', 'w-4 h-4')]),
          ]);
          const cell = el('div', { className: 'pdftk-thumb-cell' + (rec.error ? ' has-error' : '') }, [
            el('div', { className: 'pdftk-thumb-box' }, [thumbInner, el('span', { className: 'pdftk-thumb-index', text: String(idx + 1) })]),
            rec.error ? el('span', { className: 'pdftk-file-error', text: rec.error }) : ctrls,
          ]);
          gridEl.appendChild(cell);
        });
        ctx.refreshIcons(gridEl);
      }

      // Vẽ ảnh (đã xoay) ra canvas -> bytes để nhúng vào PDF.
      async function rasterize(rec) {
        const img = await decodeImage(rec.url);
        const rot = U.normalizeRotation(rec.rotation);
        const swap = rot === 90 || rot === 270;
        const cw = swap ? img.naturalHeight : img.naturalWidth;
        const ch = swap ? img.naturalWidth : img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const c = canvas.getContext('2d');
        c.save();
        c.translate(cw / 2, ch / 2);
        c.rotate(rot * Math.PI / 180);
        c.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        c.restore();
        const usePng = rec.kind === 'png';
        const mime = usePng ? 'image/png' : 'image/jpeg';
        // toBlob có thể trả null (thiếu RAM / canvas quá lớn) -> lỗi thân thiện.
        const blob = U.blobOrThrow(await new Promise((res) => canvas.toBlob(res, mime, usePng ? undefined : 0.92)));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const dims = { w: cw, h: ch };
        TK.releaseCanvas(canvas);
        return { bytes, mime, dims };
      }

      function pageDimensions(imgW, imgH) {
        if (sizeSeg.value === 'image') {
          let pw = imgW, ph = imgH;
          if (orientSeg.value === 'portrait' && pw > ph) { const t = pw; pw = ph; ph = t; }
          else if (orientSeg.value === 'landscape' && ph > pw) { const t = pw; pw = ph; ph = t; }
          return { pw, ph };
        }
        // A4
        let pw = U.A4.width, ph = U.A4.height; // dọc
        let landscape = false;
        if (orientSeg.value === 'landscape') landscape = true;
        else if (orientSeg.value === 'portrait') landscape = false;
        else landscape = imgW > imgH; // auto theo ảnh
        if (landscape) { const t = pw; pw = ph; ph = t; }
        return { pw, ph };
      }

      async function doExport() {
        const valid = items.filter((x) => !x.error && x.url);
        if (!valid.length) { if (window.ErrorHandler) ErrorHandler.showWarning('Vui lòng chọn ít nhất một ảnh.'); return; }

        const blob = await ctx.runTask({
          label: 'Đang tạo PDF từ ảnh…',
          run: async (token, progress) => {
            await TK.ensureVendor();
            const pdf = await TK.vendor.PDFLib.PDFDocument.create();
            const margin = U.marginPreset(marginSeg.value);
            let done = 0;
            for (const rec of valid) {
              token.throwIfCancelled();
              const r = await rasterize(rec);
              const embedded = r.mime === 'image/png' ? await pdf.embedPng(r.bytes) : await pdf.embedJpg(r.bytes);
              const { pw, ph } = pageDimensions(r.dims.w, r.dims.h);
              const page = pdf.addPage([pw, ph]);
              const cw = pw - 2 * margin, chh = ph - 2 * margin;
              const iw = r.dims.w, ih = r.dims.h;
              const scale = fitSeg.value === 'fill'
                ? Math.max(cw / iw, chh / ih)
                : Math.min(cw / iw, chh / ih);
              const dw = iw * scale, dh = ih * scale;
              const x = margin + (cw - dw) / 2;
              const y = margin + (chh - dh) / 2;
              page.drawImage(embedded, { x, y, width: dw, height: dh });
              done++;
              progress.set((done / valid.length) * 92, 'Đang xử lý ảnh… (' + done + '/' + valid.length + ')');
              await TK.yieldToEventLoop();
            }
            progress.set(96, 'Đang tạo file…');
            const bytes = await pdf.save({ useObjectStreams: true });
            token.throwIfCancelled();
            return new Blob([bytes], { type: 'application/pdf' });
          },
        });
        if (!blob || !ctx.isActive()) return;
        const filename = U.safeFileName(nameField.value || 'anh-thanh-pdf', 'pdf', 'anh-thanh-pdf');
        resultHost.replaceChildren(w.resultActions({
          blob,
          infoText: 'Đã tạo PDF · ' + valid.length + ' trang · ' + U.formatBytes(blob.size),
          onDownload: () => TK.downloadBlob(blob, filename),
          onShare: () => TK.shareFile(blob, filename, 'Ảnh thành PDF'),
        }));
        ctx.refreshIcons(resultHost);
        if (window.ErrorHandler) ErrorHandler.showSuccess('Tạo PDF từ ảnh thành công.');
      }

      renderGrid();
      ctx.refreshIcons(container);
    },
  });
})();
