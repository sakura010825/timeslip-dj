/**
 * 字幕・タイトル・エンドカードが画面幅に収まっているかの静的検査。
 *
 * ⚠️ libassは空白の無い日本語を自動折返ししない（WrapStyle:0は空白でしか折らない）ので、
 * 長い行は黙って画面外へ溢れる。レンダ後の目視では見落とすため、ASSを機械的に検査する。
 *
 * 幅の根拠: fs54のタイトルを実測して 1字=37.2px（=0.689em）。PlayResX=1080でASS単位=px。
 *
 * 使い方: node scripts/shorts/check-overflow.mjs [output/shorts]
 */
import fs from 'node:fs';
import path from 'node:path';

const EM_RATIO = 0.689; // Noto JP の実測字送り（フォントサイズに対する全角1字の幅）
const dispLen = (s) => Array.from(s ?? '')
  .reduce((n, ch) => n + (/[\x00-\xFF｡-ﾟ]/.test(ch) ? 0.5 : 1), 0);

// スタイル既定（Fontsize と 左右マージン）＝ subtitles.mjs の styles と対応
const STYLE = {
  Sub: { fs: 56, ml: 72, mr: 72 },
  Badge: { fs: 46, ml: 54, mr: 54 },
  Endcard: { fs: 66, ml: 90, mr: 90 },
};

const dir = process.argv[2] ?? path.join('output', 'shorts');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ass')).sort();

let checked = 0;
const bad = [];

for (const f of files) {
  const txt = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    if (!line.startsWith('Dialogue:')) continue;
    const parts = line.split(',');
    const style = parts[3].trim();
    const st = STYLE[style] ?? STYLE.Sub;
    const usable = 1080 - st.ml - st.mr;
    const text = parts.slice(9).join(',');

    // 表示行は \N で分割。各行のフォントは直前のインライン {\fsNN} が効く（無ければスタイル既定）。
    let curFs = st.fs;
    for (const seg of text.split('\\N')) {
      const m = seg.match(/\\fs(\d+)/);
      if (m) curFs = Number(m[1]);
      const clean = seg.replace(/\{[^}]*\}/g, '');
      if (!clean.trim()) continue;
      checked++;
      const w = dispLen(clean) * curFs * EM_RATIO;
      if (w > usable) bad.push({ f, style, fs: curFs, w: Math.round(w), usable, clean });
    }
  }
}

for (const b of bad) {
  console.log(`NG ${b.f}  [${b.style} fs${b.fs}] ${b.w}px > ${b.usable}px`);
  console.log(`     ${b.clean}`);
}
console.log(`\n検査 ${files.length}本 / ${checked}行 → はみ出し ${bad.length}件${bad.length ? '' : '  OK: すべて画面内'}`);
process.exit(bad.length ? 1 : 0);
