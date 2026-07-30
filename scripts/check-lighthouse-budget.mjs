#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(ROOT, '.lighthouseci');

const LIMITS = Object.freeze({
  performanceMedian: 0.85,
  performanceFloor: 0.80,
  fcpMs: 1800,
  lcpMs: 2800,
  tbtMs: 150,
  cls: 0.02,
  initialRequests: 40,
  initialTransferBytes: 1024 * 1024,
  accessibility: 1,
  bestPractices: 1,
});

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function numericAudit(report, id) {
  const audit = report.audits && report.audits[id];
  const value = audit && Number(audit.numericValue);
  if (!Number.isFinite(value)) throw new Error(`Lighthouse report missing numeric audit: ${id}`);
  return value;
}

function categoryScore(report, id) {
  const category = report.categories && report.categories[id];
  const score = category && Number(category.score);
  if (!Number.isFinite(score)) throw new Error(`Lighthouse report missing category: ${id}`);
  return score;
}

function initialNetworkBudget(report, fcpMs) {
  const items = report.audits
    && report.audits['network-requests']
    && report.audits['network-requests'].details
    && report.audits['network-requests'].details.items;
  if (!Array.isArray(items)) throw new Error('Lighthouse report missing network-requests details');

  // rendererStartTime is milliseconds from navigation start. Count only requests
  // submitted by first contentful paint; idle/post-paint warmers are deliberately
  // outside the locked first-frame budget.
  const initial = items.filter((item) => {
    const start = Number(item.rendererStartTime);
    return Number.isFinite(start) && start <= fcpMs;
  });
  return {
    count: initial.length,
    transfer: initial.reduce((sum, item) => sum + (Number(item.transferSize) || 0), 0),
  };
}

function fmtMs(value) {
  return `${Math.round(value)} ms`;
}

if (!fs.existsSync(REPORT_DIR)) {
  console.error('❌ .lighthouseci does not exist');
  process.exit(1);
}

const files = fs.readdirSync(REPORT_DIR)
  .filter((name) => name.endsWith('.report.json'))
  .sort();

if (files.length < 3) {
  console.error(`❌ Expected at least 3 Lighthouse report JSON files, found ${files.length}`);
  process.exit(1);
}

const runs = files.map((name) => {
  const report = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, name), 'utf8'));
  const fcp = numericAudit(report, 'first-contentful-paint');
  const run = {
    name,
    performance: categoryScore(report, 'performance'),
    accessibility: categoryScore(report, 'accessibility'),
    bestPractices: categoryScore(report, 'best-practices'),
    fcp,
    lcp: numericAudit(report, 'largest-contentful-paint'),
    tbt: numericAudit(report, 'total-blocking-time'),
    cls: numericAudit(report, 'cumulative-layout-shift'),
  };
  Object.assign(run, initialNetworkBudget(report, fcp));
  return run;
});

const errors = [];
const performanceValues = runs.map((run) => run.performance);
const performanceMedian = median(performanceValues);
const performanceFloor = Math.min(...performanceValues);

if (performanceMedian < LIMITS.performanceMedian) {
  errors.push(`Performance median ${(performanceMedian * 100).toFixed(0)} < ${LIMITS.performanceMedian * 100}`);
}
if (performanceFloor < LIMITS.performanceFloor) {
  errors.push(`Performance floor ${(performanceFloor * 100).toFixed(0)} < ${LIMITS.performanceFloor * 100}`);
}

for (const run of runs) {
  const prefix = run.name;
  if (run.accessibility < LIMITS.accessibility) {
    errors.push(`${prefix}: accessibility ${(run.accessibility * 100).toFixed(0)} != 100`);
  }
  if (run.bestPractices < LIMITS.bestPractices) {
    errors.push(`${prefix}: best-practices ${(run.bestPractices * 100).toFixed(0)} != 100`);
  }
  if (run.fcp > LIMITS.fcpMs) errors.push(`${prefix}: FCP ${fmtMs(run.fcp)} > ${fmtMs(LIMITS.fcpMs)}`);
  if (run.lcp > LIMITS.lcpMs) errors.push(`${prefix}: LCP ${fmtMs(run.lcp)} > ${fmtMs(LIMITS.lcpMs)}`);
  if (run.tbt > LIMITS.tbtMs) errors.push(`${prefix}: TBT ${fmtMs(run.tbt)} > ${fmtMs(LIMITS.tbtMs)}`);
  if (run.cls > LIMITS.cls) errors.push(`${prefix}: CLS ${run.cls.toFixed(4)} > ${LIMITS.cls}`);
  if (run.count > LIMITS.initialRequests) {
    errors.push(`${prefix}: initial requests ${run.count} > ${LIMITS.initialRequests}`);
  }
  if (run.transfer > LIMITS.initialTransferBytes) {
    errors.push(`${prefix}: initial transfer ${(run.transfer / 1024).toFixed(0)} KiB > 1024 KiB`);
  }
}

console.log('Lighthouse release budget:');
for (const run of runs) {
  console.log([
    `- ${run.name}`,
    `perf=${(run.performance * 100).toFixed(0)}`,
    `FCP=${fmtMs(run.fcp)}`,
    `LCP=${fmtMs(run.lcp)}`,
    `TBT=${fmtMs(run.tbt)}`,
    `CLS=${run.cls.toFixed(4)}`,
    `requests=${run.count}`,
    `transfer=${(run.transfer / 1024).toFixed(0)} KiB`,
    `a11y=${(run.accessibility * 100).toFixed(0)}`,
    `bp=${(run.bestPractices * 100).toFixed(0)}`,
  ].join(' | '));
}
console.log(`Median performance: ${(performanceMedian * 100).toFixed(0)}; floor: ${(performanceFloor * 100).toFixed(0)}`);

if (errors.length) {
  errors.forEach((error) => console.error(`❌ ${error}`));
  process.exit(1);
}

console.log('✅ Lighthouse đạt toàn bộ ngân sách release đã khóa.');
