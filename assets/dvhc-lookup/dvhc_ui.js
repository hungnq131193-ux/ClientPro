// assets/dvhc-lookup/dvhc_ui.js
// ============================================================================
// DVHC Lookup — KHUNG UI + điều hướng + tích hợp khóa app.
//
// Public API DUY NHẤT: window.DvhcLookup = { open, close, reset }.
// Cascade back gọi: window.dvhcLookupHandleBack().
//
// Màn hình #screen-dvhc-lookup là slide-in độc lập (giống #screen-pdf-toolkit),
// z-20, MỘT cấp điều hướng (không push history nội bộ — back luôn đóng screen).
// Toàn bộ DOM dựng bằng el()/DOM API (CSP-safe, không innerHTML dữ liệu động).
// ============================================================================
(function () {
  'use strict';

  const U = window.DvhcUtils;
  const D = window.__DvhcData;

  const TITLE = 'Tra cứu sáp nhập ĐVHC';
  const SEARCH_LIMIT = 30;

  const state = {
    built: false,
    open: false,
    tab: 'forward', // 'forward' | 'reverse' | 'convert'
    index: null,    // chỉ mục tra cứu sau khi nạp
    loadSeq: 0,     // chống kết quả nạp về muộn sau khi reset/close
  };

  let screenEl, bodyEl, tabButtons = {}, views = {};
  let packStatusEl, packFileInput;

  // ----------------------------------------------------------------------
  // Helpers chung.
  // ----------------------------------------------------------------------
  function icon(name, cls) {
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    if (cls) i.className = cls;
    return i;
  }
  function refreshIcons() {
    try { if (window.lucide && lucide.createIcons) lucide.createIcons(); }
    catch (e) {}
  }

  function copyText(text, doneMsg) {
    const ok = () => { if (window.showSuccess) showSuccess(doneMsg || 'Đã sao chép.'); };
    const fail = () => { if (window.showWarning) showWarning('Không sao chép được. Hãy chép thủ công.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text) ? ok() : fail());
    } else {
      fallbackCopy(text) ? ok() : fail();
    }
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function debounce(fn, ms) {
    let t = 0;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  // ----------------------------------------------------------------------
  // Dựng khung màn hình (một lần).
  // ----------------------------------------------------------------------
  function build() {
    if (state.built) return;

    const backBtn = el('button', {
      className: 'dvhc-back-btn',
      type: 'button',
      'aria-label': 'Quay lại',
      on: { click: () => close() },
    }, [icon('arrow-left', 'w-6 h-6')]);

    const titleEl = el('h2', { className: 'dvhc-title', text: TITLE });

    const infoBtn = el('button', {
      className: 'dvhc-info-btn',
      type: 'button',
      'aria-label': 'Thông tin dữ liệu',
      on: { click: showDataInfo },
    }, [icon('info', 'w-5 h-5')]);

    const header = el('header', { className: 'dvhc-header' }, [
      el('div', { className: 'dvhc-header-row' }, [backBtn, titleEl, infoBtn]),
    ]);

    const tabbar = el('div', { className: 'dvhc-tabbar', role: 'tablist' });
    const tabs = [
      ['forward', 'Địa chỉ cũ'],
      ['reverse', 'Xã mới'],
      ['convert', 'Chuyển địa chỉ'],
    ];
    for (const [id, label] of tabs) {
      const b = el('button', {
        type: 'button',
        className: 'dvhc-tab' + (id === state.tab ? ' is-active' : ''),
        text: label,
        role: 'tab',
        on: { click: () => switchTab(id) },
      });
      tabButtons[id] = b;
      tabbar.appendChild(b);
    }

    bodyEl = el('div', { className: 'dvhc-body scroll-area' });

    screenEl = el('div', {
      id: 'screen-dvhc-lookup',
      className: 'app-container z-20 transform translate-x-full transition-transform duration-300 dvhc-screen',
    }, [header, tabbar, bodyEl]);

    document.body.appendChild(screenEl);
    state.built = true;
  }

  function switchTab(id) {
    state.tab = id;
    for (const [tid, btn] of Object.entries(tabButtons)) {
      btn.classList.toggle('is-active', tid === id);
    }
    renderBody();
  }

  // ----------------------------------------------------------------------
  // Nạp dữ liệu + render thân màn hình.
  // ----------------------------------------------------------------------
  function renderBody() {
    if (!state.built) return;
    if (!state.index) { renderLoading(); return; }
    bodyEl.replaceChildren();
    for (const key of Object.keys(views)) delete views[key];
    if (state.tab === 'forward') renderForward();
    else if (state.tab === 'reverse') renderReverse();
    else renderConvert();
    bodyEl.appendChild(buildFooter());
    refreshIcons();
  }

  function renderLoading() {
    bodyEl.replaceChildren(
      el('div', { className: 'dvhc-loading', text: 'Đang nạp dữ liệu tra cứu…' })
    );
  }

  function renderLoadError(message) {
    bodyEl.replaceChildren(
      el('div', { className: 'dvhc-load-error' }, [
        el('p', { className: 'dvhc-hint', text: message }),
        el('button', {
          type: 'button',
          className: 'dvhc-btn dvhc-btn-primary',
          text: 'Thử lại',
          on: { click: ensureData },
        }),
      ])
    );
  }

  function ensureData() {
    const seq = ++state.loadSeq;
    renderLoading();
    D.loadIndex().then(
      (index) => {
        if (seq !== state.loadSeq || !state.open) return;
        state.index = index;
        renderBody();
      },
      (err) => {
        if (seq !== state.loadSeq || !state.open) return;
        renderLoadError((err && err.message) || 'Không tải được dữ liệu tra cứu.');
      }
    );
  }

  // ----------------------------------------------------------------------
  // TAB 1 — Tra địa chỉ cũ → mới.
  // ----------------------------------------------------------------------
  function renderForward() {
    const input = el('input', {
      type: 'search',
      className: 'dvhc-input',
      placeholder: 'Xã / huyện / tỉnh cũ — ví dụ: Phường 12, Gò Vấp',
      autocomplete: 'off',
      spellcheck: false,
    });
    input.setAttribute('autocapitalize', 'off');
    const results = el('div', { className: 'dvhc-results' });

    const run = () => {
      const q = input.value;
      results.replaceChildren();
      if (U.normalizeName(q).length < 2) {
        results.appendChild(el('p', {
          className: 'dvhc-hint',
          text: 'Gõ tên đơn vị cũ (không cần dấu). Thêm dấu phẩy để lọc theo huyện/tỉnh.',
        }));
        return;
      }
      const rs = U.searchOld(state.index, q, SEARCH_LIMIT);
      if (!rs.length) {
        results.appendChild(el('p', { className: 'dvhc-hint', text: 'Không tìm thấy đơn vị cũ phù hợp.' }));
        return;
      }
      for (const rec of rs) results.appendChild(buildForwardCard(rec));
      refreshIcons();
    };
    input.addEventListener('input', debounce(run, 160));

    bodyEl.appendChild(el('section', { className: 'dvhc-section' }, [input, results]));
    run();
  }

  function buildForwardCard(rec) {
    const newText = U.formatNewUnit(rec);
    const kids = [
      el('div', { className: 'dvhc-card-old' }, [
        icon('map-pin', 'w-4 h-4'),
        el('span', { text: U.formatOldUnit(rec) }),
      ]),
      el('div', { className: 'dvhc-card-new' }, [
        icon('corner-down-right', 'w-4 h-4'),
        el('strong', { text: newText }),
        el('button', {
          type: 'button',
          className: 'dvhc-copy-btn',
          'aria-label': 'Sao chép địa chỉ mới',
          on: { click: () => copyText(newText, 'Đã sao chép: ' + newText) },
        }, [icon('copy', 'w-4 h-4')]),
      ]),
    ];
    const packRows = packRowsForWard(rec.nW, rec.nP);
    if (packRows.length) kids.push(buildPackToggle(packRows));
    return el('div', { className: 'dvhc-card' }, kids);
  }

  // ----------------------------------------------------------------------
  // TAB 2 — Xã mới → các đơn vị cũ.
  // ----------------------------------------------------------------------
  function renderReverse() {
    const provinces = state.index.data.provinces;
    const select = el('select', { className: 'dvhc-select', 'aria-label': 'Chọn tỉnh mới' });
    select.appendChild(el('option', { value: '', text: '— Chọn tỉnh / thành phố mới —' }));
    provinces.forEach((p, i) => {
      select.appendChild(el('option', { value: String(i), text: p[1] }));
    });

    const filter = el('input', {
      type: 'search',
      className: 'dvhc-input',
      placeholder: 'Lọc tên xã / phường mới…',
      autocomplete: 'off',
      spellcheck: false,
    });
    filter.setAttribute('autocapitalize', 'off');
    const results = el('div', { className: 'dvhc-results' });

    const run = () => {
      results.replaceChildren();
      const pIdx = select.value === '' ? -1 : Number(select.value);
      if (pIdx < 0) {
        results.appendChild(el('p', { className: 'dvhc-hint', text: 'Chọn tỉnh mới để xem danh sách xã/phường.' }));
        return;
      }
      const wardsList = U.listWardsOfProvince(state.index, pIdx, filter.value, 200);
      if (!wardsList.length) {
        results.appendChild(el('p', { className: 'dvhc-hint', text: 'Không có xã/phường phù hợp.' }));
        return;
      }
      for (const w of wardsList) results.appendChild(buildReverseRow(w, provinces[pIdx][1]));
      refreshIcons();
    };
    select.addEventListener('change', run);
    filter.addEventListener('input', debounce(run, 160));

    bodyEl.appendChild(el('section', { className: 'dvhc-section' }, [select, filter, results]));
    run();
  }

  function buildReverseRow(w, provinceName) {
    const detail = el('div', { className: 'dvhc-row-detail', hidden: true });
    let expanded = false;
    const head = el('button', {
      type: 'button',
      className: 'dvhc-row-head',
      on: {
        click: () => {
          expanded = !expanded;
          detail.hidden = !expanded;
          if (expanded && !detail.childNodes.length) {
            fillReverseDetail(detail, w, provinceName);
            refreshIcons();
          }
        },
      },
    }, [
      el('span', { className: 'dvhc-row-name', text: w.name }),
      icon('chevron-down', 'w-4 h-4'),
    ]);
    return el('div', { className: 'dvhc-row' }, [head, detail]);
  }

  function fillReverseDetail(detail, w, provinceName) {
    const olds = U.reverseLookup(state.index, w.wIdx);
    if (!olds.length) {
      detail.appendChild(el('p', { className: 'dvhc-hint', text: 'Không có dữ liệu đơn vị cũ.' }));
    } else {
      detail.appendChild(el('p', { className: 'dvhc-detail-title', text: 'Hình thành từ ' + olds.length + ' đơn vị cũ:' }));
      const ul = el('ul', { className: 'dvhc-old-list' });
      for (const rec of olds) {
        ul.appendChild(el('li', { text: U.formatOldUnit(rec) }));
      }
      detail.appendChild(ul);
    }
    const full = w.name + ', ' + provinceName;
    detail.appendChild(el('button', {
      type: 'button',
      className: 'dvhc-btn dvhc-btn-ghost',
      on: { click: () => copyText(full, 'Đã sao chép: ' + full) },
    }, [icon('copy', 'w-4 h-4'), el('span', { text: 'Sao chép địa chỉ mới' })]));
    const packRows = packRowsForWard(w.name, provinceName);
    if (packRows.length) detail.appendChild(buildPackToggle(packRows));
  }

  // ----------------------------------------------------------------------
  // TAB 3 — Chuyển một dòng địa chỉ cũ → mới.
  // ----------------------------------------------------------------------
  function renderConvert() {
    const input = el('textarea', {
      className: 'dvhc-input dvhc-textarea',
      placeholder: 'Dán địa chỉ cũ, ví dụ:\nSố 5 ngõ 20, Phường 12, Quận Gò Vấp, TP. Hồ Chí Minh',
      rows: 3,
      spellcheck: false,
    });
    const out = el('div', { className: 'dvhc-results' });

    const run = () => {
      out.replaceChildren();
      const r = U.convertAddress(state.index, input.value);
      if (!r.ok) {
        out.appendChild(el('p', { className: 'dvhc-hint', text: r.error }));
        return;
      }
      if (r.newAddress) {
        out.appendChild(el('div', { className: 'dvhc-card dvhc-card-accent' }, [
          el('div', { className: 'dvhc-card-new' }, [
            icon('check-circle-2', 'w-4 h-4'),
            el('strong', { text: r.newAddress }),
          ]),
          el('button', {
            type: 'button',
            className: 'dvhc-btn dvhc-btn-primary',
            on: { click: () => copyText(r.newAddress, 'Đã sao chép địa chỉ mới.') },
          }, [icon('copy', 'w-4 h-4'), el('span', { text: 'Sao chép địa chỉ mới' })]),
        ]));
      } else {
        out.appendChild(el('p', {
          className: 'dvhc-hint',
          text: 'Địa chỉ cũ khớp nhiều nơi — chọn đúng trường hợp bên dưới:',
        }));
        for (const rec of r.matches.slice(0, 10)) out.appendChild(buildForwardCard(rec));
      }
      refreshIcons();
    };

    bodyEl.appendChild(el('section', { className: 'dvhc-section' }, [
      input,
      el('button', {
        type: 'button',
        className: 'dvhc-btn dvhc-btn-primary dvhc-btn-block',
        on: { click: run },
      }, [icon('wand-2', 'w-4 h-4'), el('span', { text: 'Chuyển sang địa chỉ mới' })]),
      out,
    ]));
  }

  // ----------------------------------------------------------------------
  // Gói thôn/TDP (đợt sắp xếp 2026) — trạng thái + nhập/xoá.
  // ----------------------------------------------------------------------
  function packRowsForWard(newWardName, newProvinceName) {
    const pack = D.getPack();
    if (!pack) return [];
    const packProv = U.stripUnitPrefix(U.normalizeName(pack.province), 'province');
    const prov = U.stripUnitPrefix(U.normalizeName(newProvinceName), 'province');
    if (packProv && prov && packProv !== prov) return [];
    return U.packLookup(pack, newWardName);
  }

  function buildPackToggle(rows) {
    const list = el('div', { className: 'dvhc-pack-list', hidden: true });
    let expanded = false;
    const btn = el('button', {
      type: 'button',
      className: 'dvhc-pack-toggle',
      on: {
        click: () => {
          expanded = !expanded;
          list.hidden = !expanded;
          if (expanded && !list.childNodes.length) {
            const ul = el('ul', { className: 'dvhc-old-list' });
            for (const m of rows) ul.appendChild(el('li', { text: m.cu + ' → ' + m.moi }));
            list.appendChild(ul);
          }
        },
      },
    }, [icon('list-tree', 'w-4 h-4'), el('span', { text: 'Thôn/TDP (' + rows.length + ' dòng đối chiếu)' })]);
    return el('div', { className: 'dvhc-pack-wrap' }, [btn, list]);
  }

  function buildFooter() {
    const meta = state.index.data.meta || {};
    const pack = D.getPack();

    packFileInput = el('input', { type: 'file', className: 'dvhc-hidden-input', accept: '.json,application/json' });
    packFileInput.addEventListener('change', () => {
      const file = (packFileInput.files || [])[0];
      packFileInput.value = '';
      if (!file) return;
      D.readPackFile(file).then((r) => {
        if (!state.open) return;
        if (!r.ok) {
          if (window.showWarning) showWarning(r.error);
          return;
        }
        const saved = D.setPack(r.pack);
        if (!saved.ok) {
          if (window.showWarning) showWarning(saved.error);
          return;
        }
        if (window.showSuccess) showSuccess('Đã nạp gói thôn/TDP: ' + r.pack.province + (r.pack.version ? ' (' + r.pack.version + ')' : '') + '.');
        renderBody();
      });
    });

    packStatusEl = el('span', {
      className: 'dvhc-pack-status',
      text: pack
        ? 'Gói thôn/TDP: ' + pack.province + (pack.version ? ' · ' + pack.version : '') + ' (' + pack.mappings.length + ' dòng)'
        : 'Chưa nạp gói thôn/TDP (đợt sắp xếp 2026).',
    });

    const importBtn = el('button', {
      type: 'button',
      className: 'dvhc-btn dvhc-btn-ghost',
      on: { click: () => packFileInput.click() },
    }, [icon('folder-input', 'w-4 h-4'), el('span', { text: pack ? 'Thay gói' : 'Nhập gói' })]);

    const btns = [importBtn];
    if (pack) {
      btns.push(el('button', {
        type: 'button',
        className: 'dvhc-btn dvhc-btn-ghost dvhc-btn-danger-text',
        on: {
          click: () => {
            const doClear = () => { D.clearPack(); renderBody(); };
            if (window.showConfirm) {
              showConfirm('Xoá gói dữ liệu thôn/TDP đã nạp?', {
                title: 'Xoá gói', confirmText: 'Xoá', cancelText: 'Giữ lại', danger: true, icon: 'trash',
              }).then((ok) => { if (ok) doClear(); });
            } else doClear();
          },
        },
      }, [icon('trash-2', 'w-4 h-4'), el('span', { text: 'Xoá gói' })]));
    }

    return el('footer', { className: 'dvhc-footer' }, [
      el('div', { className: 'dvhc-pack-bar' }, [packStatusEl, el('div', { className: 'dvhc-pack-actions' }, btns), packFileInput]),
      el('p', {
        className: 'dvhc-footnote',
        text: 'Dữ liệu cấp tỉnh/xã theo sắp xếp ĐVHC 01/7/2025 (phiên bản ' + (meta.generatedAt || '?') + '). '
          + 'Chỉ mang tính đối chiếu tham khảo — khi lập hồ sơ hãy kiểm tra văn bản gốc.',
      }),
    ]);
  }

  function showDataInfo() {
    if (!state.index) return;
    const meta = state.index.data.meta || {};
    const c = meta.counts || {};
    const msg = 'Dữ liệu sắp xếp đơn vị hành chính từ 01/7/2025: '
      + (c.oldProvinces || 63) + ' tỉnh cũ → ' + (c.provinces || 34) + ' tỉnh mới, '
      + (c.mappings || 0) + ' dòng đối chiếu cấp xã. Căn cứ: ' + (meta.legal || '') + '. '
      + 'Toàn bộ tra cứu chạy trên thiết bị, không gửi dữ liệu đi đâu. '
      + 'Đợt sắp xếp thôn/tổ dân phố 2026 chưa có dữ liệu tập trung — có thể nạp gói theo tỉnh ở cuối màn hình.';
    if (window.showConfirm) {
      showConfirm(msg, { title: 'Về dữ liệu tra cứu', confirmText: 'Đã hiểu', cancelText: 'Đóng', icon: 'info' });
    }
  }

  // ----------------------------------------------------------------------
  // Mở / đóng / reset + cascade back.
  // ----------------------------------------------------------------------
  function open() {
    // Điểm mở nằm trong Menu cài đặt (z-70, cao hơn màn hình này) — đóng menu
    // trước, như OnboardingTour.replay vẫn làm.
    try { if (typeof _closeMenuIfOpen === 'function') _closeMenuIfOpen(); } catch (e) {}
    build();
    if (state.open) return;
    state.open = true;
    if (state.index) renderBody();
    else ensureData();
    if (typeof slideScreenIn === 'function') slideScreenIn(screenEl);
    else if (typeof nextFrame === 'function') nextFrame(() => screenEl.classList.remove('translate-x-full'));
    else setTimeout(() => screenEl.classList.remove('translate-x-full'), 10);
    refreshIcons();
  }

  function close() {
    if (!state.built || !state.open) return;
    state.open = false;
    state.loadSeq++;
    if (typeof slideScreenOut === 'function') slideScreenOut(screenEl, () => {});
    else screenEl.classList.add('translate-x-full');
  }

  // Reset khi khóa app: ẩn ngay, không hiệu ứng, không mở lại sau mở khóa.
  function reset() {
    if (!state.built) return;
    state.open = false;
    state.loadSeq++;
    screenEl.classList.add('translate-x-full');
  }

  function handleBack() {
    if (!state.open) return false;
    close();
    return true;
  }

  // ----------------------------------------------------------------------
  // TÍCH HỢP KHÓA APP — quan sát #screen-lock (không sửa logic khóa).
  // ----------------------------------------------------------------------
  function watchLock() {
    const lock = document.getElementById('screen-lock');
    if (!lock) { setTimeout(watchLock, 500); return; }
    try {
      const mo = new MutationObserver(() => {
        const locked = !lock.classList.contains('hidden');
        if (locked && state.open) reset();
      });
      mo.observe(lock, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
  }

  // ----------------------------------------------------------------------
  // Export.
  // ----------------------------------------------------------------------
  window.DvhcLookup = { open, close, reset };
  window.dvhcLookupHandleBack = handleBack;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLock);
  else watchLock();
})();
