/**
 * 編集済みエピソードを redial/data/stock/ にストック化する。
 *
 * 走馬灯型は5セグメント（opening / middle1 / middle2 / ending前半 / ending後半）。
 * 旧型は4セグメント（opening / middle1 / middle2 / ending）にも対応。
 *
 * 使い方（走馬灯型・5セグメント）:
 *   node scripts/stockize-episode.mjs \
 *     --slug 2000-autumn \
 *     --seg0 2026-05-15_15-42-13_seg0 \
 *     --seg1 2026-05-15_15-44-12_seg1 \
 *     --seg2 2026-05-15_15-46-53_seg2 \
 *     --seg3 2026-05-15_15-49-18_seg3 \
 *     --seg4 2026-05-15_15-50-40_seg4
 *
 * 使い方（旧型・4セグメント）:
 *   node scripts/stockize-episode.mjs \
 *     --slug 1995-autumn-09 \
 *     --seg0 ... --seg1 ... --seg2 ... --seg3 ...
 */

import fs from 'node:fs';
import path from 'node:path';

const ARCHIVE_ROOT = path.resolve(process.cwd(), '.tts-archive');
const STOCK_ROOT = path.resolve(process.cwd(), '..', 'redial', 'data', 'stock');
const SCRIPTS_ROOT = path.resolve(process.cwd(), '..', 'redial', 'data', 'scripts');
const YT_CANDIDATES_ROOT = path.resolve(process.cwd(), '..', 'redial', 'data', 'youtube-candidates');

const args = parseArgs(process.argv.slice(2));
if (!args.slug || !args.seg0 || !args.seg1 || !args.seg2 || !args.seg3) {
  console.error('usage: --slug <name> --seg0 <id> --seg1 <id> --seg2 <id> --seg3 <id> [--seg4 <id>]');
  console.error('  --script <path>  optional: scripts/{slug}-v1.json で songAfter を補完');
  process.exit(1);
}

const isWalkingFlame = !!args.seg4;
const segIndices = isWalkingFlame ? [0, 1, 2, 3, 4] : [0, 1, 2, 3];

// ─── 楽曲メタデータの解決 ────────────────────────────────
// 優先順:
//   1. --script で渡された v1.json から segments[N].songTitle/artistName を取得
//   2. それがなければ data/scripts/{slug}-v1.json を自動探索
//   3. videoId は data/youtube-candidates/{year}.json からマッチング
//   4. なければ null（再生時に動的検索フォールバック）
const scriptPath = args.script ?? path.join(SCRIPTS_ROOT, `${args.slug}-v1.json`);
let scriptData = null;
if (fs.existsSync(scriptPath)) {
  try {
    scriptData = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    console.log(`[script] loaded songs from ${scriptPath}`);
  } catch (e) {
    console.warn(`[script] failed to parse ${scriptPath}: ${e.message}`);
  }
} else {
  console.warn(`[script] not found: ${scriptPath} — songAfter will be null`);
}

// YouTube candidates は year-prefix からファイルを推定
const yearMatch = args.slug.match(/^(\d{4})-/);
const candidatesPath = yearMatch
  ? path.join(YT_CANDIDATES_ROOT, `${yearMatch[1]}.json`)
  : null;
let ytCandidates = [];
if (candidatesPath && fs.existsSync(candidatesPath)) {
  try {
    const data = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
    ytCandidates = Array.isArray(data) ? data : data.candidates ?? [];
    console.log(`[yt-candidates] loaded ${ytCandidates.length} entries from ${candidatesPath}`);
  } catch (e) {
    console.warn(`[yt-candidates] failed to parse: ${e.message}`);
  }
}

function resolveSongAfter(segIdx) {
  if (!scriptData?.segments) return null;
  const seg = scriptData.segments[segIdx];
  if (!seg?.songTitle || !seg?.artistName) return null;
  const title = seg.songTitle;
  const artist = seg.artistName;
  // YouTube candidate からタイトル+アーティストでマッチング
  const cand = ytCandidates.find((c) => matchSong(c, title, artist));
  return {
    title,
    artist,
    videoId: cand?.videoId ?? null,
    curatedAt: cand ? new Date().toISOString().slice(0, 10) : null,
  };
}

/** タイトル正規化（既存のsearch-video curation と同じロジックを簡略再現） */
function normTitle(s) {
  return s
    .toLowerCase()
    .replace(/[／/].*$/, '') // A面/B面表記の除去
    .replace(/[「」『』〜～\s'"]/g, '')
    .replace(/[ぁ-んァ-ヶ]/g, (c) => c) // 平仮名/カタカナ吸収は省略（必要なら拡張）
    .trim();
}

function matchSong(cand, title, artist) {
  if (!cand) return false;
  const candTitle = cand.title ?? cand.songTitle ?? '';
  const candArtist = cand.artist ?? cand.artistName ?? '';
  return (
    normTitle(candTitle) === normTitle(title) &&
    normTitle(candArtist) === normTitle(artist)
  );
}
// ──────────────────────────────────────────────────────

const stockDir = path.join(STOCK_ROOT, args.slug);
fs.mkdirSync(path.join(stockDir, 'segments'), { recursive: true });
fs.mkdirSync(path.join(stockDir, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(stockDir, 'source-archives'), { recursive: true });

const segMetas = [];
const SEG_NAMES_LEGACY = {
  0: { name: 'opening', label: 'オープニング' },
  1: { name: 'middle-talk-1', label: 'ミドルトーク1' },
  2: { name: 'middle-talk-2', label: 'ミドルトーク2' },
  3: { name: 'ending', label: 'エンディング' },
};
const SEG_NAMES_WALKING_FLAME = {
  0: { name: 'opening', label: 'オープニング' },
  1: { name: 'middle-talk-1', label: 'ミドルトーク1' },
  2: { name: 'middle-talk-2', label: 'ミドルトーク2' },
  3: { name: 'ending-1', label: 'エンディング前半' },
  4: { name: 'ending-2', label: 'エンディング後半' },
};
const SEG_NAMES = isWalkingFlame ? SEG_NAMES_WALKING_FLAME : SEG_NAMES_LEGACY;

for (const segIdx of segIndices) {
  const archiveId = args[`seg${segIdx}`];
  const src = path.join(ARCHIVE_ROOT, archiveId);
  if (!fs.existsSync(src)) {
    console.error(`archive not found: ${archiveId}`);
    process.exit(1);
  }
  const segName = SEG_NAMES[segIdx].name;
  const segLabel = SEG_NAMES[segIdx].label;

  // 1) output.mp3 を segments/ にコピー
  const segMp3Dest = path.join(stockDir, 'segments', `seg${segIdx}-${segName}.mp3`);
  fs.copyFileSync(path.join(src, 'output.mp3'), segMp3Dest);

  // 2) 編集済みスクリプトを scripts/ に保存（chunks の text をジョイン）
  const meta = JSON.parse(fs.readFileSync(path.join(src, 'meta.json'), 'utf8'));
  const finalScript = meta.chunks.map((c) => c.text).join('\n');
  fs.writeFileSync(
    path.join(stockDir, 'scripts', `seg${segIdx}-${segName}.txt`),
    finalScript,
    'utf8',
  );

  // 3) 元の archive ディレクトリ全体を source-archives/seg{N}/ にコピー
  const archDest = path.join(stockDir, 'source-archives', `seg${segIdx}`);
  fs.mkdirSync(archDest, { recursive: true });
  copyDir(src, archDest);

  // 4) サマリ情報を蓄積
  const editedChunks = meta.chunks.filter((c) => c.editedAt);
  const songAfter = resolveSongAfter(segIdx);
  segMetas.push({
    segmentIndex: segIdx,
    segmentName: segName,
    segmentLabel: segLabel,
    archiveId,
    generatedAt: meta.timestamp,
    lastEditAt: meta.lastEditAt ?? null,
    outputBytes: meta.outputBytes,
    estimatedDurationSec: meta.estimatedDurationSec,
    chunkCount: meta.chunks.length,
    editedChunkCount: editedChunks.length,
    editedChunks: editedChunks.map((c) => ({
      index: c.index,
      previousText: c.previousText ?? null,
      currentText: c.text,
    })),
    ttsModel: meta.tts?.model,
    ttsVoice: meta.tts?.voice,
    songAfter,
  });

  const songInfo = songAfter
    ? ` / song: ${songAfter.title} - ${songAfter.artist}${songAfter.videoId ? ' ['+songAfter.videoId+']' : ' (videoId未取得)'}`
    : segIdx === 4 || (!isWalkingFlame && segIdx === 3)
    ? ' (ending segment, no song)'
    : ' (no song info)';
  console.log(
    `[seg${segIdx}] ${segLabel}: copied (${meta.chunks.length} chunks, ${editedChunks.length} edited)${songInfo}`,
  );
}

// 5) ストック全体の meta を生成
const stockMeta = {
  slug: args.slug,
  format: isWalkingFlame ? 'walking-flame-v1' : 'legacy-v1',
  generatedBy: 'scripts/stockize-episode.mjs',
  stockizedAt: new Date().toISOString(),
  segments: segMetas,
  totalChunks: segMetas.reduce((s, m) => s + m.chunkCount, 0),
  totalEditedChunks: segMetas.reduce((s, m) => s + m.editedChunkCount, 0),
  totalDurationSec: segMetas.reduce((s, m) => s + m.estimatedDurationSec, 0),
};
fs.writeFileSync(
  path.join(stockDir, 'stock.json'),
  JSON.stringify(stockMeta, null, 2),
  'utf8',
);

console.log(`\n✓ Stockized to: ${stockDir}`);
console.log(`  total chunks: ${stockMeta.totalChunks}`);
console.log(`  total edited: ${stockMeta.totalEditedChunks} (${((stockMeta.totalEditedChunks / stockMeta.totalChunks) * 100).toFixed(0)}%)`);
console.log(`  total duration: ${stockMeta.totalDurationSec.toFixed(1)}s (≈ ${(stockMeta.totalDurationSec / 60).toFixed(1)}min)`);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1];
      out[k] = v;
      i++;
    }
  }
  return out;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}
