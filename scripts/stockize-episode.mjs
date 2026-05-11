/**
 * 編集済みエピソードを redial/data/stock/ にストック化する。
 *
 * 4セグメント分の archive ID を引数に取り、整理コピーする。
 *
 * 使い方:
 *   node scripts/stockize-episode.mjs \
 *     --slug 1995-autumn-09 \
 *     --seg0 2026-05-11_13-53-35_seg0 \
 *     --seg1 2026-05-11_13-57-00_seg1 \
 *     --seg2 2026-05-11_14-07-33_seg2 \
 *     --seg3 2026-05-11_14-19-42_seg3
 */

import fs from 'node:fs';
import path from 'node:path';

const ARCHIVE_ROOT = path.resolve(process.cwd(), '.tts-archive');
const STOCK_ROOT = path.resolve(process.cwd(), '..', 'redial', 'data', 'stock');

const args = parseArgs(process.argv.slice(2));
if (!args.slug || !args.seg0 || !args.seg1 || !args.seg2 || !args.seg3) {
  console.error('usage: --slug <name> --seg0 <id> --seg1 <id> --seg2 <id> --seg3 <id>');
  process.exit(1);
}

const stockDir = path.join(STOCK_ROOT, args.slug);
fs.mkdirSync(path.join(stockDir, 'segments'), { recursive: true });
fs.mkdirSync(path.join(stockDir, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(stockDir, 'source-archives'), { recursive: true });

const segMetas = [];
const SEG_NAMES = {
  0: { name: 'opening', label: 'オープニング' },
  1: { name: 'middle-talk-1', label: 'ミドルトーク1' },
  2: { name: 'middle-talk-2', label: 'ミドルトーク2' },
  3: { name: 'ending', label: 'エンディング' },
};

for (const segIdx of [0, 1, 2, 3]) {
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
  });

  console.log(
    `[seg${segIdx}] ${segLabel}: copied (${meta.chunks.length} chunks, ${editedChunks.length} edited)`,
  );
}

// 5) ストック全体の meta を生成
const stockMeta = {
  slug: args.slug,
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
