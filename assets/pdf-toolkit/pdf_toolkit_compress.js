// assets/pdf-toolkit/pdf_toolkit_compress.js
// ============================================================================
// PDF Toolkit — NÉN PDF (mô tả chính xác, không gây hiểu nhầm).
//   A) Tối ưu không giảm chất lượng: lưu lại bằng pdf-lib (object streams), bỏ
//      metadata không cần thiết. Không raster hóa, giữ chọn chữ. Giảm ít.
//   B) Nén tài liệu scan: render trang -> ảnh JPEG -> tạo lại PDF. Có cảnh báo
//      rõ (mất chọn chữ / giảm chất lượng) và BẮT xác nhận trước khi chạy.
// Luôn hiển thị: dung lượng gốc, kết quả, MB giảm, %; không báo sai kết quả.
// ============================================================================
(function () {
  'use strict';
  const TK = window.__PdfTK;
  const U = TK.U;

  TK.registerTool({
    id: 'compress',
    name: 'Nén PDF',
    desc: 'Giảm dung lượng file PDF',
    icon: 'archive',
    async mount(container, ctx) {
      const w = TK.widgets;
      let bytes = null; let originalSize = 0; let baseName = 'tai-lieu';

      const infoEl = el('div', { className: 'pdftk-doc-info' });
      const resultHost = el('div', {});

      const modeSeg = w.segmented('Chế độ', [
        { value: 'A', label: 'Tối ưu (giữ chữ)' }, { value: 'B', label: 'Nén scan (ảnh)' },
      ], 'A', () => syncMode());

      const levelSeg = w.segmented('Mức nén scan', [
        { value: 'high', label: 'Cao' }, { value: 'balanced', label: 'Cân bằng' }, { value: 'small', label: 'Nhỏ' },
      ], 'balanced');
      const levelWrap = el('div', { style: 'display:none' }, [
        levelSeg.el,
        el('div', { className: 'pdftk-warn-box' }, [
          ctx.icon('alert-triangle', 'w-4 h-4'),
          el('span', { text: 'Chế độ này render trang thành ảnh: nội dung chữ có thể không còn chọn hoặc tìm kiếm được, và chất lượng có thể giảm.' }),
        ]),
      ]);

      const runBtn = w.button('Nén PDF', { icon: 'archive', block: true, onClick: () => doCompress() });
      runBtn.disabled = true;

      const picker = w.filePicker({
        label: 'Chọn file PDF', icon: 'file-up', accept: 'application/pdf,.pdf',
        onFiles: (files) => load(files[0]),
      });

      container.appendChild(w.section('', [w.hint('Chọn một file PDF để nén trên thiết bị.'), picker, infoEl]));
      container.appendChild(w.section('Chế độ nén', [modeSeg.el, levelWrap]));
      container.appendChild(w.section('', [runBtn, resultHost]));

      function syncMode() { levelWrap.style.display = modeSeg.value === 'B' ? '' : 'none'; }
      syncMode();

      ctx.registerCleanup(() => { bytes = null; });

      async function load(file) {
        resultHost.replaceChildren();
        runBtn.disabled = true;
        const v = await TK.validatePdfFile(file);
        if (!v.ok) { infoEl.textContent = v.error; return; }
        // Kiểm tra mật khẩu / hỏng qua đọc metadata.
        const meta = await TK.readPdfMeta(v.bytes);
        if (meta.error) { infoEl.textContent = meta.error; return; }
        if (!ctx.isActive()) return;
        bytes = v.bytes; originalSize = file.size;
        baseName = (file.name || 'tai-lieu').replace(/\.pdf$/i, '');
        infoEl.textContent = file.name + ' · ' + meta.pages + ' trang · ' + U.formatBytes(originalSize);
        runBtn.disabled = false;
      }

      async function doCompress() {
        if (!bytes) return;
        const mode = modeSeg.value;

        if (mode === 'B') {
          const ok = window.showConfirm
            ? await window.showConfirm('Chế độ nén scan sẽ render các trang thành ảnh. Chữ trong tài liệu có thể không còn chọn hoặc tìm kiếm được, và chất lượng có thể giảm. Bạn có chắc muốn tiếp tục?', { title: 'Xác nhận nén scan', confirmText: 'Tiếp tục', danger: true, icon: 'help' })
            : true;
          if (!ok) return;
        }

        const blob = await ctx.runTask({
          label: mode === 'A' ? 'Đang tối ưu PDF…' : 'Đang nén (render trang)…',
          run: async (token, progress) => (mode === 'A' ? compressLossless(token, progress) : compressScan(token, progress)),
        });
        if (!blob || !ctx.isActive()) return;
        showResult(blob);
      }

      async function compressLossless(token, progress) {
        await TK.ensureVendor();
        progress.set(30, 'Đang đọc cấu trúc PDF…');
        const doc = await TK.loadPdfLibDoc(bytes);
        // Bỏ metadata không cần thiết (an toàn).
        try {
          doc.setTitle(''); doc.setAuthor(''); doc.setSubject('');
          doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
        } catch (e) {}
        token.throwIfCancelled();
        progress.set(70, 'Đang tạo file…');
        const out = await doc.save({ useObjectStreams: true, addDefaultPage: false });
        return new Blob([out], { type: 'application/pdf' });
      }

      async function compressScan(token, progress) {
        await TK.ensureVendor();
        const preset = U.compressionPreset(levelSeg.value);
        const doc = await TK.loadPdfJsDoc(bytes);
        try {
          const pdf = await TK.vendor.PDFLib.PDFDocument.create();
          const n = doc.numPages;
          for (let i = 1; i <= n; i++) {
            token.throwIfCancelled();
            const page = await doc.getPage(i);
            const basePt = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: preset.scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            const c = canvas.getContext('2d', { alpha: false });
            c.fillStyle = '#ffffff'; c.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: c, viewport }).promise;
            const jpgBlob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', preset.quality));
            const jpgBytes = new Uint8Array(await jpgBlob.arrayBuffer());
            TK.releaseCanvas(canvas);
            try { page.cleanup(); } catch (e) {}
            const img = await pdf.embedJpg(jpgBytes);
            const newPage = pdf.addPage([basePt.width, basePt.height]);
            newPage.drawImage(img, { x: 0, y: 0, width: basePt.width, height: basePt.height });
            progress.set((i / n) * 92, 'Đang nén trang… (' + i + '/' + n + ')');
            await TK.yieldToEventLoop();
          }
          progress.set(96, 'Đang tạo file…');
          const out = await pdf.save({ useObjectStreams: true });
          return new Blob([out], { type: 'application/pdf' });
        } finally {
          try { doc.destroy(); } catch (e) {}
        }
      }

      function showResult(blob) {
        const cmp = U.computeReduction(originalSize, blob.size);
        const fn = U.safeFileName(baseName + '-da-nen', 'pdf', 'pdf-da-nen');

        const rows = el('div', { className: 'pdftk-compare' }, [
          el('div', { className: 'pdftk-compare-row' }, [el('span', { text: 'Dung lượng gốc' }), el('strong', { text: U.formatBytes(cmp.originalBytes) })]),
          el('div', { className: 'pdftk-compare-row' }, [el('span', { text: 'Sau khi nén' }), el('strong', { text: U.formatBytes(cmp.resultBytes) })]),
          el('div', { className: 'pdftk-compare-row' }, [el('span', { text: 'Giảm' }), el('strong', { text: U.formatBytes(Math.max(0, cmp.savedBytes)) + ' (' + (cmp.percent > 0 ? cmp.percent.toFixed(1) : '0') + '%)' })]),
        ]);

        const banner = el('div', { className: 'pdftk-compress-banner ' + (cmp.notSmaller ? 'is-warn' : 'is-ok') }, [
          ctx.icon(cmp.notSmaller ? 'info' : 'check-circle-2', 'w-5 h-5'),
          el('span', {
            text: cmp.notSmaller
              ? 'File không giảm đáng kể. Bạn có thể tải bản kết quả hoặc giữ nguyên bản gốc.'
              : 'Đã nén: giảm ' + U.formatBytes(cmp.savedBytes) + ' (' + cmp.percent.toFixed(1) + '%).',
          }),
        ]);

        const actions = el('div', { className: 'pdftk-result-actions' }, [
          w.button('Tải bản đã nén', { icon: 'download', onClick: () => TK.downloadBlob(blob, fn) }),
        ]);
        if (TK.canShareFiles()) actions.appendChild(w.button('Chia sẻ', { icon: 'share-2', variant: 'ghost', onClick: () => TK.shareFile(blob, fn, 'Nén PDF') }));

        resultHost.replaceChildren(el('div', { className: 'pdftk-result' }, [banner, rows, actions]));
        ctx.refreshIcons(resultHost);
        if (cmp.notSmaller) { if (window.ErrorHandler) ErrorHandler.showWarning('File không giảm đáng kể.'); }
        else if (window.ErrorHandler) ErrorHandler.showSuccess('Nén PDF thành công.');
      }

      ctx.refreshIcons(container);
    },
  });
})();
