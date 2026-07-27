/**
 * YouTube チャンネルバナー / X プロフィールヘッダーを作る（2026-07-27）。
 *
 * なぜ必要か:
 *   2026-07-27 の診断で、YouTube から redial.jp へ出られる経路が
 *   **チャンネルのプロフィールのリンク1本しか無い**ことが確定した
 *   （ショートの説明欄URL＝YouTube仕様で踏めない／長尺の説明欄URL＝上級者向け機能が
 *   未解錠で踏めない／関連動画リンク＝同じく未解錠）。
 *   その唯一の着地点にバナー画像が無く（brandingSettings.image が空）、
 *   1,276再生を集めたのにプロフィールが「作りかけのチャンネル」に見えていた。
 *
 * 仕様（YouTube のバナー要件）:
 *   - 画像は 2048x1152（16:9）。素材 radio-booth-night.png は 1920x1080 の同比率なので
 *     切り取らずに拡大するだけで収まる
 *   - **セーフエリア 1235x338（中央）** … スマホを含む全デバイスで必ず見える範囲。
 *     文字はここから絶対に出さない。外に置くとスマホで消える
 *   - 6MB 以下
 *
 * 使い方:
 *   node scripts/make-channel-banner.mjs             # 3案すべて出力
 *   node scripts/make-channel-banner.mjs --variant b # 1案だけ
 *   node scripts/make-channel-banner.mjs --guide     # セーフエリアの枠線入り（確認用・入稿禁止）
 *   node scripts/make-channel-banner.mjs --preset x  # Xヘッダー 1500x500
 *   出力: output/channel/banner-{yt|x}-{a,b,c}.png ＋ 実際に見える範囲の safe-*.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { parseArgs } from './shorts/util.mjs';

const CWD = process.cwd();
const BG = path.resolve(CWD, 'assets', 'shorts', 'backgrounds', 'radio-booth-night.png');
const FONT_SERIF = path.resolve(CWD, 'assets', 'shorts', 'fonts', 'NotoSerifJP-VF.ttf');
const OUT_DIR = path.resolve(CWD, 'output', 'channel');

/**
 * 出力先ごとの寸法。
 *
 * yt = YouTubeチャンネルバナー 2048x1152（16:9）。
 *   セーフエリア 1235x338 = スマホを含む全デバイスで必ず見える中央の帯。
 *   ここを1pxでも出た文字はスマホで切れる。
 *
 * x  = Xのプロフィールヘッダー 1500x500（3:1）。
 *   Xにはセーフエリアの公式定義が無いが、**左下にアイコンの丸が重なる**（実測でおよそ
 *   x 0-290 / y 380-500）ので、そこを避けて中央に置く。端末により左右が切られるため、
 *   重要な文字は必ず中央寄せにする。
 */
const PRESETS = {
  yt: { w: 2048, h: 1152, safeW: 1235, safeH: 338, zoom: 1.22, pan: 0.62 },
  x: { w: 1500, h: 500, safeW: 900, safeH: 300, zoom: 1.0, pan: 0.58 },
};

/* ------- 引数と寸法（下の定数・関数がこれに依存するので先に解決する） ------- */
const args = parseArgs(process.argv.slice(2));
const presetName = (typeof args.preset === 'string' ? args.preset : 'yt').toLowerCase();
if (!PRESETS[presetName]) {
  console.error(`--preset は ${Object.keys(PRESETS).join(' / ')} のいずれかです。`);
  process.exit(1);
}
const P = PRESETS[presetName];
const W = P.w;
const H = P.h;
const SAFE_W = P.safeW;
const SAFE_H = P.safeH;
const SAFE_X = Math.round((W - SAFE_W) / 2);
const SAFE_Y = Math.round((H - SAFE_H) / 2);
// 文字サイズは 2048幅（yt）を基準に決めてあるので、出力幅の比で縮める。
const FS = W / 2048;

// Noto JP の実測字送り（scripts/shorts/check-overflow.mjs と同じ値）。
const EM_RATIO = 0.689;

/**
 * 3案。文言の役割を変えてある:
 *   a=情緒だけ（説明欄がすでに導線を書いているので重複を避ける）
 *   b=導線を前に出す（いま出口が1本しかないので、くどくても機能を優先）
 *   c=両立（情緒→正体→導線の3段）
 */
const VARIANTS = {
  a: [
    { text: 'あなたの季節に、もう一度。', size: 92, color: '0xF2EFE9', alpha: 1.0 },
    { text: '1985 — 2000　深夜ラジオの走馬灯', size: 44, color: '0xB0D9E8', alpha: 0.92 },
  ],
  b: [
    { text: 'あなたの季節に、もう一度。', size: 92, color: '0xF2EFE9', alpha: 1.0 },
    { text: '▼ 音楽つきのフル版は、下のリンクから（無料）', size: 42, color: '0xB0D9E8', alpha: 0.92 },
  ],
  c: [
    { text: 'あなたの季節に、もう一度。', size: 84, color: '0xF2EFE9', alpha: 1.0 },
    { text: '1985 — 2000　深夜ラジオの走馬灯', size: 40, color: '0xD8ECF5', alpha: 0.88 },
    { text: '▼ フル版（無料）は下のリンクから', size: 38, color: '0xB0D9E8', alpha: 0.92 },
  ],
};

const GAP = Math.round(26 * FS); // 行間（行の下端から次の行の上端まで・出力幅に比例）

/** ffmpeg のフィルタ引数に渡すパス（ドライブレターのコロンを逃がす）。 */
function ffPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

/** 全角=1・半角=0.5 で数えた「全角換算の字数」。行幅の見積りに使う。 */
function emWidth(s) {
  let n = 0;
  for (const ch of s) n += /[\x20-\x7E]/.test(ch) ? 0.5 : 1;
  return n;
}

/** 文字を焼かない土台（拡大＋文字を読ませるための暗幕）を作る。 */
async function buildBase(guide, zoom, pan) {
  // セーフエリアの帯にだけ暗幕をかける。全面に敷くと写真の夜景が死ぬので、
  // 上下は透明→中央へ向かって濃くなるグラデーションにして継ぎ目を消す。
  const scrimTop = SAFE_Y - 90;
  const scrimBottom = SAFE_Y + SAFE_H + 90;
  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="${scrimTop}" x2="0" y2="${scrimBottom}" gradientUnits="userSpaceOnUse">
      <stop offset="0"    stop-color="#05070C" stop-opacity="0"/>
      <stop offset="0.28" stop-color="#05070C" stop-opacity="0.72"/>
      <stop offset="0.72" stop-color="#05070C" stop-opacity="0.72"/>
      <stop offset="1"    stop-color="#05070C" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${scrimTop}" width="${W}" height="${scrimBottom - scrimTop}" fill="url(#scrim)"/>
  ${guide ? `<rect x="${SAFE_X}" y="${SAFE_Y}" width="${SAFE_W}" height="${SAFE_H}" fill="none" stroke="#FF3B30" stroke-width="3" stroke-dasharray="14 10"/>` : ''}
</svg>`;

  // 素材の比率を保ったまま出力を覆い、はみ出した分を切る（cover）。
  // ⚠️ fit:'fill' で W×H に潰してはいけない。yt(16:9)は素材と同比率なので偶然
  //    問題にならなかったが、x(3:1)では写真が縦に圧縮されて別物になる。
  // そのうえで縦の位置を pan で選ぶ: 全デバイスで見えるのは中央の帯だけなので、
  // そこに「意味のある画」（卓のVUメーターとヘッドホン）が来るようにする。
  // 等倍だと帯にマイクが胴体の途中で切れて写り、正体不明の暗い柱に見える。
  const meta = await sharp(BG).metadata();
  const srcAR = meta.width / meta.height;
  let zw;
  let zh;
  if (W / H >= srcAR) {
    zw = Math.round(W * zoom); // 出力のほうが横長 → 幅を合わせ、縦を切る
    zh = Math.round(zw / srcAR);
  } else {
    zh = Math.round(H * zoom); // 出力のほうが縦長 → 高さを合わせ、横を切る
    zw = Math.round(zh * srcAR);
  }
  const maxTop = zh - H;
  const top = Math.max(0, Math.min(maxTop, Math.round(maxTop * pan)));
  const left = Math.round((zw - W) / 2);

  return sharp(BG)
    .resize(zw, zh, { fit: 'fill' })
    .extract({ left, top, width: W, height: H })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/** ffmpeg drawtext で文字を焼く。テキストはファイル渡し（日本語のエスケープ地獄を避ける）。 */
function drawText(inPath, outPath, lines) {
  const total = lines.reduce((s, l) => s + l.size, 0) + GAP * (lines.length - 1);
  let y = SAFE_Y + Math.round((SAFE_H - total) / 2);

  const filters = [];
  const tmpFiles = [];
  lines.forEach((line, i) => {
    const tmp = path.join(OUT_DIR, `.txt-${i}.txt`);
    fs.writeFileSync(tmp, line.text, 'utf8'); // BOM無しUTF-8
    tmpFiles.push(tmp);
    filters.push(
      [
        `drawtext=fontfile='${ffPath(FONT_SERIF)}'`,
        `textfile='${ffPath(tmp)}'`,
        `fontsize=${line.size}`,
        `fontcolor=${line.color}@${line.alpha}`,
        `x=(w-text_w)/2`, // セーフエリアは画面中央なので、画面中央揃え＝セーフエリア中央揃え
        `y=${y}`,
        // オプション名は shadowcolor（shadow_color はこのffmpegビルドに無い）。
        // 夜景のボケの上でも文字が沈まないよう、暗幕＋落ち影の二段で持たせる。
        `shadowcolor=0x000000@0.55`,
        `shadowx=0`,
        `shadowy=3`,
      ].join(':'),
    );
    y += line.size + GAP;
  });

  // -update 1 が無いと image2 マルチプレクサが「連番パターンが無い」と文句を言う。
  try {
    execFileSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-i', inPath, '-vf', filters.join(','), '-frames:v', '1', '-update', '1', outPath],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
    );
  } catch (e) {
    // stdio:'inherit' だとWindowsで ffmpeg の失敗理由が消える。必ず stderr を出す。
    console.error(`ffmpeg 失敗 (exit ${e.status}):\n${e.stderr || '(stderr なし)'}`);
    throw e;
  } finally {
    for (const f of tmpFiles) fs.rmSync(f, { force: true });
  }
}

/** セーフエリアから文字がはみ出していないかを、焼く前に数値で止める。 */
function checkFit(name, lines) {
  const problems = [];
  const total = lines.reduce((s, l) => s + l.size, 0) + GAP * (lines.length - 1);
  if (total > SAFE_H) problems.push(`縦 ${total}px > セーフエリア ${SAFE_H}px`);
  for (const l of lines) {
    const w = Math.round(emWidth(l.text) * l.size * EM_RATIO);
    if (w > SAFE_W) problems.push(`「${l.text}」の横 ${w}px > ${SAFE_W}px`);
  }
  if (problems.length) {
    console.error(`✗ ${name}: セーフエリアからはみ出します\n   - ${problems.join('\n   - ')}`);
    return false;
  }
  console.log(`✓ ${name}: 縦 ${total}/${SAFE_H}px・全行がセーフエリア内`);
  return true;
}

/* ---------------- main ---------------- */
const guide = Boolean(args.guide);
const only = typeof args.variant === 'string' ? args.variant.toLowerCase() : null;
// 拡大率と縦の振り位置（0=上端寄せ / 0.5=中央 / 1=下端寄せ）。既定はプリセット持ち。
// yt の既定 zoom=1.22 / pan=0.62 は目視で選んだ実測値: 等倍だとマイクが胴体の途中で
// 切れて「正体不明の暗い柱」になり、pan=0.34 でもまだ頭が残る。0.62 まで下げると
// マイクが帯から完全に抜け、卓のVUメーターとヘッドホンが入って
// 「深夜のラジオブース」が一目で伝わる＋文字の背景が暗くなって可読性も上がる。
const zoom = Number(args.zoom ?? P.zoom);
const pan = Number(args.pan ?? P.pan);
const tag = typeof args.tag === 'string' ? `-${args.tag}` : '';
if (!Number.isFinite(zoom) || zoom < 1 || !Number.isFinite(pan) || pan < 0 || pan > 1) {
  console.error('--zoom は1以上、--pan は0〜1で指定してください。');
  process.exit(1);
}

if (!fs.existsSync(BG)) {
  console.error(`背景が見つかりません: ${BG}`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const base = await buildBase(guide, zoom, pan);
const basePath = path.join(OUT_DIR, '.base.png');
fs.writeFileSync(basePath, base);

let ok = true;
for (const [name, rawLines] of Object.entries(VARIANTS)) {
  if (only && name !== only) continue;
  // 文字サイズは yt(2048幅) 基準の値なので、出力幅の比で縮める。
  const lines = rawLines.map((l) => ({ ...l, size: Math.round(l.size * FS) }));
  if (!checkFit(name, lines)) {
    ok = false;
    continue;
  }
  const out = path.join(OUT_DIR, `banner-${presetName}-${name}${tag}${guide ? "-guide" : ""}.png`);
  drawText(basePath, out, lines);
  const { size } = fs.statSync(out);
  const meta = await sharp(out).metadata();
  console.log(`  → ${path.relative(CWD, out)}  ${meta.width}x${meta.height}  ${(size / 1024 / 1024).toFixed(2)}MB`);
  if (size > 6 * 1024 * 1024) console.warn('  ⚠ 6MBを超えています（YouTubeの上限）');
  // 実際に全デバイスで見える範囲だけを切り出しておく（目視レビュー用）。
  await sharp(out)
    .extract({ left: SAFE_X, top: SAFE_Y, width: SAFE_W, height: SAFE_H })
    .toFile(path.join(OUT_DIR, `safe-${presetName}-${name}${tag}.png`));
}
fs.rmSync(basePath, { force: true });
if (guide) console.log('\n⚠ --guide の出力は赤枠入りです。確認用なので入稿しないこと。');
process.exitCode = ok ? 0 : 1;
