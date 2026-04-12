        function getEl(id) { return document.getElementById(id); }
        // Debounce helper to avoid heavy work on every keystroke / rapid events
        function debounce(fn, wait = 150) {
          let t;
          return function debounced(...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
          };
        }
        const DB_NAME='QLKH_Pro_V4'; let db;
        const PIN_KEY = 'app_pin'; const SEC_KEY = 'app_sec_qa'; const THEME_KEY = 'app_theme';
        // Thêm các key cho kích hoạt thiết bị & mã nhân viên
        const ACTIVATED_KEY = 'app_activated';
        const EMPLOYEE_KEY  = 'app_employee_id';
        let currentPin = '';
        let currentLightboxIndex = 0;
        let currentLightboxList = [];

        // =======================
        // UI PERF HELPERS
        // =======================
        // Standard slide transition in this app uses: transition-transform duration-300
        // Avoid doing heavy work (IndexedDB getAll, decrypt, DOM render) during the animation
        // to prevent jank and visual "flash" of stale screen content.
        const UI_SLIDE_MS = 300;

        function nextFrame(fn) {
          try { requestAnimationFrame(() => requestAnimationFrame(fn)); }
          catch (e) { setTimeout(fn, 0); }
        }

        function afterTransition(el, cb, ms = UI_SLIDE_MS) {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            try { el && el.removeEventListener('transitionend', onEnd); } catch (e) {}
            try { cb && cb(); } catch (e) {}
          };
          const onEnd = (ev) => {
            if (el && ev && ev.target !== el) return;
            finish();
          };
          try { el && el.addEventListener('transitionend', onEnd, { once: true }); } catch (e) {}
          setTimeout(finish, (ms || 0) + 60);
        }
