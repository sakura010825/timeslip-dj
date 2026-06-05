/**
 * 保存済み台本（redial/data/scripts/{slug}-v1.json）を Layer3 グラウンディング検証で
 * 再チェックする恒久ツール。TTS・stockize を回さず検証だけを実行する。
 *
 * 用途:
 *   - Layer3（grounding-verifier）をチューニングした後、フル再生成せず捕捉結果だけ確認する
 *   - 既存ストックの台本を後から再監査する（doNotSay/verified 強化後など）
 *
 * 前提: dev サーバーが起動していること（/api/verify-grounding を叩く）
 *
 * 使い方:
 *   node scripts/verify-stock.mjs 1990-autumn-pooltest
 *   node scripts/verify-stock.mjs 1990-autumn-pooltest --base http://localhost:3100
 */
import fs from 'node:fs';
import path from 'node:path';

const slug = process.argv[2];
if (!slug || slug.startsWith('--')) {
  console.error('usage: node scripts/verify-stock.mjs <slug> [--base http://localhost:3100]');
  process.exit(1);
}
const baseIdx = process.argv.indexOf('--base');
const base = (baseIdx >= 0 ? process.argv[baseIdx + 1] : 'http://localhost:3100').replace(/\/$/, '');

const v1Path = path.resolve(process.cwd(), '..', 'redial', 'data', 'scripts', `${slug}-v1.json`);
if (!fs.existsSync(v1Path)) {
  console.error(`台本(v1.json)が見つかりません: ${v1Path}`);
  process.exit(1);
}
const v1 = JSON.parse(fs.readFileSync(v1Path, 'utf8'));
if (!Array.isArray(v1.segments)) {
  console.error('v1.json に segments がありません');
  process.exit(1);
}

const m = slug.match(/^(\d{4})-([a-z]+)/i);
if (!m) {
  console.error(`slug から year-season を解釈できません: ${slug}（例 1990-autumn）`);
  process.exit(1);
}
const year = Number(m[1]);
const season = m[2].toLowerCase();

const scriptText = v1.segments.map((s) => `【${s.segmentTitle}】\n${s.script}`).join('\n\n');

console.log(`\n検証: ${slug}  (year=${year} season=${season})  base=${base}`);
let res;
try {
  res = await fetch(`${base}/api/verify-grounding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year, season, scriptText }),
    signal: AbortSignal.timeout(2 * 60 * 1000),
  });
} catch (e) {
  console.error(`接続失敗 (${base}) — dev サーバーは起動していますか？  ${e.message}`);
  process.exit(1);
}
const text = await res.text();
let report;
try {
  report = JSON.parse(text);
} catch {
  console.error('応答がJSONではありません:', text.slice(0, 300));
  process.exit(1);
}
if (!res.ok) {
  console.error(`検証失敗 ${res.status}: ${report.error ?? text.slice(0, 300)}`);
  process.exit(1);
}

const cc = report.criticalCount ?? 0;
const mc = report.minorCount ?? 0;
console.log(`\n${cc === 0 ? '✓' : '⚠️'} critical ${cc} 件 / minor ${mc} 件  (KB ${report.meta?.kbItemCount ?? '?'}項目)\n`);
for (const u of report.ungrounded ?? []) {
  console.log(`  [${u.severity}] ${u.claim}`);
  console.log(`     └ ${u.reason}`);
}
console.log('');
