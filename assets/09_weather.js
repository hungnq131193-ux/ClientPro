// ================== WEATHER (OPEN-METEO, NO KEY) ==================

/**
 * Chỉ giữ đúng phần pill thời tiết cần. Response Open-Meteo có latitude/longitude
 * top-level (tâm ô lưới dự báo, cách vị trí thật vài km) cộng timezone/elevation —
 * cache nguyên response là ghi vị trí gần đúng của người dùng dạng plaintext vào
 * localStorage, tồn tại cả khi app đã khóa. Không seal vì pill phải render TRƯỚC
 * lúc mở khóa; cách đúng là không lưu toạ độ ngay từ đầu.
 * @param {object} data - response thô của Open-Meteo
 * @returns {{current_weather: {temperature: number, weathercode: number}}|null}
 */
function _trimWeatherForCache(data) {
  const cw = data && data.current_weather;
  if (!cw) return null;
  return {
    current_weather: {
      temperature: cw.temperature,
      weathercode: cw.weathercode,
    },
  };
}

function initWeather() {
  // hiển thị nhanh từ cache nếu có
  const cacheRaw = localStorage.getItem(WEATHER_STORAGE_KEY);
  if (cacheRaw) {
    try {
      const cache = JSON.parse(cacheRaw);
      // Cache của bản cũ chứa nguyên response (có toạ độ) -> dọn ngay khi gặp,
      // không chờ lần fetch sau ghi đè.
      if (cache && cache.data && cache.data.latitude !== undefined) {
        const trimmed = _trimWeatherForCache(cache.data);
        cache.data = trimmed;
        if (trimmed) {
          localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify({ time: cache.time, data: trimmed }));
        } else {
          localStorage.removeItem(WEATHER_STORAGE_KEY);
        }
      }
      if (Date.now() - cache.time < WEATHER_CACHE_TTL) {
        renderWeather(cache.data);
      }
    } catch (e) {
      console.warn("Weather cache error", e);
    }
  }
  // KHÔNG gọi GPS ngay lúc boot: initWeather chạy khi người dùng còn đang nhìn
  // màn hình PIN/kích hoạt — popup xin quyền vị trí bật lên lúc đó là thời điểm
  // tệ nhất (tỉ lệ từ chối cao). Chỉ auto-refresh ngay nếu quyền ĐÃ được cấp;
  // ngược lại đợi mở khóa xong (clientpro:unlocked, một lần). Người dùng vẫn
  // chủ động được bất cứ lúc nào qua tap pill (data-action="refreshWeather").
  const refreshAfterUnlockOnce = () => {
    try {
      document.addEventListener("clientpro:unlocked", () => refreshWeather(), { once: true });
    } catch (e) {}
  };
  try {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "geolocation" }).then(
        (st) => { (st && st.state === "granted") ? refreshWeather() : refreshAfterUnlockOnce(); },
        () => refreshAfterUnlockOnce()
      );
    } else {
      refreshAfterUnlockOnce();
    }
  } catch (e) {
    refreshAfterUnlockOnce();
  }
}

function refreshWeather() {
  if (!navigator.geolocation) {
    setWeatherText("Thiết bị không hỗ trợ GPS");
    return;
  }

  setWeatherText("Đang lấy vị trí...");

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      fetchWeather(lat, lon);
    },
    (err) => {
      console.warn("GPS weather error", err);
      // Tone nhẹ, không như app hỏng — pill này bấm được để thử lại (refreshWeather)
      setWeatherText("Chưa có định vị — chạm để thử lại");
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 5 * 60 * 1000 }
  );
}

function setWeatherText(text) {
  const el = getEl("current-weather");
  if (el) el.textContent = text;
}

function fetchWeather(lat, lon) {
  setWeatherText("Đang tải thời tiết...");

  // Open-Meteo API: không cần API key
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}` +
    `&longitude=${lon}` +
    "&current_weather=true" +
    "&timezone=auto";

  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((data) => {
      try {
        // Chỉ cache phần hiển thị — KHÔNG lưu toạ độ/timezone/elevation.
        const cacheable = _trimWeatherForCache(data);
        if (cacheable) {
          localStorage.setItem(
            WEATHER_STORAGE_KEY,
            JSON.stringify({ time: Date.now(), data: cacheable })
          );
        }
      } catch (e) {
        console.warn("Weather cache save error", e);
      }
      renderWeather(data);
    })
    .catch((err) => {
      if (window.ErrorHandler) ErrorHandler.logError("Weather fetch error", err);
      setWeatherText("Chưa tải được thời tiết — chạm để thử lại");
    });
}

function renderWeather(apiData) {
  if (!apiData || !apiData.current_weather) {
    setWeatherText("Không có dữ liệu");
    return;
  }

  const cw = apiData.current_weather;
  const temp = Math.round(cw.temperature); // °C
  const code = cw.weathercode;
  const desc = WEATHER_CODE_TEXT[code] || "Thời tiết hiện tại";

  setWeatherText(`${temp}°C • ${desc}`);
}

// ================== END WEATHER ==================
