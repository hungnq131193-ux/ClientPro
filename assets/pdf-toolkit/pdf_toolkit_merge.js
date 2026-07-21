// assets/pdf-toolkit/pdf_toolkit_merge.js
// ============================================================================
// PDF Toolkit — GHÉP PDF. Chọn >=2 file, sắp xếp, ghép theo thứ tự, tải/chia sẻ.
// Không đổi nội dung trang, không giảm chất lượng, giữ khổ giấy & hướng trang.
// ============================================================================
(function () {
  'use strict';
  const TK = window.__PdfTK;
  const U = TK.U;
  const W = TK.widgets;

  TK.registerTool({
    id: 'merge',
    name: 'Ghép PDF',
    desc: 'Nối nhiều file PDF thành một',
    icon: 'copy-plus',
    async mount(container, ctx) {
      const w = window.__PdfTK.widgets;
      let items = []; // { id, file, bytes, pages, error }
      let uid = 0;

      const listEl = document.createElement('div');
      listEl.className = 'pdftk-file-list';

      const nameField = w.filenameField('Tên file kết quả', 'tai-lieu-da-ghep');
      const resultHost = document.createElement('div');

      const picker = w.filePicker({
        label: 'Chọn file PDF', icon: 'file-plus', accept: 'application/pdf,.pdf', multiple: true,
        onFiles: (files) => addFiles(files),
      });

      const mergeBtn = w.button('Ghép ' + '(0)', { icon: 'combine', block: true, onClick: () => doMerge() });
      mergeBtn.disabled = true;

      container.appendChild(w.section('', [
        w.hint('Chọn từ 2 file PDF trở lên. Nội dung từng trang được giữ nguyên.'),
        picker,
      ]));
      container.appendChild(listEl);
      container.appendChild(w.section('', [nameField.el]));
      container.appendChild(w.section('', [mergeBtn, resultHost]));

      ctx.registerCleanup(() => { items = []; });

      function validCount() { return items.filter((x) => !x.error).length; }
      function updateMergeBtn() {
        const n = validCount();
        mergeBtn.disabled = n < 2;
        const span = mergeBtn.querySelector('span:last-child');
        if (span) span.textContent = 'Ghép (' + n + ')';
      }

      async function addFiles(files) {
        if (items.length + files.length > U.PDF_TOOLKIT_LIMITS.maxFiles) {
          if (window.ErrorHandler) ErrorHandler.showWarning('Chỉ chọn tối đa ' + U.PDF_TOOLKIT_LIMITS.maxFiles + ' file mỗi lần.');
          files = files.slice(0, Math.max(0, U.PDF_TOOLKIT_LIMITS.maxFiles - items.length));
        }
        for (const file of files) {
          const id = ++uid;
          const rec = { id, file, bytes: null, pages: 0, error: null };
          items.push(rec);
          renderList();
          // Validate + meta (không chặn UI).
          const v = await TK.validatePdfFile(file);
          if (!v.ok) { rec.error = v.error; renderList(); updateMergeBtn(); continue; }
          rec.bytes = v.bytes;
          const meta = await TK.readPdfMeta(v.bytes);
          if (meta.error) { rec.error = meta.error; rec.bytes = null; }
          else rec.pages = meta.pages;
          if (!ctx.isActive()) return;
          renderList(); updateMergeBtn();
        }
      }

      function move(id, dir) {
        const idx = items.findIndex((x) => x.id === id);
        if (idx === -1) return;
        items = U.moveItem(items, idx, dir);
        renderList();
      }
      function remove(id) {
        items = items.filter((x) => x.id !== id);
        renderList(); updateMergeBtn();
      }

      function renderList() {
        listEl.replaceChildren();
        if (!items.length) {
          listEl.appendChild(w.hint('Chưa có file nào được chọn.'));
          return;
        }
        items.forEach((rec, idx) => {
          const meta = rec.error
            ? el('span', { className: 'pdftk-file-error', text: rec.error })
            : el('span', { className: 'pdftk-file-meta', text: U.formatBytes(rec.file.size) + (rec.pages ? ' · ' + rec.pages + ' trang' : ' · đang đọc…') });
          const up = el('button', { type: 'button', className: 'pdftk-mini-btn', 'aria-label': 'Lên', on: { click: () => move(rec.id, -1) } }, [ctx.icon('chevron-up', 'w-4 h-4')]);
          const down = el('button', { type: 'button', className: 'pdftk-mini-btn', 'aria-label': 'Xuống', on: { click: () => move(rec.id, 1) } }, [ctx.icon('chevron-down', 'w-4 h-4')]);
          const del = el('button', { type: 'button', className: 'pdftk-mini-btn pdftk-mini-danger', 'aria-label': 'Xóa', on: { click: () => remove(rec.id) } }, [ctx.icon('trash-2', 'w-4 h-4')]);
          up.disabled = idx === 0;
          down.disabled = idx === items.length - 1;
          const row = el('div', { className: 'pdftk-file-row' + (rec.error ? ' has-error' : '') }, [
            el('span', { className: 'pdftk-file-index', text: String(idx + 1) }),
            el('div', { className: 'pdftk-file-main' }, [
              el('span', { className: 'pdftk-file-name', text: rec.file.name }), meta,
            ]),
            el('div', { className: 'pdftk-file-ctrls' }, [up, down, del]),
          ]);
          listEl.appendChild(row);
        });
        ctx.refreshIcons(listEl);
      }

      async function doMerge() {
        const valid = items.filter((x) => !x.error && x.bytes);
        if (valid.length < 2) { if (window.ErrorHandler) ErrorHandler.showWarning('Vui lòng chọn ít nhất hai file PDF.'); return; }

        const blob = await ctx.runTask({
          label: 'Đang ghép PDF…',
          run: async (token, progress) => {
            await TK.ensureVendor();
            const out = await TK.vendor.PDFLib.PDFDocument.create();
            let done = 0;
            for (const rec of valid) {
              token.throwIfCancelled();
              const src = await TK.loadPdfLibDoc(rec.bytes);
              const pageIndices = src.getPageIndices();
              const copied = await out.copyPages(src, pageIndices);
              copied.forEach((p) => out.addPage(p));
              done++;
              progress.set((done / valid.length) * 90, 'Đang ghép PDF… (' + done + '/' + valid.length + ')');
              await TK.yieldToEventLoop();
            }
            progress.set(95, 'Đang tạo file…');
            const bytes = await out.save({ useObjectStreams: true });
            token.throwIfCancelled();
            return new Blob([bytes], { type: 'application/pdf' });
          },
        });
        if (!blob || !ctx.isActive()) return;
        showResult(blob);
      }

      function showResult(blob) {
        const filename = U.safeFileName(nameField.value || 'tai-lieu-da-ghep', 'pdf', 'tai-lieu-da-ghep');
        resultHost.replaceChildren(w.resultActions({
          blob,
          infoText: 'Đã ghép ' + validCount() + ' file · ' + U.formatBytes(blob.size),
          onDownload: () => TK.downloadBlob(blob, filename),
          onShare: () => TK.shareFile(blob, filename, 'Ghép PDF'),
        }));
        ctx.refreshIcons(resultHost);
        if (window.ErrorHandler) ErrorHandler.showSuccess('Ghép PDF thành công.');
      }

      renderList();
      ctx.refreshIcons(container);
    },
  });
})();
