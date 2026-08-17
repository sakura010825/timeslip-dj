/**
 * 絵葉書PNG生成（YouTubeコミュニティ投稿用）— 2026-08-17
 *
 * なぜ要るか（公式ヘルプで裏取り・2026-08-17）:
 *   コミュニティ投稿は登録者のホーム／登録チャンネルフィードに出るが、
 *   **画像投稿だけは「ショートフィードにも表示されることがある」**＝登録者11人でも
 *   未登録者に届き得る唯一の投稿形式。加えて Studio の登録元レポートに「投稿」の行があり、
 *   投稿から直接チャンネル登録が起きる。テキスト投稿ではこの2つの経路が両方使えない。
 *
 * 何を作るか:
 *   当夜のショートと同じ背景画像に、葉書の「見える2行」＋名乗りを焼いた 1080×1080 PNG。
 *   ショート本体と同じ書体・同じ色・同じ暗転なので、フィードで並んでも同じ番組に見える。
 *
 * 使い方:
 *   node scripts/make-postcard.mjs --id 35 --line1 "…" --line2 "——毎晩22時の深夜ラジオ・シンヤ"
 *   node scripts/make-postcard.mjs --id 35 --textfile path/to/postcard.txt   # 1行目/2行目を改行区切りで
 *   （--bg / --year / --season で manifest を使わずに単体でも作れる）
 *
 * 出力: output/shorts/postcards/{cell}-{hook}.png
 *
 * 設計上の注意:
 *   - 画像内の文字は歌詞を引用しない・センシティブ題材を出さない（ショート本体と同じ禁則）
 *   - 1行目は「記憶の断片＋空欄（___）」＝固有名詞1語で埋められる形（ランブック C）
 *   - 折り返しは全角17字（1080 − 左右マージン90×2 = 900px ÷ fs52 ≒ 17字）で、
 *     読点優先・行頭禁則あり。ショート字幕（subtitles.mjs の wrapJa）と同じ考え方の簡易版
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs, FONTS_DIR, BG_DIR, OUT_ROOT } from './shorts/util.mjs';

const args = parseArgs(process.argv.slice(2));
const SIZE = 1080;
const MAX_CHARS = 17; // fs52 × 900px 使用幅

const OUT_DIR = path.resolve(OUT_ROOT, 'postcards');

/** ffmpegのfilter引数用にパスをエスケープ（Windowsのドライブ':'と'\'を無害化） */
const ffPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');

/** 表示幅（全角=1・半角=0.5） */
const dispLen = (s) =>
  Array.from(s ?? '').reduce((n, ch) => n + (/[\x00-\xFF｡-ﾟ]/.test(ch) ? 0.5 : 1), 0);

/** 行頭に来てはいけない約物（前行に残す） */
const CLOSER = /^[、。，．！？!?」』）\]｝・ー…ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]$/;

/** 全角は1字＝1トークン、半角の連続（1990 / redial.jp 等）は割らない */
function tokenize(s) {
  const toks = [];
  let buf = '';
  for (const ch of Array.from(s ?? '')) {
    if (/[0-9A-Za-z.]/.test(ch)) {
      buf += ch;
      continue;
    }
    if (buf) {
      toks.push(buf);
      buf = '';
    }
    toks.push(ch);
  }
  if (buf) toks.push(buf);
  return toks;
}

/** トークン列を幅 max で貪欲に折る（行頭禁則つき） */
function greedy(toks, max) {
  const lines = [];
  let cur = '';
  for (const tok of toks) {
    if (cur && dispLen(cur) + dispLen(tok) > max && !CLOSER.test(tok)) {
      lines.push(cur);
      cur = '';
    }
    cur += tok;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * 折り返し。**読点・句点の句切りを行末にする**のが要点で、文字数だけで折ると
 * 「ラジオ／からは毎日」のように語の途中で切れて素人臭くなる（2026-08-17 実測）。
 *
 * 1. 読点・句点の直後で文節に割る（閉じ括弧が続くときは割らない＝行頭に「」」だけ残さない）
 * 2. 文節を幅 max に詰め込む
 * 3. 単独で max を超える文節だけ、文字単位の貪欲折り（落ち穂が出たら行長を揃え直す）
 */
function phrases(t) {
  return t
    .split(/(?<=[、。])(?![」』）\]｝、。・])/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function wrap(s, max = MAX_CHARS) {
  const t = (s ?? '').trim();
  if (!t || dispLen(t) <= max) return [t];

  const lines = [];
  let cur = '';
  for (const ph of phrases(t)) {
    if (dispLen(ph) > max) {
      // 文節そのものが長い: いったん今の行を出し、文字単位で折る（落ち穂は幅調整で吸収）
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      const toks = tokenize(ph);
      let sub = greedy(toks, max);
      const n = sub.length;
      if (n >= 2 && dispLen(sub[n - 1]) < max * 0.5) {
        const balanced = greedy(toks, Math.ceil(dispLen(ph) / n));
        if (balanced.length === n) sub = balanced;
      }
      lines.push(...sub);
      continue;
    }
    if (cur && dispLen(cur) + dispLen(ph) > max) {
      lines.push(cur);
      cur = '';
    }
    cur += ph;
  }
  if (cur) lines.push(cur);
  return lines;
}

const assEscape = (s) => String(s ?? '').replace(/\\/g, '＼').replace(/[{}]/g, '');

function buildAss({ badge, bodyLines, byline }) {
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${SIZE}`,
    `PlayResY: ${SIZE}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // 本文（中央・下寄り）
    'Style: Body,Noto Serif JP,52,&H00F0F0F0,&H00F0F0F0,&H96000000,&H00000000,0,0,0,0,100,100,1,0,1,2.6,0,5,90,90,0,1',
    // 年バッジ（左上）
    'Style: Badge,Noto Serif JP,34,&H00C8C8C8,&H00C8C8C8,&H96000000,&H00000000,0,0,0,0,100,100,2,0,1,2.0,0,7,70,70,64,1',
    // 名乗り（下端から一定の位置＝Alignment 2 で安定させる。中央揃え(5)だと本文の行数で動く）
    'Style: Byline,Noto Serif JP,32,&H00B0B0B0,&H00B0B0B0,&H96000000,&H00000000,0,0,0,0,100,100,1,0,1,2.0,0,2,90,90,150,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = [];
  if (badge) ev.push(`Dialogue: 0,0:00:00.00,0:00:05.00,Badge,,0,0,0,,${assEscape(badge)}`);
  const body = bodyLines.map(assEscape).join('\\N');
  // 本文は画面中央（行数が変わっても重心が動かない）。名乗りは下端から150pxに固定。
  ev.push(`Dialogue: 0,0:00:00.00,0:00:05.00,Body,,0,0,0,,${body}`);
  if (byline) {
    ev.push(`Dialogue: 0,0:00:00.00,0:00:05.00,Byline,,0,0,0,,${assEscape(byline)}`);
  }
  return [...head, ...ev].join('\n');
}

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => {
      err += d.toString();
    });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}\n${err.slice(-1200)}`)),
    );
  });
}

// ── 入力の解決（manifest id か、単体指定） ───────────────────────────
let bg = args.bg ? String(args.bg) : null;
let cell = args.cell ? String(args.cell) : null;
let hook = args.hook ? String(args.hook) : 'postcard';

if (args.id != null) {
  const manifestPath = path.resolve(process.cwd(), 'data', 'shorts.manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const s = (m.shorts ?? []).find((x) => String(x.id) === String(args.id));
  if (!s) {
    console.error(`❌ manifest に id=${args.id} がありません`);
    process.exit(1);
  }
  bg = bg ?? s.bg ?? null;
  cell = cell ?? s.cell;
  hook = args.hook ? String(args.hook) : s.hook;
}

const SEASON_JP = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const [yearFromCell, seasonFromCell] = String(cell ?? '').split('-');
const year = args.year ? String(args.year) : yearFromCell;
const season = args.season ? String(args.season) : seasonFromCell;
const badge = year ? `${year}年・${SEASON_JP[season] ?? ''}`.replace(/・$/, '') : null;

let line1 = args.line1 ? String(args.line1) : null;
let line2 = args.line2 ? String(args.line2) : '——毎晩22時の深夜ラジオ・シンヤ';
if (args.textfile) {
  const raw = fs.readFileSync(path.resolve(String(args.textfile)), 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  line1 = lines[0] ?? line1;
  if (lines[1]) line2 = lines[1];
}
if (!line1) {
  console.error('❌ --line1 か --textfile で葉書の1行目（記憶の断片＋空欄）を渡してください');
  process.exit(1);
}

const bodyLines = wrap(line1);
const ass = buildAss({ badge, bodyLines, byline: line2 });

fs.mkdirSync(OUT_DIR, { recursive: true });
const assPath = path.resolve(OUT_DIR, `.${cell ?? 'postcard'}-${hook}.ass`);
fs.writeFileSync(assPath, ass, 'utf8');

const outPng = path.resolve(OUT_DIR, `${cell ?? 'postcard'}-${hook}.png`);
const bgPath = bg ? path.resolve(BG_DIR, bg) : null;

const assArg = `subtitles=filename='${ffPath(assPath)}':fontsdir='${ffPath(FONTS_DIR)}'`;
// 背景は中央を正方形に切り出し、ショート本体と同じ暗転＋ビネットを掛けてから文字を焼く。
const chain = `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=increase,crop=${SIZE}:${SIZE},eq=brightness=-0.10:contrast=1.02:saturation=0.98,vignette=PI/6,${assArg}`;

const ffArgs =
  bgPath && fs.existsSync(bgPath)
    ? ['-y', '-loglevel', 'error', '-i', bgPath, '-vf', chain, '-frames:v', '1', outPng]
    : [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=c=0x141414:s=${SIZE}x${SIZE}`,
        '-vf',
        `vignette=PI/6,${assArg}`,
        '-frames:v',
        '1',
        outPng,
      ];

if (bg && !(bgPath && fs.existsSync(bgPath))) {
  console.warn(`   ⚠ 背景画像が見つからないため無地で作ります: ${bgPath}`);
}

await run('ffmpeg', ffArgs);
try {
  fs.unlinkSync(assPath);
} catch {
  /* 消せなくても支障なし */
}
console.log(`✓ ${outPng}`);
console.log(`   ${badge ?? '(バッジなし)'}`);
for (const l of bodyLines) console.log(`   ${l}`);
console.log(`   ${line2}`);
