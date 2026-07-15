/**
 * 重複音声（どもり）チャンクの外科的差し替え（2026-07-15）。
 *
 * 何をするか:
 *   壊れたチャンク「だけ」を同じ原稿のまま引き直し（TTSは非決定的なので別の音になる）、
 *   Whisperで検証して重複が消えるまでリトライ → セグメントmp3を再結合する。
 *   セグメント丸ごとの再TTSは、他の正常なチャンクまで引き直して新しい事故を招くのでやらない。
 *
 * なぜ独自に検証するか:
 *   /api/tts/chunk は「編集者が手で品質担保する」前提でWhisper検証をスキップする設計。
 *   引き直しは人が聴かずに回すので、ここで検証を持つ必要がある。
 *   判定は lib/tts-verifier.ts の findExtraRepeat と同じロジック（.mjsからtsを読めないため再実装）。
 *
 * 前提:
 *   - devサーバーが起動していること（既定 http://localhost:3100）
 *     ⚠️ 孤児devサーバーが残っているとffmpegが 0xC0000142 で全滅する。必ず起動し直してから実行する
 *   - OPENAI_API_KEY（--env-file=.env.local）
 *
 * usage:
 *   node --env-file=.env.local scripts/fix-duplicate-chunks.mjs --targets "1990-summer:2:4,1990-autumn:0:2" [--base http://localhost:3100] [--dry-run]
 *   node --env-file=.env.local scripts/fix-duplicate-chunks.mjs --from-scan scan.json   # scan-duplicate-audio.mjs --json の出力から
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import OpenAI from 'openai';
import { parseArgs, readJson, normalizeForCompare, STOCK_ROOT } from './shorts/util.mjs';

const args = parseArgs(process.argv.slice(2));
const BASE = String(args.base ?? 'http://localhost:3100').replace(/\/$/, '');
const DRY = !!args['dry-run'];
const MAX_ATTEMPTS = args['max-attempts'] != null ? Number(args['max-attempts']) : 5;

const CWD = process.cwd();
const ARCHIVE_ROOT = path.resolve(CWD, '.tts-archive');
const SCRIPTS_ROOT = path.resolve(CWD, '..', 'redial', 'data', 'scripts');
const STOCKIZE = path.resolve(CWD, 'scripts', 'stockize-episode.mjs');
const REPEAT_MIN_LEN = 12; // lib/tts-verifier.ts と揃える
const HTTP_TIMEOUT_MS = 10 * 60 * 1000;

const countOcc = (hay, needle) => { let n = 0, i = 0; for (;;) { const j = hay.indexOf(needle, i); if (j < 0) break; n++; i = j + 1; } return n; };

/** 転写にだけ現れる繰り返し（= 二度読み）を返す。lib/tts-verifier.ts の同名関数と同じ判定 */
function findExtraRepeat(t, s) {
  for (let i = 0; i + REPEAT_MIN_LEN <= t.length; i++) {
    const seed = t.slice(i, i + REPEAT_MIN_LEN);
    if (countOcc(t, seed) < 2 || countOcc(t, seed) <= countOcc(s, seed)) continue;
    let len = REPEAT_MIN_LEN;
    while (i + len + 1 <= t.length) {
      const grown = t.slice(i, i + len + 1);
      if (countOcc(t, grown) >= 2 && countOcc(t, grown) > countOcc(s, grown)) len++; else break;
    }
    const phrase = t.slice(i, i + len);
    return { phrase, times: countOcc(t, phrase) };
  }
  return null;
}

function parseTargets() {
  if (args['from-scan']) {
    const scan = readJson(String(args['from-scan']));
    return (scan.findings ?? [])
      .filter((f) => f.verdict === '実音声の重複')
      .map((f) => ({ cell: f.cell, seg: Number(String(f.seg).replace('seg', '')), chunk: f.chunk }));
  }
  if (!args.targets) {
    console.error('usage: --targets "cell:seg:chunk,..." もしくは --from-scan scan.json');
    process.exit(2);
  }
  return String(args.targets).split(',').map((t) => {
    const [cell, seg, chunk] = t.trim().split(':');
    return { cell, seg: Number(seg), chunk: Number(chunk) };
  });
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          reject(new Error(`${url} → ${res.statusCode}: ${json?.error ?? text.slice(0, 300)}`));
        } else resolve(json);
      });
    });
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error(`タイムアウト (${url})`)));
    req.on('error', (e) => reject(new Error(`接続失敗 (${url}): ${e.message}`)));
    req.write(body);
    req.end();
  });
}

const openai = new OpenAI();
async function transcribe(mp3Path) {
  const res = await openai.audio.transcriptions.create({
    file: fs.createReadStream(mp3Path), model: 'whisper-1', language: 'ja', response_format: 'text',
  });
  return typeof res === 'string' ? res : (res.text ?? '');
}

function archiveIdFor(cell, seg) {
  const stock = readJson(path.join(STOCK_ROOT, cell, 'stock.json'));
  const s = (stock.segments ?? []).find((x) => x.segmentIndex === seg);
  if (!s?.archiveId) throw new Error(`${cell} seg${seg}: archiveId が stock.json に無い`);
  return { archiveId: s.archiveId, stock };
}

async function fixOne(t) {
  const tag = `${t.cell} seg${t.seg} chunk${String(t.chunk).padStart(3, '0')}`;
  const { archiveId } = archiveIdFor(t.cell, t.seg);
  const archiveDir = path.join(ARCHIVE_ROOT, archiveId);
  const metaPath = path.join(archiveDir, 'meta.json');
  if (!fs.existsSync(metaPath)) throw new Error(`${tag}: archive が無い (${archiveDir})`);

  const meta = readJson(metaPath);
  const chunk = (meta.chunks ?? []).find((c) => c.index === t.chunk);
  if (!chunk) throw new Error(`${tag}: chunk ${t.chunk} が archive に無い`);

  const text = chunk.text;
  const normScript = normalizeForCompare(text);
  console.log(`\n[${tag}] ${text.length}字 / 現在 ${chunk.mp3Bytes}B`);
  console.log(`   原稿: ${text.slice(0, 54)}${text.length > 54 ? '…' : ''}`);
  if (DRY) return { ok: true, tag, dry: true };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // 同じ原稿のまま引き直す（TTSは非決定的＝別の音が出る）
    await postJson(`${BASE}/api/tts/chunk`, { archiveId, chunkIndex: t.chunk, newText: text });

    const fresh = readJson(metaPath);
    const fc = fresh.chunks.find((c) => c.index === t.chunk);
    const mp3Path = path.join(archiveDir, fc.mp3File);
    const tx = await transcribe(mp3Path);
    const rep = findExtraRepeat(normalizeForCompare(tx), normScript);

    if (!rep) {
      console.log(`   ✓ 試行${attempt}: 重複なし (${fc.mp3Bytes}B / 元 ${chunk.mp3Bytes}B)`);
      return { ok: true, tag, bytes: fc.mp3Bytes, before: chunk.mp3Bytes, attempts: attempt };
    }
    console.log(`   ✗ 試行${attempt}: 「${rep.phrase.slice(0, 20)}」×${rep.times} → 引き直し`);
  }
  return { ok: false, tag, reason: `${MAX_ATTEMPTS}回引き直しても重複が消えない（手当てが必要）` };
}

/** 修正したセグメントを含むエピソードを stockize で再統合（archiveIdは据え置き＝音だけ新しくなる） */
function restockize(cell) {
  const stockPath = path.join(STOCK_ROOT, cell, 'stock.json');
  const stock = readJson(stockPath);
  const v1Path = path.join(SCRIPTS_ROOT, `${cell}-v1.json`);
  if (!fs.existsSync(v1Path)) throw new Error(`${cell}: 台本(v1.json)が無い: ${v1Path}`);
  const ids = [...stock.segments].sort((a, b) => a.segmentIndex - b.segmentIndex).map((s) => s.archiveId);
  const a = [STOCKIZE, '--slug', cell];
  ids.forEach((id, i) => a.push(`--seg${i}`, id));
  a.push('--script', v1Path);
  execFileSync('node', a, { stdio: 'inherit', cwd: CWD });
}

async function main() {
  const targets = parseTargets();
  console.log(`${DRY ? '[DRY-RUN] ' : ''}${targets.length}チャンクを引き直します（base=${BASE}）`);

  const results = [];
  for (const t of targets) {
    try { results.push(await fixOne(t)); }
    catch (e) { console.error(`   ✗ ${e.message}`); results.push({ ok: false, tag: `${t.cell} seg${t.seg} chunk${t.chunk}`, reason: e.message }); }
  }

  if (!DRY) {
    const cells = [...new Set(targets.map((t) => t.cell))];
    console.log(`\n=== stockize（${cells.length}エピソード再統合）===`);
    for (const cell of cells) {
      try { restockize(cell); }
      catch (e) { console.error(`✗ stockize ${cell}: ${e.message}`); results.push({ ok: false, tag: `stockize ${cell}`, reason: e.message }); }
    }
  }

  console.log('\n=== 結果 ===');
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.tag}${r.ok ? '' : ' — ' + r.reason}`);
  const ng = results.filter((r) => !r.ok);
  console.log(`\n完了: ${results.length - ng.length}/${results.length}`);
  if (!DRY) {
    console.log('次: node scripts/scan-duplicate-audio.mjs で回帰確認 → redial側 scripts/upload-stock-to-blob.mjs でBlob反映');
  }
  if (ng.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
