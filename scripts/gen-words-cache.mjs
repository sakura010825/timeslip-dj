/**
 * 指定セグメントの Whisper 結果（words.json）だけを作るCLI。
 *
 * なぜ要るか: 中尺（make-midform.mjs）は各セグメントの words.json を前提にするが、
 * その生成は make-short.mjs の副産物になっていて、**ショートを作っていないセグメントでは貯まらない**。
 * 中尺の題材を「ショート未使用のセル」から選ぶ方針（2026-08-28）にした結果、
 * ショートを1本でっち上げないとキャッシュが作れない、という本末転倒が起きるので切り出した。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/gen-words-cache.mjs --cell 1995-summer --seg 3
 */
import { locateSegAudio, getWords } from './shorts/resolve.mjs';
import { parseArgs } from './shorts/util.mjs';

const args = parseArgs(process.argv.slice(2));
const cell = args.cell;
const seg = Number(args.seg);

if (!cell || Number.isNaN(seg)) {
  console.error('使い方: node --env-file=.env.local scripts/gen-words-cache.mjs --cell <cell> --seg <N>');
  process.exit(1);
}

const { mp3Path, segmentName, durationSec } = locateSegAudio(cell, seg);
console.log(`セグメント: ${cell} seg${seg} (${segmentName})`);
console.log(`音声: ${mp3Path}`);
console.log(`尺: ${durationSec ?? '不明'}秒`);

const data = await getWords(cell, seg, mp3Path);
console.log(`✅ words=${data.words.length} / segments=${data.segments.length}`);
console.log(`全文: ${String(data.text).slice(0, 200)}…`);
