/**
 * 窓の端が語の途中で切れていないかの静的検査。
 *
 * ⚠️ padStart / padEnd は「間」を拾うための余白だが、隣の文が間を置かずに続くと隣の語を
 *   巻き込む。音声は語の途中でぶつ切りになり、字幕には喋っていない語が混じる。
 *   2026-07-30 に公開中の2本で実際に起きていた:
 *     生きろ。の夏（988再生）  「あの夏のことです」の後、padEnd 0.6 が「そして」に食い込み
 *                              字幕は「…のことですそ」・音声は「し」の途中で終端
 *     プリクラ財布の一枚        「思っています」の後、padEnd 0.6 が「同じ秋」に食い込む
 *   どちらも check-overflow / check-proper-nouns を素通りした＝**黙って壊れる**種類の不具合。
 *   resolve.mjs 側に隣語クランプを入れたが、窓は手で書き換えられるので検査も残す。
 *
 * 判定: 出力 .json の window（型Cは clips）と Whisper 語時刻キャッシュを突き合わせ、
 *   境界を跨いでいる語（w.start < t < w.end）があれば NG。
 *
 * 使い方: node scripts/shorts/check-window-tail.mjs [output/shorts]
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join('output', 'shorts'));
const CACHE = path.join(OUT, '.cache');
const EPS = 0.02;

const files = fs.existsSync(OUT)
  ? fs.readdirSync(OUT).filter((f) => f.endsWith('.json')).sort()
  : [];

const bad = [];
const skipped = [];
let checked = 0;

for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  // winClips が正。型C（走馬灯）は窓が複数あり、まとめた window は start > end という
  // 無意味な値になる（1993秋 = 34.03→22.54）ので、window だけを見ると型Cを素通りする。
  const wins = Array.isArray(j.winClips) && j.winClips.length
    ? j.winClips.map((c) => ({ seg: c.seg, t0: c.start, t1: c.end }))
    : j.window ? [{ seg: j.seg, t0: j.window.start, t1: j.window.end }] : [];

  for (const w of wins) {
    if (w.t0 == null || w.t1 == null) { skipped.push(`${f}（窓なし）`); continue; }
    const cachePath = path.join(CACHE, `${j.cell}-seg${w.seg}.words.json`);
    if (!fs.existsSync(cachePath)) { skipped.push(`${f} seg${w.seg}（語時刻キャッシュなし）`); continue; }
    const words = JSON.parse(fs.readFileSync(cachePath, 'utf8')).words ?? [];
    if (!words.length) { skipped.push(`${f} seg${w.seg}（語時刻が空）`); continue; }
    checked++;

    for (const [edge, t] of [['冒頭', w.t0], ['末尾', w.t1]]) {
      const cut = words.find((x) => x.start < t - EPS && x.end > t + EPS);
      if (!cut) continue;
      const inside = words.filter((x) => x.start >= w.t0 - EPS && x.end <= w.t1 + EPS);
      const tail = edge === '末尾'
        ? inside.slice(-5).map((x) => x.word).join('')
        : inside.slice(0, 5).map((x) => x.word).join('');
      bad.push({ f: f.replace(/\.json$/, ''), seg: w.seg, edge, t, cut, tail });
    }
  }
}

for (const b of bad) {
  console.log(`NG ${b.f} seg${b.seg}  ${b.edge} t=${b.t.toFixed(2)}s  語「${b.cut.word}」を途中で切断 (${b.cut.start.toFixed(2)}→${b.cut.end.toFixed(2)})`);
  console.log(`     ${b.edge}付近: …${b.tail}…`);
}
for (const s of skipped) console.log(` -  ${s}`);
console.log(`\n検査 ${checked}窓 → 途中切断 ${bad.length}件${bad.length ? '' : '  OK: 語の途中で切れている窓はなし'}`);
process.exit(bad.length ? 1 : 0);
