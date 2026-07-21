// assets/pdf-toolkit/pdf_toolkit_ui.js
// ============================================================================
// PDF Toolkit — KHUNG UI + điều hướng + dọn bộ nhớ + tích hợp khóa app.
//
// Public API DUY NHẤT: window.PdfToolkit = { open, close, reset }.
// Cascade back gọi: window.pdfToolkitHandleBack().
//
// Màn hình #screen-pdf-toolkit là slide-in độc lập (giống #screen-map), z-20.
// Toàn bộ DOM dựng bằng el()/DOM API (CSP-safe, không innerHTML dữ liệu người dùng).
// ============================================================================
(function () {
  'use strict';

  const TK = window.__PdfTK;
  const U = TK.U;

  // Trạng thái màn hình + phiên tool hiện tại.
  const state = {
    built: false,
    open: false,
    currentTool: null,   // id tool đang mở, null nếu đang ở lưới
    session: null,       // phiên tool (cleanups, cancel tokens, seq)
    seq: 0,
  };

  let screenEl, gridWrapEl, toolViewEl, headerTitleEl, progressHostEl;

  // ----------------------------------------------------------------------
  // Icon lucide (i[data-lucide]) — render lại sau khi chèn DOM.
  // ----------------------------------------------------------------------
  function icon(name, cls) {
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    if (cls) i.className = cls;
    return i;
  }
  function refreshIcons() {
    // Gọi bare như phần còn lại của app (build lucide này mặc định nameAttr=data-lucide).
    try { if (window.lucide && lucide.createIcons) lucide.createIcons(); }
    catch (e) {}
  }

  // ----------------------------------------------------------------------
  // Dựng khung màn hình (một lần).
  // ----------------------------------------------------------------------
  function build() {
    if (state.built) return;

    const backBtn = el('button', {
      className: 'pdftk-back-btn',
      type: 'button',
      'aria-label': 'Quay lại',
      on: { click: () => { onBack(); } },
    }, [icon('arrow-left', 'w-6 h-6')]);

    headerTitleEl = el('h2', { className: 'pdftk-title', text: 'Bộ công cụ PDF' });

    const infoBtn = el('button', {
      className: 'pdftk-info-btn',
      type: 'button',
      'aria-label': 'Thông tin quyền riêng tư',
      on: { click: () => showPrivacyInfo() },
    }, [icon('shield-check', 'w-5 h-5')]);

    const header = el('header', { className: 'pdftk-header' }, [
      el('div', { className: 'pdftk-header-row' }, [backBtn, headerTitleEl, infoBtn]),
    ]);

    gridWrapEl = el('div', { className: 'pdftk-grid-wrap' });
    toolViewEl = el('div', { className: 'pdftk-tool-view', style: 'display:none' });
    progressHostEl = el('div', { className: 'pdftk-progress-host' });

    const scroll = el('div', { className: 'pdftk-scroll scroll-area' }, [gridWrapEl, toolViewEl]);

    screenEl = el('div', {
      id: 'screen-pdf-toolkit',
      className: 'app-container z-20 transform translate-x-full transition-transform duration-300 pdftk-screen',
    }, [header, scroll, progressHostEl]);

    document.body.appendChild(screenEl);
    state.built = true;
  }

  // ----------------------------------------------------------------------
  // Lưới 6 tool.
  // ----------------------------------------------------------------------
  function renderGrid() {
    gridWrapEl.replaceChildren();

    const intro = el('p', {
      className: 'pdftk-intro',
      text: 'Mọi thao tác diễn ra ngay trên thiết bị. File không được tải lên đâu cả.',
    });
    gridWrapEl.appendChild(intro);

    const grid = el('div', { className: 'pdftk-tool-grid' });
    for (const tool of TK.getTools()) {
      const card = el('button', {
        className: 'pdftk-tool-card',
        type: 'button',
        on: { click: () => openTool(tool.id) },
      }, [
        el('span', { className: 'pdftk-tool-icon' }, [icon(tool.icon || 'file', 'w-6 h-6')]),
        el('span', { className: 'pdftk-tool-body' }, [
          el('strong', { className: 'pdftk-tool-name', text: tool.name }),
          el('span', { className: 'pdftk-tool-desc', text: tool.desc || '' }),
        ]),
        el('span', { className: 'pdftk-tool-ready', text: 'Sẵn sàng' }),
      ]);
      grid.appendChild(card);
    }
    gridWrapEl.appendChild(grid);
    refreshIcons(gridWrapEl);
  }

  // ----------------------------------------------------------------------
  // Phiên tool — gom cleanups, cancel tokens, seq token (chống kết quả về muộn).
  // ----------------------------------------------------------------------
  function makeSession() {
    const seq = ++state.seq;
    const cleanups = [];
    const cancels = [];
    let inFlight = false;
    return {
      seq,
      isActive() { return state.open && state.session && state.session.seq === seq; },
      registerCleanup(fn) { if (typeof fn === 'function') cleanups.push(fn); },
      trackCancel(token) { if (token) cancels.push(token); },
      get busy() { return inFlight; },
      set busy(v) { inFlight = !!v; },
      dispose() {
        for (const t of cancels.splice(0)) { try { t.cancel(); } catch (e) {} }
        for (const fn of cleanups.splice(0)) { try { fn(); } catch (e) {} }
      },
    };
  }

  function disposeSession() {
    if (state.session) { try { state.session.dispose(); } catch (e) {} }
    state.session = null;
    // Dọn bộ nhớ chung của toolkit.
    TK.revokeAllObjectURLs();
    hideProgress();
  }

  // ----------------------------------------------------------------------
  // Mở một tool.
  // ----------------------------------------------------------------------
  async function openTool(id) {
    const tool = TK.getTools().find((t) => t.id === id);
    if (!tool) return;

    // Đóng tool cũ (nếu có) và dựng phiên mới.
    disposeSession();
    toolViewEl.replaceChildren();
    state.session = makeSession();
    state.currentTool = id;

    headerTitleEl.textContent = tool.name;
    gridWrapEl.style.display = 'none';
    toolViewEl.style.display = '';

    // Đẩy một bước lịch sử để back/vuốt cạnh quay về lưới đúng một lớp.
    try { history.pushState({ __clientpro_edge_back: 1 }, document.title, location.href); } catch (e) {}

    // Nạp vendor ở nền khi vào tool đầu tiên (progress nhẹ nếu lâu).
    const ctx = makeToolContext(state.session);
    try {
      await tool.mount(toolViewEl, ctx);
    } catch (e) {
      if (window.ErrorHandler) ErrorHandler.showError('UNKNOWN', 'Không mở được công cụ. Vui lòng thử lại.');
    }
    refreshIcons(toolViewEl);
  }

  // Quay về lưới tool.
  function showGrid(fromPopstate) {
    disposeSession();
    state.currentTool = null;
    toolViewEl.replaceChildren();
    toolViewEl.style.display = 'none';
    gridWrapEl.style.display = '';
    headerTitleEl.textContent = 'Bộ công cụ PDF';
    // Tiêu thụ bước lịch sử đã đẩy khi mở tool (module edge-back tự bỏ qua nếu là popstate).
    if (!fromPopstate && window.__edgeBackSwipe && typeof window.__edgeBackSwipe.consumeTrackedHistoryStep === 'function') {
      window.__edgeBackSwipe.consumeTrackedHistoryStep();
    }
  }

  // Xử lý back của header (tap).
  function onBack() {
    if (state.currentTool) { showGrid(false); return; }
    close();
  }

  // Cascade back (vuốt cạnh / popstate) gọi hàm này.
  function handleBack() {
    if (!state.open) return false;
    if (state.currentTool) { showGrid(false); return true; }
    close();
    return true;
  }

  // ----------------------------------------------------------------------
  // Mở / đóng / reset màn hình.
  // ----------------------------------------------------------------------
  function open() {
    build();
    if (state.open) return;
    state.open = true;
    renderGrid();
    // Slide-in (giống các screen khác: bỏ translate-x-full ở frame kế).
    if (typeof slideScreenIn === 'function') slideScreenIn(screenEl);
    else if (typeof nextFrame === 'function') nextFrame(() => screenEl.classList.remove('translate-x-full'));
    else setTimeout(() => screenEl.classList.remove('translate-x-full'), 10);
    refreshIcons(screenEl);
  }

  function close() {
    if (!state.built || !state.open) return;
    disposeSession();
    state.currentTool = null;
    state.open = false;
    toolViewEl.replaceChildren();
    toolViewEl.style.display = 'none';
    gridWrapEl.style.display = '';
    headerTitleEl.textContent = 'Bộ công cụ PDF';
    const finish = () => { /* giữ trong DOM, chỉ trượt ra */ };
    if (typeof slideScreenOut === 'function') slideScreenOut(screenEl, finish);
    else { screenEl.classList.add('translate-x-full'); setTimeout(finish, 300); }
  }

  // Reset hoàn toàn (dùng khi khóa app).
  function reset() {
    disposeSession();
    state.currentTool = null;
    if (state.built) {
      toolViewEl.replaceChildren();
      toolViewEl.style.display = 'none';
      gridWrapEl.style.display = '';
      headerTitleEl.textContent = 'Bộ công cụ PDF';
      screenEl.classList.add('translate-x-full');
    }
    state.open = false;
  }

  // ----------------------------------------------------------------------
  // Thông tin quyền riêng tư (dùng confirm dialog chuẩn của app, chỉ 1 nút).
  // ----------------------------------------------------------------------
  function showPrivacyInfo() {
    const msg = 'Bộ công cụ PDF xử lý file hoàn toàn trên thiết bị của bạn. '
      + 'File không được tải lên Google Drive, máy chủ hay bất kỳ dịch vụ nào, '
      + 'và không được lưu vào cơ sở dữ liệu ứng dụng. Khi bạn đóng công cụ hoặc '
      + 'khóa ứng dụng, dữ liệu tạm sẽ được giải phóng.';
    if (window.showConfirm) window.showConfirm(msg, { title: 'Quyền riêng tư', confirmText: 'Đã hiểu', cancelText: 'Đóng', icon: 'help' });
    else if (window.ErrorHandler) ErrorHandler.showInfo('File được xử lý hoàn toàn trên thiết bị.');
  }

  // ----------------------------------------------------------------------
  // PROGRESS + CANCEL overlay (bottom sheet trong màn hình toolkit).
  //   Chỉ một tác vụ nặng tại một thời điểm (in-flight guard theo session).
  // ----------------------------------------------------------------------
  let _progressEls = null;
  function showProgress(label, onCancel) {
    hideProgress();
    const bar = el('div', { className: 'pdftk-progress-fill' });
    const track = el('div', { className: 'pdftk-progress-track' }, [bar]);
    const text = el('div', { className: 'pdftk-progress-label', text: label || 'Đang xử lý…' });
    const cancelBtn = el('button', {
      className: 'pdftk-progress-cancel', type: 'button', text: 'Hủy',
      on: { click: () => { try { if (onCancel) onCancel(); } catch (e) {} } },
    });
    const sheet = el('div', { className: 'pdftk-progress-sheet', role: 'status', 'aria-live': 'polite' }, [
      el('div', { className: 'pdftk-progress-top' }, [text, cancelBtn]), track,
    ]);
    progressHostEl.appendChild(sheet);
    progressHostEl.classList.add('is-visible');
    _progressEls = { sheet, bar, text };
    return {
      set(pct, msg) {
        if (typeof pct === 'number' && _progressEls) _progressEls.bar.style.width = Math.max(0, Math.min(100, Math.round(pct))) + '%';
        if (msg && _progressEls) _progressEls.text.textContent = msg;
      },
      done() { hideProgress(); },
    };
  }
  function hideProgress() {
    if (progressHostEl) { progressHostEl.replaceChildren(); progressHostEl.classList.remove('is-visible'); }
    _progressEls = null;
  }

  // ----------------------------------------------------------------------
  // WIDGET builders dùng chung cho các tool (CSP-safe, textContent/DOM API).
  // ----------------------------------------------------------------------
  const widgets = {
    // Nút chọn file mở input ẩn. Reset value sau mỗi lần để chọn lại cùng file.
    filePicker(opts) {
      const input = el('input', {
        type: 'file', className: 'pdftk-hidden-input',
        accept: opts.accept || '', multiple: !!opts.multiple,
      });
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.value = ''; // cho phép chọn lại cùng file
        if (files.length && typeof opts.onFiles === 'function') opts.onFiles(files);
      });
      const btn = el('button', {
        type: 'button', className: 'pdftk-btn pdftk-btn-primary pdftk-picker',
        on: { click: () => input.click() },
      }, [icon(opts.icon || 'plus', 'w-5 h-5'), el('span', { text: opts.label || 'Chọn file' })]);
      const wrap = el('div', { className: 'pdftk-picker-wrap' }, [btn, input]);
      return wrap;
    },
    // Ô nhập tên file kết quả.
    filenameField(labelText, defaultName) {
      const inp = el('input', {
        type: 'text', className: 'pdftk-input', value: defaultName || '',
        spellcheck: false, autocomplete: 'off',
      });
      inp.setAttribute('autocapitalize', 'off');
      const wrap = el('label', { className: 'pdftk-field' }, [
        el('span', { className: 'pdftk-field-label', text: labelText || 'Tên file' }), inp,
      ]);
      return { el: wrap, get value() { return inp.value; } };
    },
    // Nhóm nút chọn (segmented). options: [{value,label}].
    segmented(labelText, options, value, onChange) {
      let cur = value;
      const btns = [];
      const group = el('div', { className: 'pdftk-segmented' });
      options.forEach((o) => {
        const b = el('button', {
          type: 'button', className: 'pdftk-seg' + (o.value === cur ? ' is-active' : ''),
          text: o.label,
          on: { click: () => { cur = o.value; btns.forEach((x) => x.classList.toggle('is-active', x === b)); if (onChange) onChange(cur); } },
        });
        btns.push(b); group.appendChild(b);
      });
      const wrap = el('div', { className: 'pdftk-field' }, [
        labelText ? el('span', { className: 'pdftk-field-label', text: labelText }) : null, group,
      ]);
      return { el: wrap, get value() { return cur; } };
    },
    button(label, opts) {
      opts = opts || {};
      const kids = [];
      if (opts.icon) kids.push(icon(opts.icon, 'w-5 h-5'));
      kids.push(el('span', { text: label }));
      return el('button', {
        type: 'button',
        className: 'pdftk-btn ' + (opts.variant === 'ghost' ? 'pdftk-btn-ghost' : (opts.variant === 'danger' ? 'pdftk-btn-danger' : 'pdftk-btn-primary')) + (opts.block ? ' pdftk-btn-block' : ''),
        on: { click: opts.onClick || (() => {}) },
      }, kids);
    },
    // Panel kết quả: dung lượng + Tải + Chia sẻ (nếu hỗ trợ).
    resultActions(opts) {
      const info = el('div', { className: 'pdftk-result-info' }, [
        icon('check-circle-2', 'w-5 h-5'),
        el('span', { text: opts.infoText || ('Đã tạo file · ' + U.formatBytes(opts.blob ? opts.blob.size : 0)) }),
      ]);
      const actions = el('div', { className: 'pdftk-result-actions' });
      actions.appendChild(widgets.button('Tải xuống', {
        icon: 'download', onClick: () => { if (opts.onDownload) opts.onDownload(); },
      }));
      if (opts.onShare && TK.canShareFiles()) {
        actions.appendChild(widgets.button('Chia sẻ', {
          icon: 'share-2', variant: 'ghost', onClick: () => { opts.onShare(); },
        }));
      }
      return el('div', { className: 'pdftk-result' }, [info, actions]);
    },
    hint(text) { return el('p', { className: 'pdftk-hint-text', text: text }); },
    section(titleText, kids) {
      return el('section', { className: 'pdftk-section' }, [
        titleText ? el('h3', { className: 'pdftk-section-title', text: titleText }) : null,
      ].concat(kids || []));
    },
  };
  window.__PdfTK.widgets = widgets;

  // ----------------------------------------------------------------------
  // Tool context — API các module tool dùng.
  // ----------------------------------------------------------------------
  function makeToolContext(session) {
    return {
      TK,
      U,
      icon,
      refreshIcons,
      widgets,
      // Chạy tác vụ dài có progress + cancel + in-flight guard + try/finally.
      //   opts: { label, run: async (token, progress) => result }
      async runTask(opts) {
        if (!session.isActive()) return null;
        if (session.busy) { if (window.ErrorHandler) ErrorHandler.showWarning('Đang có một tác vụ chạy, vui lòng đợi.'); return null; }
        session.busy = true;
        const token = U.createCancelToken();
        session.trackCancel(token);
        const progress = showProgress(opts.label || 'Đang xử lý…', () => token.cancel());
        try {
          const result = await opts.run(token, progress);
          return result;
        } catch (e) {
          if (U.isCancel(e)) { return null; }
          const friendly = (e && e.friendly) ? e.friendly : null;
          if (window.ErrorHandler) {
            if (friendly) ErrorHandler.showError('UNKNOWN', friendly);
            else ErrorHandler.showError(ErrorHandler.classify(e), undefined, e);
          }
          return null;
        } finally {
          session.busy = false;
          progress.done();
        }
      },
      showProgressSheet: showProgress,
      isActive() { return session.isActive(); },
      registerCleanup(fn) { session.registerCleanup(fn); },
      requestGrid() { showGrid(false); },
    };
  }

  // ----------------------------------------------------------------------
  // TÍCH HỢP KHÓA APP — quan sát #screen-lock hiện ra (không sửa logic khóa).
  //   Khi app khóa: hủy tác vụ, xóa dữ liệu tạm, đóng toolkit; KHÔNG tự mở lại.
  // ----------------------------------------------------------------------
  function watchLock() {
    const lock = document.getElementById('screen-lock');
    if (!lock) { setTimeout(watchLock, 500); return; }
    const check = () => {
      const locked = !lock.classList.contains('hidden');
      if (locked && state.open) reset();
    };
    try {
      const mo = new MutationObserver(check);
      mo.observe(lock, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
    // App ẩn (chuyển nền) trong lúc xử lý: hủy tác vụ để không giữ file/rò rỉ.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && state.session && state.session.busy) {
        try { state.session.dispose(); } catch (e) {}
        state.session = null;
        hideProgress();
      }
    });
    window.addEventListener('pagehide', () => { try { disposeSession(); } catch (e) {} });
  }

  // ----------------------------------------------------------------------
  // Export.
  // ----------------------------------------------------------------------
  window.PdfToolkit = { open, close, reset };
  window.pdfToolkitHandleBack = handleBack;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLock);
  else watchLock();
})();
