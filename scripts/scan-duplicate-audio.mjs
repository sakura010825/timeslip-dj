/**
 * 重複音声（TTSが同じ箇所を二度読む「どもり」）の一括検査。API課金ゼロ。
 *
 * なぜ必要か:
 *   チャンク検証の類似度はLCSベースで、「原稿が転写の部分列として残っているか」しか見ない。
 *   TTSが同じ文を二度読んでも原稿は部分列として残るため similarity≈1 で合格する＝原理的に重複を検出できない。
 *   実際に公開25本のうち11本に5〜47秒のどもりが残っていた（2026-07-15 発見）。
 *   lib/tts-verifier.ts に重複検出を入れて今後の生成は塞いだが、本スクリプトは
 *   ①既存ストックの棚卸し ②再TTS後の回帰確認 に使う。
 *
 * 仕組み:
 *   生成時に保存された chunk の verification.transcript（原稿と対で残っている）を読み、
 *   「原稿には無いのに転写にだけ2回以上現れる長い句」を探す。さらに mp3 のバイト数（CBR＝尺に比例）を使って
 *   「実際に音が重複している」のか「Whisperの幻聴で音は正常」なのかを判別する:
 *     実音声の重複 → 原稿に対して尺が長すぎ、かつ転写に対しては正常
 *     Whisperの幻聴 → 原稿に対する尺は正常、かつ転写に対して尺が足りない
 *
 * usage:
 *   node scripts/scan-duplicate-audio.mjs [--cell 1990-summer] [--json out.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { STOCK_ROOT, parseArgs, normalizeForCompare, readJson } from './shorts/util.mjs';

const args = parseArgs(process.argv.slice(2));
const ONLY_CELL = args.cell ? String(args.cell) : null;

/** lib/tts-verifier.ts の REPEAT_MIN_LEN と揃える（12〜15字は同結果・10字は誤検出増） */
const REPEAT_MIN_LEN = 12;
/** 原稿に対する尺比がこれを超える＝原稿より明らかに長い */
const LONG_VS_SCRIPT = 1.35;
/** 転写に対する尺比がこれを下回る＝転写ぶんの音が実在しない＝Whisperの幻聴 */
const SHORT_VS_TRANSCRIPT = 0.7;

const countOcc = (hay, needle) => {
  let n = 0; let i = 0;
  for (;;) { const j = hay.indexOf(needle, i); if (j < 0) break; n++; i = j + 1; }
  return n;
};

function findExtraRepeat(t, s) {
  for (let i = 0; i + REPEAT_MIN_LEN <= t.length; i++) {
    const seed = t.slice(i, i + REPEAT_MIN_LEN);
    if (countOcc(t, seed) < 2 || countOcc(t, seed) <= countOcc(s, seed)) continue;
    let len = REPEAT_MIN_LEN;
    while (i + len + 1 <= t.length) {
      const grown = t.slice(i, i + len + 1);
      if (countOcc(t, grown) >= 2 && countOcc(t, grown) > countOcc(s, grown)) len++;
      else break;
    }
    const phrase = t.slice(i, i + len);
    return { phrase, times: countOcc(t, phrase), len };
  }
  return null;
}

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

function collect() {
  const rows = [];
  for (const cell of fs.readdirSync(STOCK_ROOT)) {
    if (ONLY_CELL && cell !== ONLY_CELL) continue;
    const sa = path.join(STOCK_ROOT, cell, 'source-archives');
    if (!fs.existsSync(sa)) continue;
    for (const seg of fs.readdirSync(sa)) {
      const p = path.join(sa, seg, 'meta.json');
      if (!fs.existsSync(p)) continue;
      const m = readJson(p);
      for (const c of m.chunks ?? []) {
        const v = c.verification ?? {};
        const raw = String(v.transcript ?? '');
        // 旧・subdivided経路は転写を捨てていた（similarity:1を捏造）。転写が無いものは判定不能。
        const hasTx = raw && !raw.includes('[subdivided & merged]');
        rows.push({
          cell, seg, index: c.index, text: c.text ?? '', bytes: c.mp3Bytes ?? 0,
          attempts: c.attempts, v, hasTx,
          t: hasTx ? normalizeForCompare(raw) : '',
          s: normalizeForCompare(c.text ?? ''),
        });
      }
    }
  }
  return rows;
}

const rows = collect();
if (!rows.length) {
  console.error(`対象が見つかりません（STOCK_ROOT=${STOCK_ROOT}${ONLY_CELL ? ` cell=${ONLY_CELL}` : ''}）`);
  process.exit(2);
}

const withTx = rows.filter((r) => r.hasTx && r.t.length && r.s.length);
const noTx = rows.filter((r) => !r.hasTx);
for (const r of withTx) r.rep = findExtraRepeat(r.t, r.s);

const clean = withTx.filter((r) => !r.rep);
const medBpT = median(clean.map((r) => r.bytes / r.t.length));
const medBpS = median(clean.map((r) => r.bytes / r.s.length));

const flagged = withTx.filter((r) => r.rep).map((r) => {
  const rS = (r.bytes / r.s.length) / medBpS;
  const rT = (r.bytes / r.t.length) / medBpT;
  const verdict = rT > 0.8 && rS > LONG_VS_SCRIPT ? '実音声の重複'
    : rT < SHORT_VS_TRANSCRIPT ? 'Whisperの幻聴（音は正常）'
      : '判定保留';
  const extraSec = Math.round((r.bytes - r.s.length * medBpS) / (medBpS * 7.5));
  return { ...r, rS: +rS.toFixed(2), rT: +rT.toFixed(2), verdict, extraSec };
}).sort((a, b) => b.rS - a.rS);

console.log(`走査 ${rows.length}チャンク（転写あり${withTx.length} / 転写なし${noTx.length}）`);
console.log(`基準: bytes/原稿字=${Math.round(medBpS)}  bytes/転写字=${Math.round(medBpT)}（重複なし${clean.length}件の中央値）\n`);

for (const r of flagged) {
  console.log(`${r.verdict}  ${r.cell} ${r.seg} chunk${String(r.index).padStart(3, '0')}  尺比 対原稿=${r.rS}x 対転写=${r.rT}x  「${r.rep.phrase.slice(0, 22)}」×${r.rep.times}  sim=${r.v.similarity} ok=${r.v.ok} att=${r.attempts}  余分≈${r.extraSec}秒`);
  console.log(`    原稿: ${r.text.slice(0, 46)}…`);
}

if (noTx.length) {
  console.log(`\n⚠ 転写が保存されていない（旧subdivided経路）ため判定不能: ${noTx.length}件`);
  for (const r of noTx) console.log(`    ${r.cell} ${r.seg} chunk${String(r.index).padStart(3, '0')}  ${r.v.reason ?? ''}`);
}

const real = flagged.filter((r) => r.verdict === '実音声の重複');
const hold = flagged.filter((r) => r.verdict === '判定保留');
console.log(`\n=== 結論 ===`);
console.log(`実音声の重複: ${real.length}件  影響セグメント: ${[...new Set(real.map((r) => `${r.cell}/${r.seg}`))].join(' ')}`);
console.log(`判定保留: ${hold.length}件  ／ Whisperの幻聴: ${flagged.length - real.length - hold.length}件`);

if (args.json) {
  fs.writeFileSync(String(args.json), JSON.stringify({
    scanned: rows.length,
    baseline: { bytesPerScriptChar: Math.round(medBpS), bytesPerTranscriptChar: Math.round(medBpT) },
    findings: flagged.map((r) => ({
      cell: r.cell, seg: r.seg, chunk: r.index, verdict: r.verdict,
      ratioVsScript: r.rS, ratioVsTranscript: r.rT, extraSec: r.extraSec,
      repeat: r.rep.phrase, times: r.rep.times,
      similarity: r.v.similarity, ok: r.v.ok, attempts: r.attempts,
      text: r.text,
    })),
    unverifiable: noTx.map((r) => ({ cell: r.cell, seg: r.seg, chunk: r.index, reason: r.v.reason })),
  }, null, 2), 'utf8');
  console.log(`\n→ ${args.json}`);
}

process.exitCode = real.length ? 1 : 0;
