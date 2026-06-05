/**
 * 既存stockの特定セグメントだけを、最新の発音辞書で再TTSして差し替える。
 * 発音辞書（tts-pronunciation-dict）を更新した後、台本は変えずに音声だけ作り直す用途。
 *
 * 前提:
 *   - dev サーバー起動（/api/tts を辞書適用込みで叩く）
 *   - 差し替えない既存セグメントの archiveId が .tts-archive/ に残っていること
 *
 * usage:
 *   node scripts/retts-stock-segments.mjs <slug> <segIndex...> [--base http://localhost:3100]
 *   例: node scripts/retts-stock-segments.mjs 1985-spring 1 2
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CWD = process.cwd();
const SCRIPTS_ROOT = path.resolve(CWD, '..', 'redial', 'data', 'scripts');
const STOCK_ROOT = path.resolve(CWD, '..', 'redial', 'data', 'stock');
const STOCKIZE = path.resolve(CWD, 'scripts', 'stockize-episode.mjs');
const FETCH_TIMEOUT_MS = 10 * 60 * 1000;

const argv = process.argv.slice(2);
const slug = argv[0];
const baseIdx = argv.indexOf('--base');
const base = (baseIdx >= 0 ? argv[baseIdx + 1] : 'http://localhost:3100').replace(/\/$/, '');
const segIndices = argv.slice(1).filter((a) => /^\d+$/.test(a)).map(Number);

if (!slug || segIndices.length === 0) {
  console.error('usage: node scripts/retts-stock-segments.mjs <slug> <segIndex...> [--base http://localhost:3100]');
  console.error('  例: node scripts/retts-stock-segments.mjs 1985-spring 1 2');
  process.exit(1);
}

const v1Path = path.join(SCRIPTS_ROOT, `${slug}-v1.json`);
const stockPath = path.join(STOCK_ROOT, slug, 'stock.json');
if (!fs.existsSync(v1Path)) { console.error(`台本(v1.json)が無い: ${v1Path}`); process.exit(1); }
if (!fs.existsSync(stockPath)) { console.error(`stock.jsonが無い: ${stockPath}`); process.exit(1); }

const v1 = JSON.parse(fs.readFileSync(v1Path, 'utf8'));
const stock = JSON.parse(fs.readFileSync(stockPath, 'utf8'));
const m = slug.match(/^(\d{4})-([a-z]+)/i);
const year = m ? Number(m[1]) : undefined;
const season = m ? m[2].toLowerCase() : undefined;

console.log(`\n再TTS: ${slug}  対象セグメント [${segIndices.join(', ')}]  base=${base}`);

// 既存の全 archiveId を segmentIndex 順に取得（stock.json から）
const archiveIds = stock.segments
  .slice()
  .sort((a, b) => a.segmentIndex - b.segmentIndex)
  .map((s) => s.archiveId);

// 対象セグメントだけ辞書適用で再TTS（新 archiveId で上書き）
for (const idx of segIndices) {
  const seg = v1.segments[idx];
  if (!seg) { console.error(`v1.json に segment[${idx}] が無い`); process.exit(1); }
  process.stdout.write(`  seg${idx} ${seg.segmentTitle} 再TTS... `);
  let res;
  try {
    res = await fetch(`${base}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: seg.script,
        metadata: { segmentIndex: idx, segmentTitle: seg.segmentTitle, year, season },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    console.error(`接続失敗（dev起動とポートを確認）: ${e.message}`);
    process.exit(1);
  }
  const j = await res.json();
  if (!res.ok) { console.error(`失敗: ${j.error ?? res.status}`); process.exit(1); }
  archiveIds[idx] = j.archiveId;
  console.log(`✓ ${j.archiveId} (${j.chunks?.length ?? '?'} chunks)`);
}

// stockize で全セグメント再統合（対象=新 archiveId、他=既存 archiveId）
console.log('  stockize中（全セグメント再統合）...');
const args = [STOCKIZE, '--slug', slug];
archiveIds.forEach((id, i) => args.push(`--seg${i}`, id));
args.push('--script', v1Path);
execFileSync('node', args, { stdio: 'inherit', cwd: CWD });

console.log(`\n✓ ${slug} の seg[${segIndices.join(', ')}] を辞書適用で差し替えました`);
