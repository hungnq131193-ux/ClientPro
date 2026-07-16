// ================== WEATHER (OPEN-METEO, NO KEY) ==================

function initWeather() {
  // hiển thị nhanh từ cache nếu có
  const cacheRaw = localStorage.getItem(WEATHER_STORAGE_KEY);
  if (cacheRaw) {
    try {
      const cache = JSON.parse(cacheRaw);
      if (Date.now() - cache.time < WEATHER_CACHE_TTL) {
        renderWeather(cache.data);
      }
    } catch (e) {
      console.warn("Weather cache error", e);
    }
  }
  // sau đó gọi GPS để cập nhật mới
  refreshWeather();
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
        localStorage.setItem(
          WEATHER_STORAGE_KEY,
          JSON.stringify({ time: Date.now(), data })
        );
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
