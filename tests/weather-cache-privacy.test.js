'use strict';

// ============================================================================
// weather-cache-privacy.test.js — cache thời tiết không được lưu vị trí.
//
// Response Open-Meteo có latitude/longitude top-level (tâm ô lưới dự báo) cùng
// timezone/elevation. Cache nguyên response = ghi vị trí gần đúng của người dùng
// dạng plaintext vào localStorage, còn nguyên cả khi app đã khóa — trái bất biến
// localStorage của dự án (cache quãng đường phải seal đúng vì chứa toạ độ).
//
// Chạy 09_weather.js THẬT trong vm sandbox (file chỉ khai báo hàm, không có
// lệnh top-level nên nạp an toàn).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const WEATHER_STORAGE_KEY = 'app_weather_cache_v1';

// Response thật của Open-Meteo (rút gọn) — giữ nguyên các trường vị trí.
const RAW_RESPONSE = {
  latitude: 21.0245,
  longitude: 105.8412,
  generationtime_ms: 0.03,
  utc_offset_seconds: 25200,
  timezone: 'Asia/Bangkok',
  timezone_abbreviation: 'GMT+7',
  elevation: 16,
  current_weather_units: { temperature: '°C', windspeed: 'km/h' },
  current_weather: {
    time: '2026-07-26T16:00',
    interval: 900,
    temperature: 33.4,
    windspeed: 8.2,
    winddirection: 150,
    is_day: 1,
    weathercode: 2,
  },
};

function makeLocalStorage() {
  const store = Object.create(null);
  return {
    _store: store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

function loadWeather() {
  const localStorage = makeLocalStorage();
  const rendered = [];
  const ctx = {
    console: { warn() {}, log() {} },
    JSON, Date, Math, String, Number, Object, Array, Error, Promise,
    localStorage,
    // Hằng nguồn thật ở 01_config.js — chỉ cấp phần 09_weather.js dùng.
    WEATHER_STORAGE_KEY,
    WEATHER_CACHE_TTL: 15 * 60 * 1000,
    WEATHER_CODE_TEXT: { 2: 'Có mây' },
    document: { getElementById: () => null, addEventListener: () => {} },
    getEl: () => null, // nguồn thật ở 00_globals.js; setWeatherText đã guard null
    navigator: { geolocation: null, permissions: null },
    window: {},
    fetch: async () => { throw new Error('network disabled in tests'); },
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(ROOT, 'assets', '09_weather.js'), 'utf8');
  // Epilogue: phơi hàm khai báo top-level ra cho test (file không export).
  vm.runInContext(
    src + '\nglobalThis.__api = { _trimWeatherForCache, initWeather, renderWeather };',
    ctx,
    { filename: 'assets/09_weather.js' }
  );
  return { api: ctx.__api, localStorage, ctx, rendered };
}

test('_trimWeatherForCache bỏ toàn bộ trường vị trí, giữ phần hiển thị', () => {
  const { api } = loadWeather();
  const trimmed = api._trimWeatherForCache(RAW_RESPONSE);

  const serialized = JSON.stringify(trimmed);
  for (const leak of ['latitude', 'longitude', 'timezone', 'elevation', 'utc_offset']) {
    assert.ok(!serialized.includes(leak), `Cache không được chứa "${leak}"`);
  }
  assert.ok(!serialized.includes('21.02') && !serialized.includes('105.84'),
    'Cache không được chứa giá trị toạ độ');

  assert.equal(trimmed.current_weather.temperature, 33.4, 'Vẫn giữ nhiệt độ để render');
  assert.equal(trimmed.current_weather.weathercode, 2, 'Vẫn giữ weathercode để render');
});

test('_trimWeatherForCache trả null khi response không có current_weather', () => {
  const { api } = loadWeather();
  assert.equal(api._trimWeatherForCache({ latitude: 1, longitude: 2 }), null);
  assert.equal(api._trimWeatherForCache(null), null);
});

test('cache cũ có toạ độ bị dọn ngay khi initWeather đọc tới', () => {
  const { api, localStorage } = loadWeather();
  // Bản cũ ghi nguyên response.
  localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify({ time: Date.now(), data: RAW_RESPONSE }));

  api.initWeather();

  const after = localStorage.getItem(WEATHER_STORAGE_KEY);
  assert.ok(after, 'Vẫn giữ cache để pill hiển thị nhanh');
  assert.ok(!after.includes('latitude') && !after.includes('longitude'),
    'Toạ độ trong cache cũ phải bị dọn ngay, không chờ lần fetch sau');
  assert.ok(!after.includes('105.84'), 'Giá trị toạ độ cũ phải biến mất');
  assert.ok(after.includes('33.4'), 'Vẫn giữ nhiệt độ đã cache');
});

test('renderWeather vẫn đọc được payload đã trim', () => {
  const { api } = loadWeather();
  const trimmed = api._trimWeatherForCache(RAW_RESPONSE);
  // Không throw và không rơi vào nhánh "Không có dữ liệu".
  assert.doesNotThrow(() => api.renderWeather(trimmed));
});
