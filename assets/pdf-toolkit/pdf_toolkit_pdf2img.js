// assets/pdf-toolkit/pdf_toolkit_pdf2img.js
// ============================================================================
// PDF Toolkit — PDF THÀNH ẢNH. Render tuần tự (hàng đợi giới hạn) tránh tràn RAM.
// PNG/JPEG, chọn chất lượng JPEG, độ phân giải; nhiều ảnh -> ZIP.
// ============================================================================
(function () {
  'use strict';
  const TK = window.__PdfTK;
  const U = TK.U;

  TK.registerTool({
    id: 'pdf2img',
    name: 'PDF thành ảnh',
    desc: 'Xuất trang PDF ra ảnh PNG/JPEG',
    icon: 'image-down',
    async mount(container, ctx) {
      const w = TK.widgets;
      let doc = null;        // pdf.js document
      let total = 0;
      let baseName = 'tai-lieu';

      const infoEl = document.createElement('div');
      infoEl.className = 'pdftk-doc-info';

      const rangeField = w.filenameField('Trang cần xuất (ví dụ 1-3,5)', '');
      const optionsHost = document.createElement('div');
      const resultHost = document.createElement('div');

      const formatSeg = w.segmented('Định dạng', [
        { value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' },
      ], 'jpeg', () => syncQualityVisibility());
      const qualitySeg = w.segmented('Chất lượng JPEG', [
        { value: 'high', label: 'Cao' }, { value: 'balanced', label: 'Vừa' }, { value: 'small', label: 'Nhẹ' },
      ], 'high');
      const resSeg = w.segmented('Độ phân giải', [
        { value: 'save', label: 'Tiết kiệm' }, { value: 'balanced', label: 'Cân bằng' }, { value: 'sharp', label: 'Rõ nét' },
      ], 'balanced');

      const exportBtn = w.button('Xuất ảnh', { icon: 'image-down', block: true, onClick: () => doExport() });
      exportBtn.disabled = true;

      const picker = w.filePicker({
        label: 'Chọn file PDF', icon: 'file-up', accept: 'application/pdf,.pdf', multiple: false,
        onFiles: (files) => loadPdf(files[0]),
      });

      container.appendChild(w.section('', [
        w.hint('Chọn một file PDF. Các trang được render lần lượt để tiết kiệm bộ nhớ.'),
        picker, infoEl,
      ]));
      container.appendChild(w.section('Phạm vi', [rangeField.el, w.hint('Để trống để xuất toàn bộ trang.')]));
      optionsHost.appendChild(w.section('Tùy chọn ảnh', [formatSeg.el, qualitySeg.el, resSeg.el]));
      container.appendChild(optionsHost);
      container.appendChild(w.section('', [exportBtn, resultHost]));

      const qualityJpegOnly = () => { qualitySeg.el.style.display = formatSeg.value === 'jpeg' ? '' : 'none'; };
      function syncQualityVisibility() { qualityJpegOnly(); }
      qualityJpegOnly();

      ctx.registerCleanup(() => {
        if (doc) { try { doc.destroy(); } catch (e) {} doc = null; }
      });

      async function loadPdf(file) {
        resultHost.replaceChildren();
        if (doc) { try { doc.destroy(); } catch (e) {} doc = null; }
        const v = await TK.validatePdfFile(file);
        if (!v.ok) { infoEl.textContent = v.error; exportBtn.disabled = true; return; }
        infoEl.textContent = 'Đang đọc tài liệu…';
        try {
          doc = await TK.loadPdfJsDoc(v.bytes);
          total = doc.numPages;
          baseName = (file.name || 'tai-lieu').replace(/\.pdf$/i, '');
          if (!ctx.isActive()) { try { doc.destroy(); } catch (e) {} doc = null; return; }
          infoEl.textContent = file.name + ' · ' + total + ' trang';
          exportBtn.disabled = false;
        } catch (e) {
          doc = null; exportBtn.disabled = true;
          infoEl.textContent = (e && e.friendly) ? e.friendly : U.MSG.invalidPdf;
        }
      }

      async function renderPageToBlob(pageNum, scale, mime, quality) {
        const page = await doc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const c = canvas.getContext('2d', { alpha: mime === 'image/png' });
        try {
          await page.render({ canvasContext: c, viewport }).promise;
          const blob = await new Promise((res) => canvas.toBlob(res, mime, mime === 'image/jpeg' ? quality : undefined));
          return blob;
        } finally {
          TK.releaseCanvas(canvas);
          try { page.cleanup(); } catch (e) {}
        }
      }

      async function doExport() {
        if (!doc) return;
        const parsed = rangeField.value.trim()
          ? U.parsePageRange(rangeField.value, total)
          : { pages: Array.from({ length: total }, (_, i) => i + 1), error: null };
        if (parsed.error) { if (window.ErrorHandler) ErrorHandler.showWarning(parsed.error); return; }
        const pages = parsed.pages;
        if (pages.length > U.PDF_TOOLKIT_LIMITS.hardPages) {
          if (window.ErrorHandler) ErrorHandler.showWarning('Quá nhiều trang (' + pages.length + '). Vui lòng chọn phạm vi nhỏ hơn.');
          return;
        }
        if (pages.length > U.PDF_TOOLKIT_LIMITS.warnPages) {
          const ok = window.showConfirm ? await window.showConfirm('Bạn sắp xuất ' + pages.length + ' ảnh. Thao tác có thể mất thời gian và tốn bộ nhớ. Tiếp tục?', { title: 'Số trang lớn', confirmText: 'Tiếp tục' }) : true;
          if (!ok) return;
        }

        const format = formatSeg.value;
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        const ext = format === 'png' ? 'png' : 'jpg';
        const quality = U.compressionPreset(qualitySeg.value).quality;
        const scale = U.renderResolutionPreset(resSeg.value).scale;

        const out = await ctx.runTask({
          label: 'Đang xuất ảnh…',
          run: async (token, progress) => {
            const results = [];
            let done = 0;
            for (const pageNum of pages) {
              token.throwIfCancelled();
              const blob = await renderPageToBlob(pageNum, scale, mime, quality);
              if (!blob) throw new Error(U.MSG.outputFail);
              results.push({ name: U.imageOutputName(baseName, pageNum, ext, total), blob });
              done++;
              progress.set((done / pages.length) * (pages.length > 1 ? 85 : 95), 'Đang render trang… (' + done + '/' + pages.length + ')');
              await TK.yieldToEventLoop();
            }
            if (results.length === 1) return { single: results[0] };
            progress.set(90, 'Đang đóng gói ZIP…');
            const zipBlob = await TK.makeZip(results, (p) => progress.set(90 + p * 9, 'Đang đóng gói ZIP…'), token);
            return { zip: zipBlob, count: results.length };
          },
        });
        if (!out || !ctx.isActive()) return;

        if (out.single) {
          const fn = U.safeFileName(out.single.name, ext);
          resultHost.replaceChildren(w.resultActions({
            blob: out.single.blob,
            infoText: 'Đã xuất 1 ảnh · ' + U.formatBytes(out.single.blob.size),
            onDownload: () => TK.downloadBlob(out.single.blob, fn),
            onShare: () => TK.shareFile(out.single.blob, fn, 'PDF thành ảnh'),
          }));
        } else {
          const zipName = U.safeFileName(baseName + '-anh', 'zip', 'pdf-thanh-anh');
          resultHost.replaceChildren(w.resultActions({
            blob: out.zip,
            infoText: 'Đã xuất ' + out.count + ' ảnh (ZIP) · ' + U.formatBytes(out.zip.size),
            onDownload: () => TK.downloadBlob(out.zip, zipName),
            onShare: () => TK.shareFile(out.zip, zipName, 'PDF thành ảnh'),
          }));
        }
        ctx.refreshIcons(resultHost);
        if (window.ErrorHandler) ErrorHandler.showSuccess('Xuất ảnh thành công.');
      }

      ctx.refreshIcons(container);
    },
  });
})();
