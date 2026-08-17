/**
 * 字幕の折返しだけを、mp4を焼かずに確認する（2026-08-10）。
 *
 * なぜ必要か:
 *   語割れ（「あそこ」が「あ／そこ」に割れる等）は check-overflow も check-proper-nouns も
 *   通り抜ける。捕まえるにはASSの表示行を見るしかないが、そのためだけに1本35秒の
 *   ffmpegレンダを回していた（fixesを1つ直すたびに35秒×本数）。
 *   窓解決とASS生成は Whisper キャッシュだけで完結する＝**音も絵も要らない**ので、
 *   そこまでを実行して表示行を出す。修正の反復がミリ秒になる。
 *
 * ⚠️ これは焼き直しの代わりではない。fixes が固まったら make-short.mjs で本レンダする。
 *
 * usage:
 *   node --env-file=.env.local scripts/shorts/preview-subs.mjs 26,27,28
 *   node --env-file=.env.local scripts/shorts/preview-subs.mjs 26 --all   # バッジ/CTA/エンドカードも出す
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { readJson } from './util.mjs';
import { locateSegAudio, getWords, resolveWindow } from './resolve.mjs';
import { buildAss } from './subtitles.mjs';

const ids = (process.argv[2] ?? '').split(',').map((s) => Number(s.trim())).filter(Boolean);
const ALL = process.argv.includes('--all');
if (!ids.length) {
  console.error('usage: node --env-file=.env.local scripts/shorts/preview-subs.mjs 26,27');
  process.exit(2);
}

const manifest = readJson(path.resolve('data', 'shorts.manifest.json'));
const tmp = path.join(os.tmpdir(), 'shorts-preview.ass');

for (const id of ids) {
  const s = (manifest.shorts ?? []).find((x) => x.id === id);
  if (!s) { console.log(`#${id} はマニフェストにありません`); continue; }

  const parts = (s.clips && s.clips.length) ? s.clips : [{ seg: s.seg, start: s.start, end: s.end }];
  const clips = [];
  for (const part of parts) {
    const { mp3Path, durationSec } = locateSegAudio(s.cell, part.seg);
    const data = await getWords(s.cell, part.seg, mp3Path);
    const whisperEnd = Math.max(0, ...(data.words ?? []).map((w) => w.end), ...(data.segments ?? []).map((x) => x.end));
    const padStart = part.padStart ?? s.padStart ?? 0.25;
    const padEnd = part.padEnd ?? s.padEnd ?? (s.song ? 0 : 0.6);
    const win = resolveWindow({
      data, startAnchor: part.start, endAnchor: part.end, padStart, padEnd,
      segDurationSec: Math.max(durationSec ?? 0, whisperEnd),
    });
    if (!win.ok) { console.log(`#${id} 窓解決に失敗`); break; }
    clips.push({ segments: data.segments, words: data.words, win });
  }
  if (clips.length !== parts.length) continue;

  const dur = clips.reduce((n, c) => n + c.win.dur, 0);
  buildAss({
    assPath: tmp, clips,
    year: s.cell.split('-')[0], season: s.cell.split('-')[1],
    title: s.title, topic: s.topic ?? (s.song ? null : s.hook),
    subsOverride: null, endcardSec: s.song ? 3.4 : s.walkingFlame ? 4.0 : 3.0,
    djName: manifest.dj ?? '毎晩22時の深夜ラジオ・シンヤ',
    songCard: s.song ?? null, walkingFlame: !!s.walkingFlame, fixes: s.fixes ?? null,
  });

  console.log(`\n========== #${id} ${s.hook}（${s.cell} seg${parts.map((p) => p.seg).join('+')}・${dur.toFixed(1)}s） ==========`);
  for (const line of fs.readFileSync(tmp, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('Dialogue:')) continue;
    const p = line.split(',');
    const style = p[3].trim();
    if (!ALL && style !== 'Sub') continue;
    const text = p.slice(9).join(',');
    const rows = text.split('\\N').map((x) => x.replace(/\{[^}]*\}/g, ''));
    const w = (x) => Array.from(x).reduce((n, ch) => n + (/[\x00-\xFF｡-ﾟ]/.test(ch) ? 0.5 : 1), 0);
    console.log(`${p[1]} ${style.padEnd(7)} ${rows.map((r) => `[${r}]${w(r) > 24 ? '⚠' : ''}`).join(' / ')}`);
  }
}
