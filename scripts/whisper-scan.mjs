/**
 * Whisper全文検査ツール — TTSアーカイブの Whisper 検証書き起こしを年×季節で集計し、
 * 誤読の疑いがあるチャンク（低類似度）をトリアージ表示する恒久ツール。
 *
 * 標準フロー（docs/COVERAGE_RUN_LOG.md）の「公開前にClaudeがWhisper全文検査」を仕組み化したもの。
 * TTS時に各チャンクは Whisper で検証され、meta.json の chunks[].verification.transcript に
 * 書き起こしが残る。本ツールはそれを read-only で集計するだけ（再TTSはしない）。
 *
 * 同音異字（走馬灯→相馬島 等、音は正しいがWhisperが別漢字を当てる）と
 * 実誤読（俵万智→タワラマンチ 等、音そのものが違う）は similarity だけでは区別できないため、
 * text と transcript を並べて人（Claude）が判定する前提のトリアージ表示。
 *
 * 前提: timeslip-dj ディレクトリで実行（.tts-archive を参照）
 *
 * 使い方:
 *   node scripts/whisper-scan.mjs 1987 summer
 *   node scripts/whisper-scan.mjs 1987 summer --threshold 0.97   # 既定 0.95
 *   node scripts/whisper-scan.mjs 1987 summer --all              # 全チャンク表示
 */
import fs from 'node:fs';
import path from 'node:path';

const year = Number(process.argv[2]);
const season = (process.argv[3] || '').toLowerCase();
if (!year || !season) {
  console.error('usage: node scripts/whisper-scan.mjs <year> <season> [--threshold 0.95] [--all]');
  process.exit(1);
}
const thIdx = process.argv.indexOf('--threshold');
const threshold = thIdx >= 0 ? Number(process.argv[thIdx + 1]) : 0.95;
const showAll = process.argv.includes('--all');

const ARCHIVE_ROOT = path.resolve(process.cwd(), '.tts-archive');
if (!fs.existsSync(ARCHIVE_ROOT)) {
  console.error(`.tts-archive が見つかりません: ${ARCHIVE_ROOT}（timeslip-dj で実行していますか）`);
  process.exit(1);
}

// 年×季節に一致する meta.json を集め、segmentIndex ごとに最新（dir名降順）を採用
const dirs = fs.readdirSync(ARCHIVE_ROOT).filter((d) => {
  try { return fs.statSync(path.join(ARCHIVE_ROOT, d)).isDirectory(); } catch { return false; }
});
const bySeg = new Map();
for (const d of dirs) {
  const mp = path.join(ARCHIVE_ROOT, d, 'meta.json');
  if (!fs.existsSync(mp)) continue;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { continue; }
  if (meta.year !== year || meta.season !== season) continue;
  const si = meta.segmentIndex ?? 0;
  const prev = bySeg.get(si);
  if (!prev || d > prev.dir) bySeg.set(si, { dir: d, meta });
}

if (bySeg.size === 0) {
  console.error(`該当アーカイブなし: year=${year} season=${season}`);
  process.exit(1);
}

const segs = [...bySeg.entries()].sort((a, b) => a[0] - b[0]);
console.log(`\n=== Whisper全文検査: ${year}-${season}  (threshold=${threshold}) ===`);
let totalChunks = 0, totalEdited = 0, totalFlagged = 0;

for (const [si, { dir, meta }] of segs) {
  const chunks = meta.chunks ?? [];
  totalChunks += chunks.length;
  const flagged = [];
  for (const c of chunks) {
    if (c.editedAt) totalEdited++;
    const v = c.verification ?? {};
    const sim = typeof v.similarity === 'number' ? v.similarity : 1;
    // 年号ミスマッチ検出: text の西暦(19xx/20xx)が asr に無ければ誤読の疑い。
    // Whisperは発話された数字を桁に正規化するため、年号の数字読み誤り（1991→にせん等）は
    // similarityだけでは捕捉できない（年号は長いチャンクの一部で似度が下がりにくい）。年号集合の差分で別途検出する。
    const yp = /(?:19|20)\d{2}/g;
    const tY = c.text.match(yp) || [];
    const aY = (v.transcript || '').match(yp) || [];
    const yearMiss = v.transcript ? tY.filter((y) => !aY.includes(y)) : [];
    const yearFlag = yearMiss.length > 0 && !c.editedAt;
    if (showAll || sim < threshold || v.ok === false || yearFlag)
      flagged.push({ c, sim, v, yearFlag, yearMiss });
  }
  totalFlagged += flagged.length;
  console.log(`\n■ seg${si} ${meta.segmentTitle ?? ''}  [${dir}]  chunks=${chunks.length} flagged=${flagged.length}`);
  for (const { c, sim, v, yearFlag, yearMiss } of flagged) {
    const edited = c.editedAt ? ' (EDITED)' : '';
    const yf = yearFlag ? ` ⚠️YEAR[${yearMiss.join(',')}]` : '';
    console.log(`  chunk[${c.index}] sim=${sim.toFixed(3)} attempts=${c.attempts ?? '?'}${edited}${yf}`);
    console.log(`    text  : ${c.text}`);
    console.log(`    asr   : ${(v.transcript ?? '').replace(/\n/g, ' ').trim()}`);
  }
}

console.log(`\n--- 集計: seg=${segs.length} chunks=${totalChunks} flagged=${totalFlagged} edited=${totalEdited} ---`);
console.log('※ flagged は「誤読の疑い」候補。text と asr を見比べ、音が違うもの（実誤読）のみ辞書追加＋差し替え。');
console.log('※ 同音異字（音は正しくWhisperが別漢字を当てただけ）は修正不要。\n');
