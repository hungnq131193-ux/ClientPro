#!/usr/bin/env node
/**
 * build-dvhc-data.mjs — sinh dữ liệu offline cho tool "Tra cứu sáp nhập ĐVHC".
 *
 * Chạy TAY khi cần cập nhật dữ liệu (KHÔNG chạy lúc runtime của app):
 *   node scripts/build-dvhc-data.mjs                # tải nguồn từ npm registry
 *   node scripts/build-dvhc-data.mjs --input <path> # dùng file address.json có sẵn
 *
 * Nguồn: package npm `vietnam-address-database` (MIT,
 * github.com/quangtam/vietnam-address-database) — dữ liệu theo
 * Nghị quyết 202/2025/QH15 và các nghị quyết UBTVQH về sắp xếp ĐVHC cấp xã.
 *
 * Đầu ra: assets/data/dvhc/dvhc.v1.json (minify) — schema xem docs trong
 * assets/data/dvhc/README.md. Script tự kiểm tra toàn vẹn và exit != 0 nếu
 * còn dòng đối chiếu không giải quyết được.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets', 'data', 'dvhc');
const OUT_FILE = join(OUT_DIR, 'dvhc.v1.json');

const SOURCE_PKG = 'vietnam-address-database';
const SOURCE_VERSION = '1.0.0';
const SOURCE_TARBALL = `https://registry.npmjs.org/${SOURCE_PKG}/-/${SOURCE_PKG}-${SOURCE_VERSION}.tgz`;

// 5 huyện đảo cũ không có đơn vị hành chính cấp xã → nguồn để trống thông tin
// cũ. Bổ sung tay (đối chiếu Nghị quyết 202/2025/QH15) để người dùng tra được
// theo tên huyện đảo cũ.
const SPECIAL_ISLAND_DISTRICTS = {
  'Đặc khu Bạch Long Vĩ': { district: 'Huyện Bạch Long Vĩ', province: 'Thành phố Hải Phòng' },
  'Đặc khu Côn Đảo': { district: 'Huyện Côn Đảo', province: 'Tỉnh Bà Rịa - Vũng Tàu' },
  'Đặc khu Cồn Cỏ': { district: 'Huyện Cồn Cỏ', province: 'Tỉnh Quảng Trị' },
  'Đặc khu Hoàng Sa': { district: 'Huyện Hoàng Sa', province: 'Thành phố Đà Nẵng' },
  'Đặc khu Lý Sơn': { district: 'Huyện Lý Sơn', province: 'Tỉnh Quảng Ngãi' },
};

function loadSourceJson() {
  const argIdx = process.argv.indexOf('--input');
  if (argIdx !== -1) {
    const p = process.argv[argIdx + 1];
    if (!p) throw new Error('--input cần kèm đường dẫn file address.json');
    return JSON.parse(readFileSync(p, 'utf8'));
  }
  const tmp = mkdtempSync(join(tmpdir(), 'dvhc-'));
  try {
    const tgz = join(tmp, 'src.tgz');
    console.log(`Tải ${SOURCE_TARBALL} ...`);
    execFileSync('curl', ['-sSL', '--max-time', '300', '-o', tgz, SOURCE_TARBALL], { stdio: 'inherit' });
    const raw = execFileSync('tar', ['-xzOf', tgz, 'package/address.json'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(raw.toString('utf8'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Nguồn trộn lẫn NFC/không-NFC → chuẩn hoá NFC toàn bộ chuỗi để so sánh và
// hiển thị nhất quán (test và UI đều dùng NFC).
function nfc(s) {
  return typeof s === 'string' ? s.normalize('NFC') : s;
}

function main() {
  const src = loadSourceJson();
  const tables = {};
  for (const item of src) {
    if (item && item.type === 'table') tables[item.name] = item.data;
  }
  for (const t of Object.values(tables)) {
    for (const row of t) {
      for (const k of Object.keys(row)) row[k] = nfc(row[k]);
    }
  }
  const provinces = tables.provinces || [];
  const wards = tables.wards || [];
  const mappings = tables.ward_mappings || [];
  if (!provinces.length || !wards.length || !mappings.length) {
    throw new Error('Thiếu bảng provinces/wards/ward_mappings trong nguồn');
  }

  // --- Tỉnh mới (34) ---
  const provOut = provinces.map((p) => [p.province_code, p.name]);
  const pIdxByCode = new Map(provOut.map(([code], i) => [code, i]));
  const pIdxByName = new Map(provOut.map(([, name], i) => [name, i]));
  // Nguồn mapping dùng tên tỉnh mới KHÔNG kèm tiền tố "Tỉnh " (trừ TP trực thuộc TW)
  const pIdxByShortName = new Map();
  provOut.forEach(([, name], i) => {
    pIdxByShortName.set(name.replace(/^Tỉnh\s+/u, ''), i);
  });

  // --- Xã/phường mới (~3321) ---
  const wardOut = wards.map((w) => [w.ward_code, w.name, pIdxByCode.get(w.province_code)]);
  wardOut.forEach(([code, name, pIdx], i) => {
    if (pIdx === undefined) throw new Error(`Xã ${code} ${name}: mã tỉnh lạ`);
  });
  const wIdxByCode = new Map(wardOut.map(([code], i) => [code, i]));
  const wIdxByNameProv = new Map(wardOut.map(([, name, pIdx], i) => [`${name}|${pIdx}`, i]));

  // --- Bảng đối chiếu cũ → mới ---
  const oldProvinces = []; // [name, newPIdx]
  const opIdxByName = new Map();
  const oldDistricts = [];
  const dIdxByName = new Map();
  const rows = [];
  const problems = [];

  for (const m of mappings) {
    let { old_ward_name: oWard, old_district_name: oDist, old_province_name: oProv } = m;
    const special = !oProv && SPECIAL_ISLAND_DISTRICTS[m.new_ward_name];
    if (special) {
      oWard = oWard || '';
      oDist = nfc(special.district);
      oProv = nfc(special.province);
    }
    if (!oProv || !oDist) {
      problems.push(`Dòng id=${m.id}: thiếu đơn vị cũ (${m.new_ward_name})`);
      continue;
    }
    // Xã mới: ưu tiên mã; nguồn có ~431 dòng mã cũ kỹ → tra lại theo tên + tỉnh
    let wIdx = wIdxByCode.get(m.new_ward_code);
    const pIdxNew =
      pIdxByName.get(m.new_province_name) ?? pIdxByShortName.get(m.new_province_name);
    if (pIdxNew === undefined) {
      problems.push(`Dòng id=${m.id}: tỉnh mới lạ "${m.new_province_name}"`);
      continue;
    }
    if (wIdx === undefined || wardOut[wIdx][2] !== pIdxNew) {
      wIdx = wIdxByNameProv.get(`${m.new_ward_name}|${pIdxNew}`);
    }
    if (wIdx === undefined) {
      problems.push(`Dòng id=${m.id}: không tìm được xã mới "${m.new_ward_name}" (${m.new_province_name})`);
      continue;
    }
    let opIdx = opIdxByName.get(oProv);
    if (opIdx === undefined) {
      opIdx = oldProvinces.length;
      oldProvinces.push([oProv, pIdxNew]);
      opIdxByName.set(oProv, opIdx);
    } else if (oldProvinces[opIdx][1] !== pIdxNew) {
      // Một tỉnh cũ phải thuộc trọn một tỉnh mới (NQ 202/2025/QH15)
      problems.push(`Tỉnh cũ "${oProv}" ánh xạ sang nhiều tỉnh mới`);
    }
    const dKey = `${oDist}|${opIdx}`;
    let dIdx = dIdxByName.get(dKey);
    if (dIdx === undefined) {
      dIdx = oldDistricts.length;
      oldDistricts.push([oDist, opIdx]);
      dIdxByName.set(dKey, dIdx);
    }
    rows.push([oWard || '', dIdx, wIdx]);
  }

  if (problems.length) {
    console.error(`LỖI TOÀN VẸN (${problems.length}):`);
    for (const p of problems.slice(0, 30)) console.error(' -', p);
    process.exit(1);
  }

  const out = {
    meta: {
      schema: 1,
      source: `npm:${SOURCE_PKG}@${SOURCE_VERSION} (MIT) — github.com/quangtam/vietnam-address-database`,
      legal:
        'Nghị quyết 202/2025/QH15 (sắp xếp ĐVHC cấp tỉnh); các Nghị quyết UBTVQH về sắp xếp ĐVHC cấp xã năm 2025; Quyết định 19/2025/QĐ-TTg (bảng mã ĐVHC)',
      generatedAt: new Date().toISOString().slice(0, 10),
      counts: {
        provinces: provOut.length,
        oldProvinces: oldProvinces.length,
        oldDistricts: oldDistricts.length,
        wards: wardOut.length,
        mappings: rows.length,
      },
    },
    provinces: provOut,
    oldProvinces,
    oldDistricts,
    wards: wardOut,
    map: rows,
  };

  // Kiểm tra toàn vẹn lần cuối
  if (out.meta.counts.provinces !== 34) throw new Error(`Số tỉnh mới = ${out.meta.counts.provinces}, kỳ vọng 34`);
  if (out.meta.counts.oldProvinces !== 63) throw new Error(`Số tỉnh cũ = ${out.meta.counts.oldProvinces}, kỳ vọng 63`);
  for (const [oWard, dIdx, wIdx] of rows) {
    if (!oldDistricts[dIdx] || !wardOut[wIdx]) throw new Error('Chỉ mục hỏng trong map');
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(out));
  const kb = Math.round(JSON.stringify(out).length / 1024);
  console.log(`OK → ${OUT_FILE} (${kb} KB)`);
  console.log('counts:', JSON.stringify(out.meta.counts));
}

main();
