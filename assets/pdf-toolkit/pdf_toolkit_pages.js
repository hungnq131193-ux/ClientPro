// assets/pdf-toolkit/pdf_toolkit_pages.js
// ============================================================================
// PDF Toolkit — TÁCH PDF (trích xuất trang) + SẮP XẾP TRANG (quản lý trang).
// Dùng chung một "page board": thumbnail lazy (IntersectionObserver), render
// tuần tự (hàng đợi concurrency = 1) để tránh tràn RAM.
// pdf.js render thumbnail; pdf-lib xuất PDF mới. KHÔNG sửa file gốc.
// ============================================================================
(function () {
  'use strict';
  const TK = window.__PdfTK;
  const U = TK.U;

  // ---------------------------------------------------------------------
  // PAGE BOARD dùng chung.
  // ---------------------------------------------------------------------
  function createPageBoard(ctx, sourceBytes, doc, mode) {
    let pages = []; // { id, srcIndex(0-based), rotation, selected }
    let uid = 0;
    const undo = U.createUndoStack(30);

    for (let i = 0; i < doc.numPages; i++) pages.push({ id: ++uid, srcIndex: i, rotation: 0, selected: false });

    const gridEl = el('div', { className: 'pdftk-page-board' });

    // Hàng đợi render tuần tự (concurrency = 1).
    const queue = [];
    let running = false;
    function pump() {
      if (running) return;
      running = true;
      (async () => {
        while (queue.length) {
          if (!ctx.isActive()) break;
          const t = queue.shift();
          try { await t(); } catch (e) {}
        }
        running = false;
      })();
    }
    function enqueue(task) { queue.push(task); pump(); }

    let io = null;
    try {
      io = new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            const cell = en.target;
            io.unobserve(cell);
            const canvas = cell.querySelector('canvas');
            const pid = Number(cell.getAttribute('data-pid'));
            const p = pages.find((x) => x.id === pid);
            if (canvas && p && canvas.getAttribute('data-rendered') !== '1') {
              canvas.setAttribute('data-rendered', '1');
              enqueue(() => renderThumb(p, canvas));
            }
          }
        }
      }, { root: null, rootMargin: '300px' });
    } catch (e) {}

    async function renderThumb(p, canvas) {
      if (!ctx.isActive()) return;
      try {
        const page = await doc.getPage(p.srcIndex + 1);
        const base = page.getViewport({ scale: 1 });
        const target = 170;
        const scale = Math.min(2, target / base.width);
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const c = canvas.getContext('2d');
        await page.render({ canvasContext: c, viewport }).promise;
        try { page.cleanup(); } catch (e) {}
      } catch (e) {}
    }

    function snapshot() { return pages.map((p) => ({ srcIndex: p.srcIndex, rotation: p.rotation })); }
    function pushUndo() { undo.push(snapshot()); }

    function selectedList() { return pages.filter((p) => p.selected); }

    function render() {
      // Ngắt quan sát/hàng đợi cũ.
      try { if (io) io.disconnect(); } catch (e) {}
      queue.length = 0;
      gridEl.replaceChildren();
      if (!pages.length) {
        gridEl.appendChild(el('p', { className: 'pdftk-hint-text', text: 'Không còn trang nào. Hãy đặt lại để tiếp tục.' }));
        return;
      }
      pages.forEach((p, idx) => {
        const canvas = el('canvas', { className: 'pdftk-page-canvas' });
        canvas.style.transform = 'rotate(' + p.rotation + 'deg)';
        const box = el('div', { className: 'pdftk-page-thumb' }, [
          canvas,
          el('span', { className: 'pdftk-page-num', text: String(idx + 1) }),
          p.selected ? el('span', { className: 'pdftk-page-check' }, [ctx.icon('check', 'w-4 h-4')]) : null,
        ]);
        const ctrls = el('div', { className: 'pdftk-page-ctrls' });
        if (mode === 'manage') {
          ctrls.appendChild(el('button', { type: 'button', className: 'pdftk-mini-btn', 'aria-label': 'Sang trái', on: { click: (e) => { e.stopPropagation(); rotatePage(p.id, -90); } } }, [ctx.icon('rotate-ccw', 'w-4 h-4')]));
          ctrls.appendChild(el('button', { type: 'button', className: 'pdftk-mini-btn', 'aria-label': 'Sang phải', on: { click: (e) => { e.stopPropagation(); rotatePage(p.id, 90); } } }, [ctx.icon('rotate-cw', 'w-4 h-4')]));
          ctrls.appendChild(el('button', { type: 'button', className: 'pdftk-mini-btn', 'aria-label': 'Lên', on: { click: (e) => { e.stopPropagation(); movePage(p.id, -1); } } }, [ctx.icon('chevron-up', 'w-4 h-4')]));
          ctrls.appendChild(el('button', { type: 'button', className: 'pdftk-mini-btn', 'aria-label': 'Xuống', on: { click: (e) => { e.stopPropagation(); movePage(p.id, 1); } } }, [ctx.icon('chevron-down', 'w-4 h-4')]));
          ctrls.appendChild(el('button', { type: 'button', className: 'pdftk-mini-btn pdftk-mini-danger', 'aria-label': 'Xóa', on: { click: (e) => { e.stopPropagation(); deletePage(p.id); } } }, [ctx.icon('trash-2', 'w-4 h-4')]));
        }
        const cell = el('div', {
          className: 'pdftk-page-cell' + (p.selected ? ' is-selected' : ''),
          dataset: { pid: String(p.id) },
          on: { click: () => toggleSelect(p.id) },
        }, [box, ctrls]);
        gridEl.appendChild(cell);
        if (io) io.observe(cell);
        else enqueue(() => renderThumb(p, canvas)); // fallback không có IO
      });
      ctx.refreshIcons(gridEl);
    }

    // --- ops ---
    function toggleSelect(id) { const p = pages.find((x) => x.id === id); if (p) { p.selected = !p.selected; render(); if (onChange) onChange(); } }
    function selectAll() { pages.forEach((p) => p.selected = true); render(); if (onChange) onChange(); }
    function deselectAll() { pages.forEach((p) => p.selected = false); render(); if (onChange) onChange(); }
    function movePage(id, dir) { pushUndo(); const idx = pages.findIndex((x) => x.id === id); pages = U.moveItem(pages, idx, dir); render(); if (onChange) onChange(); }
    function rotatePage(id, delta) { pushUndo(); const p = pages.find((x) => x.id === id); if (p) p.rotation = U.rotateBy(p.rotation, delta); render(); if (onChange) onChange(); }
    function rotateSelected(delta) { const sel = selectedList(); if (!sel.length) return; pushUndo(); sel.forEach((p) => p.rotation = U.rotateBy(p.rotation, delta)); render(); if (onChange) onChange(); }
    function deletePage(id) { pushUndo(); pages = pages.filter((x) => x.id !== id); render(); if (onChange) onChange(); }
    function deleteSelected() { const sel = selectedList(); if (!sel.length) return; pushUndo(); const ids = new Set(sel.map((p) => p.id)); pages = pages.filter((p) => !ids.has(p.id)); render(); if (onChange) onChange(); }
    function undoOnce() { const snap = undo.pop(); if (!snap) return; pages = snap.map((s) => ({ id: ++uid, srcIndex: s.srcIndex, rotation: s.rotation, selected: false })); render(); if (onChange) onChange(); }
    function resetAll() { undo.clear(); pages = []; for (let i = 0; i < doc.numPages; i++) pages.push({ id: ++uid, srcIndex: i, rotation: 0, selected: false }); render(); if (onChange) onChange(); }

    let onChange = null;

    function destroy() {
      try { if (io) io.disconnect(); } catch (e) {}
      queue.length = 0;
      gridEl.querySelectorAll('canvas').forEach((c) => TK.releaseCanvas(c));
      pages = [];
    }

    // Xuất PDF từ danh sách trang (theo srcIndex + rotation).
    async function buildPdf(pageList, token, progress) {
      const PDFLib = TK.vendor.PDFLib;
      const src = await TK.loadPdfLibDoc(sourceBytes);
      const out = await PDFLib.PDFDocument.create();
      const indices = pageList.map((p) => p.srcIndex);
      const copied = await out.copyPages(src, indices);
      let done = 0;
      for (let i = 0; i < copied.length; i++) {
        token.throwIfCancelled();
        const page = copied[i];
        const baseAngle = (page.getRotation && page.getRotation().angle) || 0;
        const angle = U.normalizeRotation(baseAngle + pageList[i].rotation);
        try { page.setRotation(PDFLib.degrees(angle)); } catch (e) {}
        out.addPage(page);
        done++;
        if (progress) progress.set((done / copied.length) * 90, 'Đang tạo trang… (' + done + '/' + copied.length + ')');
        if (done % 10 === 0) await TK.yieldToEventLoop();
      }
      if (progress) progress.set(95, 'Đang tạo file…');
      const bytes = await out.save({ useObjectStreams: true });
      return new Blob([bytes], { type: 'application/pdf' });
    }

    // Mỗi trang -> một PDF riêng.
    async function buildPerPage(pageList, token, progress) {
      const PDFLib = TK.vendor.PDFLib;
      const src = await TK.loadPdfLibDoc(sourceBytes);
      const results = [];
      let done = 0;
      for (const p of pageList) {
        token.throwIfCancelled();
        const out = await PDFLib.PDFDocument.create();
        const [copied] = await out.copyPages(src, [p.srcIndex]);
        const baseAngle = (copied.getRotation && copied.getRotation().angle) || 0;
        try { copied.setRotation(PDFLib.degrees(U.normalizeRotation(baseAngle + p.rotation))); } catch (e) {}
        out.addPage(copied);
        const bytes = await out.save({ useObjectStreams: true });
        results.push({ name: U.imageOutputName(baseName(), p.srcIndex + 1, 'pdf', doc.numPages), blob: new Blob([bytes], { type: 'application/pdf' }) });
        done++;
        if (progress) progress.set((done / pageList.length) * 80, 'Đang tách trang… (' + done + '/' + pageList.length + ')');
        await TK.yieldToEventLoop();
      }
      return results;
    }

    let _baseName = 'tai-lieu';
    function baseName() { return _baseName; }
    function setBaseName(n) { _baseName = (n || 'tai-lieu').replace(/\.pdf$/i, ''); }

    render();

    // Đặt lựa chọn theo danh sách số trang (1-based theo thứ tự hiển thị).
    function setSelectionByPages(pageNumbers) {
      const wanted = new Set(pageNumbers);
      pages.forEach((p, idx) => { p.selected = wanted.has(idx + 1); });
      render();
      if (onChange) onChange();
    }

    return {
      gridEl,
      get pages() { return pages; },
      selectedList,
      selectAll, deselectAll, rotateSelected, deleteSelected, undoOnce, resetAll,
      setSelectionByPages, render,
      canUndo: () => undo.canUndo(),
      setOnChange: (fn) => { onChange = fn; },
      buildPdf, buildPerPage, setBaseName,
      destroy,
    };
  }

  // Helper: chọn 1 PDF -> validate -> load pdf.js doc.
  //   isCurrent(): trả false nếu người dùng đã chọn file mới hơn trong lúc chờ
  //   -> bỏ kết quả cũ và hủy document thừa (chống race reselect nhanh).
  async function pickAndLoad(ctx, file, onLoaded, infoEl, isCurrent) {
    const current = () => (typeof isCurrent === 'function' ? isCurrent() : true);
    const v = await TK.validatePdfFile(file);
    if (!current()) return null;
    if (!v.ok) { infoEl.textContent = v.error; return null; }
    infoEl.textContent = 'Đang đọc tài liệu…';
    try {
      const doc = await TK.loadPdfJsDoc(v.bytes);
      if (!current() || !ctx.isActive()) { try { doc.destroy(); } catch (e) {} return null; }
      infoEl.textContent = file.name + ' · ' + doc.numPages + ' trang';
      onLoaded(v.bytes, doc, file);
      return doc;
    } catch (e) {
      if (!current()) return null;
      infoEl.textContent = (e && e.friendly) ? e.friendly : U.MSG.invalidPdf;
      return null;
    }
  }

  // =====================================================================
  // TOOL: TÁCH PDF (trích xuất)
  // =====================================================================
  TK.registerTool({
    id: 'split',
    name: 'Tách PDF',
    desc: 'Trích xuất trang theo khoảng hoặc chọn',
    icon: 'scissors',
    async mount(container, ctx) {
      const w = TK.widgets;
      let board = null, curDoc = null;

      const infoEl = el('div', { className: 'pdftk-doc-info' });
      const boardHost = el('div', {});
      const resultHost = el('div', {});
      const rangeField = w.filenameField('Khoảng trang (ví dụ 1-3,8,10-12)', '');
      const nameField = w.filenameField('Tên file kết quả', 'trang-da-chon');

      const applyRangeBtn = w.button('Chọn theo khoảng', { icon: 'list-checks', variant: 'ghost', onClick: () => applyRange() });
      const exportOneBtn = w.button('Xuất 1 file PDF', { icon: 'file-output', block: true, onClick: () => exportSelected(false) });
      const exportZipBtn = w.button('Mỗi trang 1 file (ZIP)', { icon: 'files', variant: 'ghost', block: true, onClick: () => exportSelected(true) });

      const picker = w.filePicker({
        label: 'Chọn file PDF', icon: 'file-up', accept: 'application/pdf,.pdf',
        onFiles: (files) => load(files[0]),
      });

      const optsHost = el('div', { style: 'display:none' }, [
        w.section('Chọn trang', [rangeField.el, applyRangeBtn, w.hint('Hoặc chạm vào trang để chọn/bỏ chọn.')]),
        w.section('', [nameField.el]),
        w.section('', [exportOneBtn, exportZipBtn, resultHost]),
      ]);

      container.appendChild(w.section('', [w.hint('Chọn một file PDF rồi trích xuất trang cần lấy.'), picker, infoEl]));
      container.appendChild(boardHost);
      container.appendChild(optsHost);

      ctx.registerCleanup(() => { if (board) board.destroy(); if (curDoc) { try { curDoc.destroy(); } catch (e) {} } });

      let loadSeq = 0; // chống race: chọn file mới trước khi file cũ tải xong
      async function load(file) {
        const mySeq = ++loadSeq;
        if (board) { board.destroy(); board = null; }
        if (curDoc) { try { curDoc.destroy(); } catch (e) {} curDoc = null; }
        boardHost.replaceChildren(); resultHost.replaceChildren();
        optsHost.style.display = 'none';
        const loaded = await pickAndLoad(ctx, file, (bytes, doc) => {
          board = createPageBoard(ctx, bytes, doc, 'extract');
          board.setBaseName(file.name);
          boardHost.appendChild(board.gridEl);
          optsHost.style.display = '';
        }, infoEl, () => mySeq === loadSeq);
        if (mySeq === loadSeq) curDoc = loaded;
        else if (loaded) { try { loaded.destroy(); } catch (e) {} }
      }

      function applyRange() {
        if (!board) return;
        const parsed = U.parsePageRange(rangeField.value, board.pages.length);
        if (parsed.error) { if (window.ErrorHandler) ErrorHandler.showWarning(parsed.error); return; }
        board.setSelectionByPages(parsed.pages);
      }

      async function exportSelected(perPage) {
        if (!board) return;
        let sel = board.selectedList();
        if (!sel.length) {
          const parsed = rangeField.value.trim() ? U.parsePageRange(rangeField.value, board.pages.length) : { pages: [], error: null };
          if (parsed.error) { if (window.ErrorHandler) ErrorHandler.showWarning(parsed.error); return; }
          if (parsed.pages.length) {
            // Giữ ĐÚNG thứ tự người dùng nhập (vd "5,2,8" -> 5,2,8), không phải
            // thứ tự hiển thị. Lọc theo index sẽ trả sai thứ tự.
            sel = U.orderPagesBySelection(board.pages, parsed.pages);
          }
        }
        if (!sel.length) { if (window.ErrorHandler) ErrorHandler.showWarning('Vui lòng chọn ít nhất một trang.'); return; }

        if (perPage) {
          const out = await ctx.runTask({
            label: 'Đang tách trang…',
            run: async (token, progress) => {
              const results = await board.buildPerPage(sel, token, progress);
              progress.set(85, 'Đang đóng gói ZIP…');
              const zip = await TK.makeZip(results, (p) => progress.set(85 + p * 14, 'Đang đóng gói ZIP…'), token);
              return { zip, count: results.length };
            },
          });
          if (!out || !ctx.isActive()) return;
          const zipName = U.safeFileName(nameField.value || 'trang-da-tach', 'zip', 'trang-da-tach');
          resultHost.replaceChildren(w.resultActions({
            blob: out.zip, infoText: 'Đã tách ' + out.count + ' trang (ZIP) · ' + U.formatBytes(out.zip.size),
            onDownload: () => TK.downloadBlob(out.zip, zipName),
            onShare: () => TK.shareFile(out.zip, zipName, 'Tách PDF'),
          }));
        } else {
          const blob = await ctx.runTask({
            label: 'Đang trích xuất…',
            run: async (token, progress) => board.buildPdf(sel, token, progress),
          });
          if (!blob || !ctx.isActive()) return;
          const fn = U.safeFileName(nameField.value || 'trang-da-chon', 'pdf', 'trang-da-chon');
          resultHost.replaceChildren(w.resultActions({
            blob, infoText: 'Đã trích xuất ' + sel.length + ' trang · ' + U.formatBytes(blob.size),
            onDownload: () => TK.downloadBlob(blob, fn),
            onShare: () => TK.shareFile(blob, fn, 'Tách PDF'),
          }));
        }
        ctx.refreshIcons(resultHost);
        if (window.ErrorHandler) ErrorHandler.showSuccess('Trích xuất thành công.');
      }

      ctx.refreshIcons(container);
    },
  });

  // =====================================================================
  // TOOL: SẮP XẾP TRANG (quản lý)
  // =====================================================================
  TK.registerTool({
    id: 'organize',
    name: 'Sắp xếp trang',
    desc: 'Đổi thứ tự, xoay, xóa trang',
    icon: 'layout-grid',
    async mount(container, ctx) {
      const w = TK.widgets;
      let board = null, curDoc = null;

      const infoEl = el('div', { className: 'pdftk-doc-info' });
      const boardHost = el('div', {});
      const resultHost = el('div', {});
      const nameField = w.filenameField('Tên file kết quả', 'trang-da-sap-xep');

      const toolbar = el('div', { className: 'pdftk-page-toolbar', style: 'display:none' });
      const btnSelAll = w.button('Chọn tất cả', { icon: 'check-square', variant: 'ghost', onClick: () => board && board.selectAll() });
      const btnDesel = w.button('Bỏ chọn', { icon: 'square', variant: 'ghost', onClick: () => board && board.deselectAll() });
      const btnRotL = w.button('Xoay trái', { icon: 'rotate-ccw', variant: 'ghost', onClick: () => board && board.rotateSelected(-90) });
      const btnRotR = w.button('Xoay phải', { icon: 'rotate-cw', variant: 'ghost', onClick: () => board && board.rotateSelected(90) });
      const btnDel = w.button('Xóa trang chọn', { icon: 'trash-2', variant: 'danger', onClick: () => board && board.deleteSelected() });
      const btnUndo = w.button('Hoàn tác', { icon: 'undo-2', variant: 'ghost', onClick: () => board && board.undoOnce() });
      const btnReset = w.button('Đặt lại', { icon: 'rotate-ccw', variant: 'ghost', onClick: () => confirmReset() });
      [btnSelAll, btnDesel, btnRotL, btnRotR, btnDel, btnUndo, btnReset].forEach((b) => toolbar.appendChild(b));

      const exportBtn = w.button('Xuất PDF mới', { icon: 'file-output', block: true, onClick: () => doExport() });

      const optsHost = el('div', { style: 'display:none' }, [
        w.section('', [nameField.el]),
        w.section('', [exportBtn, resultHost]),
      ]);

      const picker = w.filePicker({
        label: 'Chọn file PDF', icon: 'file-up', accept: 'application/pdf,.pdf',
        onFiles: (files) => load(files[0]),
      });

      container.appendChild(w.section('', [w.hint('Chạm để chọn trang. Kéo lên/xuống bằng nút, xoay trái/phải, xóa, hoàn tác hoặc đặt lại.'), picker, infoEl]));
      container.appendChild(toolbar);
      container.appendChild(boardHost);
      container.appendChild(optsHost);

      ctx.registerCleanup(() => { if (board) board.destroy(); if (curDoc) { try { curDoc.destroy(); } catch (e) {} } });

      let loadSeq = 0; // chống race: chọn file mới trước khi file cũ tải xong
      async function load(file) {
        const mySeq = ++loadSeq;
        if (board) { board.destroy(); board = null; }
        if (curDoc) { try { curDoc.destroy(); } catch (e) {} curDoc = null; }
        boardHost.replaceChildren(); resultHost.replaceChildren();
        toolbar.style.display = 'none'; optsHost.style.display = 'none';
        const loaded = await pickAndLoad(ctx, file, (bytes, doc) => {
          board = createPageBoard(ctx, bytes, doc, 'manage');
          board.setBaseName(file.name);
          board.setOnChange(() => { btnUndo.disabled = !board.canUndo(); });
          btnUndo.disabled = true;
          boardHost.appendChild(board.gridEl);
          toolbar.style.display = ''; optsHost.style.display = '';
          ctx.refreshIcons(toolbar);
        }, infoEl, () => mySeq === loadSeq);
        if (mySeq === loadSeq) curDoc = loaded;
        else if (loaded) { try { loaded.destroy(); } catch (e) {} }
      }

      async function confirmReset() {
        if (!board) return;
        const ok = window.showConfirm ? await window.showConfirm('Đặt lại toàn bộ thay đổi về trạng thái ban đầu?', { title: 'Đặt lại', confirmText: 'Đặt lại' }) : true;
        if (ok) board.resetAll();
      }

      async function doExport() {
        if (!board) return;
        if (!board.pages.length) { if (window.ErrorHandler) ErrorHandler.showWarning('Không còn trang nào để xuất. Hãy đặt lại tài liệu.'); return; }
        const blob = await ctx.runTask({
          label: 'Đang tạo PDF…',
          run: async (token, progress) => board.buildPdf(board.pages, token, progress),
        });
        if (!blob || !ctx.isActive()) return;
        const fn = U.safeFileName(nameField.value || 'trang-da-sap-xep', 'pdf', 'trang-da-sap-xep');
        resultHost.replaceChildren(w.resultActions({
          blob, infoText: 'Đã tạo PDF · ' + board.pages.length + ' trang · ' + U.formatBytes(blob.size),
          onDownload: () => TK.downloadBlob(blob, fn),
          onShare: () => TK.shareFile(blob, fn, 'Sắp xếp trang'),
        }));
        ctx.refreshIcons(resultHost);
        if (window.ErrorHandler) ErrorHandler.showSuccess('Tạo PDF mới thành công.');
      }

      ctx.refreshIcons(container);
    },
  });
})();
