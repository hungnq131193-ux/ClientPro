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
