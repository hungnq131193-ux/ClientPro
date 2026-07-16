// assets/19_error_loading.js
// ============================================================
// CHUẨN HÓA ERROR MESSAGES & LOADING STATES (ClientPro)
// ------------------------------------------------------------
// Mục tiêu: một nguồn duy nhất để (1) báo lỗi thân thiện tiếng Việt có gợi ý
// hành động, phân loại rõ ràng, và (2) hiển thị trạng thái loading nhất quán.
//
// Triết lý dự án: vanilla JS, không framework, CSP nghiêm ngặt (không inline
// handler — mọi element tạo bằng DOM API, không innerHTML với biến), self-host.
//
// Export ra global:
//   window.ErrorHandler   — báo lỗi/thành công/cảnh báo + wrapAsync
//   window.LoadingManager — global overlay / button spinner / skeleton / progress
//   window.AppToast       — hệ thống toast 4 loại (success/error/warning/info)
//
// Tương thích ngược: showToast(msg) cũ vẫn hoạt động (được route sang AppToast).
// ============================================================
(function () {
  'use strict';

  // ----------------------------------------------------------
  // Tiện ích DOM tối giản (không phụ thuộc lucide re-render để tránh vỡ icon)
  // ----------------------------------------------------------
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgIcon(paths, opts) {
    opts = opts || {};
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', opts.strokeWidth || '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('width', opts.size || '20');
    svg.setAttribute('height', opts.size || '20');
    svg.setAttribute('aria-hidden', 'true');
    (Array.isArray(paths) ? paths : [paths]).forEach((d) => {
      if (!d) return;
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  // Icon paths (lucide-style, vẽ trực tiếp để không lệ thuộc render lại của lucide)
  const ICON_PATHS = {
    success: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4 12 14.01l-3-3'],
    error: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M15 9l-6 6', 'M9 9l6 6'],
    warning: ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
    info: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 16v-4', 'M12 8h.01'],
    offline: ['M1 1l22 22', 'M16.72 11.06A10.94 10.94 0 0 1 19 12.55', 'M5 12.55a10.94 10.94 0 0 1 5.17-2.39', 'M10.71 5.05A16 16 0 0 1 22.58 9', 'M1.42 9a15.91 15.91 0 0 1 4.7-2.88', 'M8.53 16.11a6 6 0 0 1 6.95 0', 'M12 20h.01'],
    help: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
    trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  };

  // Icon cho empty/error state (kích thước lớn hơn, nét mảnh).
  const STATE_ICON_PATHS = {
    inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
    search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
    users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    error: ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
    folder: ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'],
    camera: ['M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    building: ['M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16', 'M2 21h20', 'M9 21v-4h6v4', 'M8 7h.01', 'M12 7h.01', 'M16 7h.01', 'M8 11h.01', 'M12 11h.01', 'M16 11h.01'],
  };

  // ----------------------------------------------------------
  // AppToast — hệ thống toast xếp chồng, 4 loại
  // ----------------------------------------------------------
  const TOAST_TYPES = {
    success: { color: '#10b981', icon: 'success' },
    error: { color: '#ef4444', icon: 'error' },
    warning: { color: '#f59e0b', icon: 'warning' },
    info: { color: '#38bdf8', icon: 'info' },
  };

  let _toastHost = null;
  function toastHost() {
    if (_toastHost && document.body.contains(_toastHost)) return _toastHost;
    _toastHost = document.getElementById('app-toast-container');
    if (!_toastHost) {
      _toastHost = document.createElement('div');
      _toastHost.id = 'app-toast-container';
      _toastHost.setAttribute('role', 'status');
      _toastHost.setAttribute('aria-live', 'polite');
      document.body.appendChild(_toastHost);
    }
    return _toastHost;
  }

  // ----------------------------------------------------------
  // Haptics — rung phản hồi nhẹ (feature-detect, im lặng nếu không hỗ trợ).
  // Dùng chung cho toast lỗi, sai PIN, confirm nguy hiểm... Pattern ngắn,
  // không lạm dụng: chỉ những khoảnh khắc cần kéo sự chú ý của người dùng.
  // ----------------------------------------------------------
  const Haptics = {
    _buzz(pattern) {
      try {
        if (navigator.vibrate) navigator.vibrate(pattern);
      } catch (e) { }
    },
    light() { this._buzz(10); },        // xác nhận chạm (long-press, chọn)
    warning() { this._buzz(30); },      // cảnh báo / confirm nguy hiểm mở ra
    error() { this._buzz([45, 60, 45]); }, // lỗi / sai PIN — nhịp đôi dễ nhận biết
  };

  const AppToast = {
    // show(message, type, opts)
    //   type: 'success' | 'error' | 'warning' | 'info' (mặc định 'info')
    //   opts: { duration (ms, 0 = không tự đóng), icon ('offline'…) }
    show(message, type, opts) {
      if (!message) return;
      opts = opts || {};
      const cfg = TOAST_TYPES[type] || TOAST_TYPES.info;
      // Lỗi mặc định hiển thị lâu hơn để đọc kịp; success/info ngắn hơn.
      const isErr = type === 'error';
      // Toast lỗi kèm rung nhẹ — mobile-first, mắt có thể đang không nhìn màn hình.
      if (isErr) Haptics.error();
      const duration = (opts.duration != null) ? opts.duration : (isErr ? 6000 : (type === 'warning' ? 5000 : 3500));

      const host = toastHost();
      const item = document.createElement('div');
      item.className = 'app-toast app-toast-' + (type || 'info');
      item.style.setProperty('--toast-accent', cfg.color);

      const iconName = opts.icon && ICON_PATHS[opts.icon] ? opts.icon : cfg.icon;
      const iconWrap = document.createElement('span');
      iconWrap.className = 'app-toast-icon';
      iconWrap.appendChild(svgIcon(ICON_PATHS[iconName], { size: 20 }));

      const msg = document.createElement('span');
      msg.className = 'app-toast-msg';
      msg.textContent = String(message);

      item.appendChild(iconWrap);
      item.appendChild(msg);

      // Click để đóng sớm
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        item.classList.remove('app-toast-in');
        item.classList.add('app-toast-out');
        afterEnd(item, () => { try { item.remove(); } catch (e) {} });
      };
      item.addEventListener('click', close);

      host.appendChild(item);
      // Kích hoạt animation vào ở frame kế
      requestAnimationFrame(() => requestAnimationFrame(() => item.classList.add('app-toast-in')));

      if (duration > 0) setTimeout(close, duration);
      return close;
    },
    success(m, o) { return this.show(m, 'success', o); },
    error(m, o) { return this.show(m, 'error', o); },
    warning(m, o) { return this.show(m, 'warning', o); },
    info(m, o) { return this.show(m, 'info', o); },
  };

  function afterEnd(el, cb) {
    let done = false;
    const finish = () => { if (done) return; done = true; try { cb(); } catch (e) {} };
    try { el.addEventListener('transitionend', finish, { once: true }); } catch (e) {}
    setTimeout(finish, 400);
  }

  // ----------------------------------------------------------
  // ErrorHandler
  // ----------------------------------------------------------
  const ErrorHandler = {
    // Mỗi mã lỗi: userMessage (hiển thị) + technicalMessage (console) + type (toast) + icon
    ERROR_CODES: {
      NETWORK: {
        userMessage: 'Mất kết nối mạng. Vui lòng kiểm tra internet rồi thử lại.',
        technicalMessage: 'Network request failed',
        type: 'error',
      },
      OFFLINE: {
        userMessage: 'Bạn đang ngoại tuyến. Thao tác này cần có kết nối mạng.',
        technicalMessage: 'Operation requires network while offline',
        type: 'warning',
        icon: 'offline',
      },
      TIMEOUT: {
        userMessage: 'Máy chủ phản hồi chậm. Vui lòng thử lại sau giây lát.',
        technicalMessage: 'Request timed out',
        type: 'warning',
      },
      VALIDATION: {
        userMessage: 'Dữ liệu nhập chưa hợp lệ. Vui lòng kiểm tra lại.',
        technicalMessage: 'Validation failed',
        type: 'warning',
      },
      AUTH: {
        userMessage: 'Xác thực không thành công. Vui lòng thử lại.',
        technicalMessage: 'Authentication failed',
        type: 'error',
      },
      STORAGE: {
        userMessage: 'Không thể lưu dữ liệu. Bộ nhớ có thể đã đầy — hãy giải phóng bớt dung lượng.',
        technicalMessage: 'Storage/IndexedDB operation failed',
        type: 'error',
      },
      MAP: {
        userMessage: 'Không tính được khoảng cách đường bộ. Đã dùng khoảng cách đường chim bay thay thế.',
        technicalMessage: 'OSRM routing failed / low-confidence snap',
        type: 'warning',
      },
      BACKUP: {
        userMessage: 'Sao lưu chưa hoàn tất. Vui lòng kiểm tra kết nối Google Drive rồi thử lại.',
        technicalMessage: 'Backup / Drive sync failed',
        type: 'error',
      },
      CAMERA: {
        userMessage: 'Không mở được camera. Vui lòng cấp quyền camera hoặc kiểm tra thiết bị.',
        technicalMessage: 'getUserMedia failed',
        type: 'error',
      },
      UNKNOWN: {
        userMessage: 'Đã xảy ra lỗi. Vui lòng thử lại.',
        technicalMessage: 'Unknown error',
        type: 'error',
      },
    },

    // showError(codeOrMessage, customMessage, technicalDetail)
    //   - codeOrMessage: khóa trong ERROR_CODES (vd 'NETWORK') hoặc chuỗi tự do.
    //   - customMessage: ghi đè userMessage nếu muốn cụ thể hơn.
    //   - technicalDetail: Error/chuỗi để log ra console (không hiện cho user).
    showError(codeOrMessage, customMessage, technicalDetail) {
      let entry = this.ERROR_CODES[codeOrMessage];
      // Không mạng thật + đang gọi NETWORK → chuyển sang thông điệp OFFLINE rõ ràng hơn.
      if (entry && codeOrMessage === 'NETWORK' && this.isOffline()) {
        entry = this.ERROR_CODES.OFFLINE;
      }
      const userMessage = customMessage || (entry ? entry.userMessage : (typeof codeOrMessage === 'string' ? codeOrMessage : this.ERROR_CODES.UNKNOWN.userMessage));
      const type = entry ? entry.type : 'error';
      const icon = entry ? entry.icon : null;

      const tech = technicalDetail || (entry ? entry.technicalMessage : codeOrMessage);
      // Ghi log cục bộ (ring buffer) thay cho console.error thô — vẫn in dev-console
      // để tiện debug, nhưng không lộ chi tiết kỹ thuật cho user.
      this.logError('[' + (entry ? codeOrMessage : 'MESSAGE') + '] ' + userMessage, technicalDetail || tech);

      return AppToast.show(userMessage, type, icon ? { icon: icon } : undefined);
    },

    showSuccess(message) { return AppToast.success(message || 'Thành công'); },
    showWarning(message) { return AppToast.warning(message || 'Cảnh báo'); },
    showInfo(message) { return AppToast.info(message); },

    isOffline() {
      try { return navigator && navigator.onLine === false; } catch (e) { return false; }
    },

    // Phân loại một Error/DOMException thành mã lỗi phù hợp (best-effort).
    classify(err) {
      if (!err) return 'UNKNOWN';
      if (this.isOffline()) return 'OFFLINE';
      const name = (err.name || '') + '';
      const msg = (err.message || err + '') + '';
      if (name === 'AbortError' || /timeout|timed out/i.test(msg)) return 'TIMEOUT';
      if (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'NotReadableError') return 'CAMERA';
      if (name === 'QuotaExceededError' || /quota|storage/i.test(msg)) return 'STORAGE';
      if (/network|fetch|failed to fetch/i.test(msg)) return 'NETWORK';
      return 'UNKNOWN';
    },

    // ----------------------------------------------------------
    // Ghi log lỗi cục bộ (ring buffer trong localStorage) — phục vụ debug sau này
    // mà không cần backend. Giữ tối đa LOG_MAX bản ghi gần nhất.
    // ----------------------------------------------------------
    LOG_KEY: 'app_error_log',
    LOG_MAX: 50,

    logError(message, detail) {
      // Vẫn in ra console để lập trình viên debug tại chỗ (không phải lỗi "thô"
      // lộ cho user — user chỉ thấy toast thân thiện).
      try { console.error('[ClientPro]', message, detail != null ? detail : ''); } catch (e) {}
      try {
        const entry = {
          t: Date.now(),
          m: String(message == null ? '' : message).slice(0, 300),
          d: this._detailToString(detail).slice(0, 600),
        };
        let arr = [];
        try { arr = JSON.parse(localStorage.getItem(this.LOG_KEY) || '[]'); } catch (e) { arr = []; }
        if (!Array.isArray(arr)) arr = [];
        arr.push(entry);
        if (arr.length > this.LOG_MAX) arr = arr.slice(arr.length - this.LOG_MAX);
        localStorage.setItem(this.LOG_KEY, JSON.stringify(arr));
      } catch (e) { /* localStorage đầy/không khả dụng — bỏ qua, không chặn app */ }
    },

    _detailToString(detail) {
      if (detail == null) return '';
      if (typeof detail === 'string') return detail;
      try {
        if (detail instanceof Error) return (detail.name || 'Error') + ': ' + (detail.message || '') + (detail.stack ? '\n' + detail.stack : '');
        if (detail.message) return String(detail.message);
        return JSON.stringify(detail);
      } catch (e) { return String(detail); }
    },

    getErrorLog() {
      try { return JSON.parse(localStorage.getItem(this.LOG_KEY) || '[]') || []; } catch (e) { return []; }
    },

    clearErrorLog() {
      try { localStorage.removeItem(this.LOG_KEY); } catch (e) {}
    },

    // ----------------------------------------------------------
    // Global error handling: bắt lỗi không mong muốn (window.onerror) và
    // promise rejection không xử lý (unhandledrejection). Ghi log + báo toast
    // thân thiện, có tiết lưu (throttle) để tránh spam khi lỗi lặp.
    // ----------------------------------------------------------
    _globalInstalled: false,
    _lastGlobalToastAt: 0,

    installGlobalHandlers() {
      if (this._globalInstalled) return;
      this._globalInstalled = true;
      const self = this;

      window.addEventListener('error', function (ev) {
        // Bỏ qua lỗi tải tài nguyên (img/script) — không đáng báo cho user.
        if (ev && ev.target && ev.target !== window && (ev.target.tagName || '')) {
          self.logError('Resource load error', (ev.target.src || ev.target.href || ev.target.tagName));
          return;
        }
        const err = ev && ev.error ? ev.error : (ev && ev.message ? ev.message : 'Unknown error');
        self.logError('window.onerror: ' + (ev && ev.message ? ev.message : ''), err);
        self._notifyGlobal(err);
      });

      window.addEventListener('unhandledrejection', function (ev) {
        const reason = ev ? ev.reason : null;
        self.logError('unhandledrejection', reason);
        self._notifyGlobal(reason);
      });
    },

    // Báo toast thân thiện cho lỗi không mong muốn, tiết lưu 1 toast / 5s.
    _notifyGlobal(err) {
      const now = Date.now();
      if (now - this._lastGlobalToastAt < 5000) return;
      this._lastGlobalToastAt = now;
      const code = this.classify(err);
      // Nếu không phân loại được rõ ràng thì dùng thông điệp UNKNOWN nhẹ nhàng.
      const entry = this.ERROR_CODES[code] || this.ERROR_CODES.UNKNOWN;
      AppToast.show(entry.userMessage, entry.type, entry.icon ? { icon: entry.icon } : undefined);
    },

    // ----------------------------------------------------------
    // Hộp thoại xác nhận (thay cho confirm() gốc) — trả về Promise<boolean>.
    // CSP-safe: tạo hoàn toàn bằng DOM API, không inline handler.
    //   opts: { title, confirmText, cancelText, danger, icon }
    // ----------------------------------------------------------
    confirm(message, opts) {
      return ClientProConfirm(message, opts);
    },

    // wrapAsync(fn, options)
    //   Bọc một async operation: tự bật loading, tự catch + báo lỗi phân loại.
    //   options:
    //     loading: false | 'global' | { type:'global', message } | { type:'button', el, text }
    //     errorCode: mã lỗi mặc định khi có exception (mặc định tự classify)
    //     successMessage: chuỗi báo thành công khi xong
    //     rethrow: true để ném lại lỗi cho caller xử lý tiếp
    async wrapAsync(fn, options) {
      options = options || {};
      const loading = options.loading;
      let stopLoading = null;
      try {
        if (loading === 'global' || (loading && loading.type === 'global')) {
          LoadingManager.showGlobal(loading && loading.message ? loading.message : 'Đang xử lý...');
          stopLoading = () => LoadingManager.hideGlobal();
        } else if (loading && loading.type === 'button' && loading.el) {
          LoadingManager.showButtonLoading(loading.el, loading.text);
          stopLoading = () => LoadingManager.hideButtonLoading(loading.el);
        }

        const result = await fn();

        if (stopLoading) stopLoading();
        stopLoading = null;
        if (options.successMessage) this.showSuccess(options.successMessage);
        return result;
      } catch (err) {
        if (stopLoading) { try { stopLoading(); } catch (e) {} }
        const code = options.errorCode || this.classify(err);
        this.showError(code, options.errorMessage, err);
        if (options.rethrow) throw err;
        return undefined;
      }
    },
  };

  // ----------------------------------------------------------
  // LoadingManager
  // ----------------------------------------------------------
  const LoadingManager = {
    _globalCount: 0,
    _originalLoaderText: 'Đang tải...',

    // Global overlay — tái sử dụng #loader sẵn có (spinner + #loader-text).
    showGlobal(message) {
      this._globalCount++;
      const loader = document.getElementById('loader');
      const text = document.getElementById('loader-text');
      if (text) text.textContent = message || 'Đang xử lý...';
      if (loader) loader.classList.remove('hidden');
      if (loader) loader.classList.remove('is-progress');
    },

    hideGlobal(force) {
      if (force) this._globalCount = 0;
      else this._globalCount = Math.max(0, this._globalCount - 1);
      if (this._globalCount > 0) return;
      const loader = document.getElementById('loader');
      const text = document.getElementById('loader-text');
      if (loader) { loader.classList.add('hidden'); loader.classList.remove('is-progress'); }
      if (text) text.textContent = this._originalLoaderText;
      this._setProgressBar(null);
    },

    // Progress trong global overlay: "Đang sao lưu… 67%"
    showProgress(message, percent) {
      this.showGlobal(message || 'Đang xử lý...');
      const loader = document.getElementById('loader');
      const text = document.getElementById('loader-text');
      if (loader) loader.classList.add('is-progress');
      if (typeof percent === 'number' && text) {
        const pct = Math.max(0, Math.min(100, Math.round(percent)));
        text.textContent = (message || 'Đang xử lý...') + ' ' + pct + '%';
        this._setProgressBar(pct);
      }
    },

    _setProgressBar(pct) {
      const loader = document.getElementById('loader');
      if (!loader) return;
      let bar = loader.querySelector('.global-progress-bar');
      if (pct == null) { if (bar) bar.remove(); return; }
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'global-progress-bar';
        const fill = document.createElement('div');
        fill.className = 'global-progress-fill';
        bar.appendChild(fill);
        loader.appendChild(bar);
      }
      const fill = bar.querySelector('.global-progress-fill');
      if (fill) fill.style.width = pct + '%';
    },

    // Button spinner + tự disable. Lưu nhãn gốc để phục hồi.
    showButtonLoading(btn, text) {
      if (!btn) return;
      if (btn.dataset.loading === '1') return;
      btn.dataset.loading = '1';
      btn.dataset.originalHtml = btn.innerHTML;
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      btn.classList.add('btn-loading');
      const spinner = document.createElement('span');
      spinner.className = 'btn-spinner';
      const label = document.createElement('span');
      label.className = 'btn-loading-label';
      label.textContent = text || '';
      btn.replaceChildren(spinner, label);
    },

    hideButtonLoading(btn, restoreText) {
      if (!btn) return;
      if (btn.dataset.loading !== '1') return;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.classList.remove('btn-loading');
      if (typeof restoreText === 'string') {
        btn.textContent = restoreText;
      } else if (btn.dataset.originalHtml != null) {
        btn.innerHTML = btn.dataset.originalHtml;
      }
      delete btn.dataset.loading;
      delete btn.dataset.originalHtml;
    },

    // Skeleton loading cho danh sách. Chèn n thẻ skeleton vào container.
    showSkeleton(container, count) {
      const el = (typeof container === 'string') ? document.querySelector(container) : container;
      if (!el) return;
      el.classList.add('is-loading');
      const wrap = document.createElement('div');
      wrap.className = 'skeleton-wrap';
      wrap.dataset.skeleton = '1';
      const n = count || 4;
      for (let i = 0; i < n; i++) {
        const card = document.createElement('div');
        card.className = 'skeleton-card';
        const line1 = document.createElement('div');
        line1.className = 'skeleton skeleton-line skeleton-line-lg';
        const line2 = document.createElement('div');
        line2.className = 'skeleton skeleton-line skeleton-line-sm';
        card.appendChild(line1);
        card.appendChild(line2);
        wrap.appendChild(card);
      }
      el.appendChild(wrap);
    },

    hideSkeleton(container) {
      const el = (typeof container === 'string') ? document.querySelector(container) : container;
      if (!el) return;
      el.classList.remove('is-loading');
      el.querySelectorAll('[data-skeleton="1"]').forEach((s) => { try { s.remove(); } catch (e) {} });
    },

    // --------------------------------------------------------
    // Empty / Error state cho danh sách (trống, không có kết quả tìm kiếm, lỗi).
    // Dùng chung một markup gọn, CSP-safe (DOM API, icon inline SVG).
    //   spec: { icon, title, message, actionText, onAction }
    //   variant: 'empty' | 'search' | 'error'
    // --------------------------------------------------------
    renderState(container, spec, variant) {
      const el = (typeof container === 'string') ? document.querySelector(container) : container;
      if (!el) return;
      spec = spec || {};
      this.hideSkeleton(el);
      this.clearState(el);

      const wrap = document.createElement('div');
      wrap.className = 'cp-state cp-state-' + (variant || 'empty');
      wrap.dataset.cpState = '1';

      const iconWrap = document.createElement('div');
      iconWrap.className = 'cp-state-icon';
      const iconName = spec.icon || (variant === 'error' ? 'error' : (variant === 'search' ? 'search' : 'inbox'));
      iconWrap.appendChild(svgIcon(STATE_ICON_PATHS[iconName] || STATE_ICON_PATHS.inbox, { size: 40, strokeWidth: '1.6' }));
      wrap.appendChild(iconWrap);

      if (spec.title) {
        const h = document.createElement('div');
        h.className = 'cp-state-title';
        h.textContent = spec.title;
        wrap.appendChild(h);
      }
      if (spec.message) {
        const p = document.createElement('div');
        p.className = 'cp-state-msg';
        p.textContent = spec.message;
        wrap.appendChild(p);
      }
      if (spec.actionText && typeof spec.onAction === 'function') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cp-state-action';
        btn.textContent = spec.actionText;
        btn.addEventListener('click', function () { try { spec.onAction(); } catch (e) {} });
        wrap.appendChild(btn);
      }

      el.appendChild(wrap);
      return wrap;
    },

    showEmptyState(container, spec) { return this.renderState(container, spec, 'empty'); },
    showSearchEmptyState(container, spec) { return this.renderState(container, spec, 'search'); },
    showErrorState(container, spec) { return this.renderState(container, spec, 'error'); },

    clearState(container) {
      const el = (typeof container === 'string') ? document.querySelector(container) : container;
      if (!el) return;
      el.querySelectorAll('[data-cp-state="1"]').forEach((s) => { try { s.remove(); } catch (e) {} });
    },

    init() {
      // Reset trạng thái nếu app khởi động lại (SW update…)
      this._globalCount = 0;
    },
  };

  // ----------------------------------------------------------
  // ClientProConfirm — hộp thoại xác nhận thay cho confirm() gốc.
  // Trả về Promise<boolean> (true = đồng ý, false = hủy). CSP-safe.
  // ----------------------------------------------------------
  let _confirmOpen = false;
  // Tham chiếu cleanup của confirm đang mở. Khi một confirm mới thay thế confirm cũ,
  // phải đóng confirm cũ qua cleanup chính thức (resolve(false) + gỡ listener) —
  // chỉ remove() overlay sẽ để Promise treo vĩnh viễn và leak keydown listener,
  // làm kẹt mọi cờ in-flight của caller đang await.
  let _activeConfirmClose = null;
  function ClientProConfirm(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      // Tránh chồng nhiều hộp thoại: confirm cũ được hủy như khi người dùng bấm Hủy.
      if (_activeConfirmClose) {
        try { _activeConfirmClose(false); } catch (e) {}
      }
      _confirmOpen = true;

      const overlay = document.createElement('div');
      overlay.className = 'cp-confirm-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const dialog = document.createElement('div');
      dialog.className = 'cp-confirm-dialog' + (opts.danger ? ' cp-confirm-danger' : '');
      // Confirm nguy hiểm (xóa dữ liệu...) rung nhẹ khi mở — chặn thao tác vô thức.
      if (opts.danger) Haptics.warning();

      const iconName = opts.icon || (opts.danger ? 'trash' : 'help');
      if (ICON_PATHS[iconName]) {
        const ic = document.createElement('div');
        ic.className = 'cp-confirm-icon';
        ic.appendChild(svgIcon(ICON_PATHS[iconName], { size: 26 }));
        dialog.appendChild(ic);
      }

      if (opts.title) {
        const h = document.createElement('div');
        h.className = 'cp-confirm-title';
        h.textContent = opts.title;
        dialog.appendChild(h);
      }

      const body = document.createElement('div');
      body.className = 'cp-confirm-msg';
      body.textContent = String(message == null ? '' : message);
      dialog.appendChild(body);

      const actions = document.createElement('div');
      actions.className = 'cp-confirm-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'cp-confirm-btn cp-confirm-cancel';
      cancelBtn.textContent = opts.cancelText || 'Hủy';

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'cp-confirm-btn cp-confirm-ok' + (opts.danger ? ' cp-confirm-ok-danger' : '');
      okBtn.textContent = opts.confirmText || 'Đồng ý';

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      dialog.appendChild(actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      let settled = false;
      function cleanup(result) {
        if (settled) return;
        settled = true;
        _confirmOpen = false;
        if (_activeConfirmClose === cleanup) _activeConfirmClose = null;
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.remove('cp-confirm-in');
        afterEnd(overlay, () => { try { overlay.remove(); } catch (e) {} });
        resolve(result);
      }
      _activeConfirmClose = cleanup;
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
        else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
      }

      cancelBtn.addEventListener('click', () => cleanup(false));
      okBtn.addEventListener('click', () => cleanup(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
      document.addEventListener('keydown', onKey, true);

      requestAnimationFrame(() => requestAnimationFrame(() => {
        // Nếu confirm đã bị đóng (vd: bị confirm khác thay thế ngay lập tức)
        // thì không animate-in lại overlay đang được gỡ bỏ.
        if (settled) return;
        overlay.classList.add('cp-confirm-in');
        try { okBtn.focus(); } catch (e) {}
      }));
    });
  }

  // ----------------------------------------------------------
  // Export global + tương thích ngược
  // ----------------------------------------------------------
  window.AppToast = AppToast;
  window.ErrorHandler = ErrorHandler;
  window.LoadingManager = LoadingManager;
  window.Haptics = Haptics;

  // Alias tiện dụng dùng khắp codebase
  window.showError = function (code, msg, tech) { return ErrorHandler.showError(code, msg, tech); };
  window.showSuccess = function (msg) { return ErrorHandler.showSuccess(msg); };
  window.showWarning = function (msg) { return ErrorHandler.showWarning(msg); };
  window.startLoading = function (msg) { return LoadingManager.showGlobal(msg); };
  window.stopLoading = function () { return LoadingManager.hideGlobal(true); };
  // Hộp thoại xác nhận dùng chung (thay confirm()) — trả về Promise<boolean>.
  window.showConfirm = function (msg, opts) { return ClientProConfirm(msg, opts); };

  // Nâng cấp showToast() cũ: giữ nguyên chữ ký showToast(msg[, type]) nhưng
  // dùng hệ thống toast mới (mặc định success để giữ cảm giác quen thuộc — bản
  // cũ luôn hiện dấu check xanh). Không phá vỡ ~60 lời gọi hiện có.
  window.showToast = function (msg, type) {
    return AppToast.show(msg, type || 'success');
  };
})();
