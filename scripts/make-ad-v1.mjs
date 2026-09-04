/**
 * Meta広告 V1（系統1・9:16・約45秒）の映像を組む（2026-09-04）。
 *
 * 設計の正 = redial/docs/AD_FUNNEL_DESIGN_2026-09.md §3・絵コンテ = AD_CREATIVE_DRAFTS_2026-09.md §1。
 * 音声（シンヤ3カット）は 9/2 に新規TTS済みで Blob にある（ad2-v1-01..03.mp3）。ここは映像だけ。
 *
 * 作りの原則（make-trailer.mjs と同じ）:
 *   - **字幕は台本テキストから焼く**。Whisper転写を使わない＝固有名詞が壊れる事故が構造的に起きない
 *   - 表示と発話を分ける（声は「キンキキッズ」・画面は「KinKi Kids」＝検索される表記）
 *   - 字幕の割りは**音声の無音を実測**して合わせる（silencedetect・下の CUES のコメントに実測値）
 *   - サイトの画は**本番の実物**をヘッドレスChromeで実機幅（375 CSS px・2x）で撮ったもの。
 *     モックを描かない（広告と着地が食い違うと、それ自体が45〜60歳の警戒に触れる）
 *
 * セーフゾーン: 上250px / 下200px を空ける（リール面のUI被り）。
 * 文字は通常の1.5〜2倍（シニア向け動画の定石・2026-09-01 リサーチ）＝ Sub fs56 → 76。
 *
 * usage:
 *   node scripts/make-ad-v1.mjs --assets <dir>   # dir に ad2-v1-0*.mp3 と site375.png
 *   node scripts/make-ad-v1.mjs --assets <dir> --no-render   # ASSと素材だけ作る
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assTime, FONTS_DIR } from './shorts/util.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const ASSETS = path.resolve(arg('assets', path.join('output', 'ad-v1')));
const OUT_DIR = path.resolve('output', 'ad-v1');
const NO_RENDER = process.argv.includes('--no-render');
const W = 1080, H = 1920, FPS = 30;
const BG = '0x0B0B0D';

const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
const ffPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');

/** 場面（秒）。合計 45.2s。音声は line1=7.0 / line2=18.2 / line3=34.8 から鳴る。 */
const SCENES = [
  { key: 'black1', dur: 7.0 },    // 0.0–7.0    黒地の掴み（冒頭3秒で決まる＝リサーチ）
  { key: 'room', dur: 11.2 },     // 7.0–18.2   夜の部屋・カセット（シンヤ①）
  { key: 'siteFv', dur: 7.7 },    // 18.2–25.9  着地のFV（1行定義＋▶＋安心行）
  { key: 'siteTrack', dur: 8.9 }, // 25.9–34.8  曲目（『硝子の少年』が見える）
  { key: 'black2', dur: 10.4 },   // 34.8–45.2  シンヤ③ → エンドカード
];

/**
 * 字幕。t0/t1 は動画全体での秒。
 * 実測した無音（silencedetect noise=-30dB:d=0.25）:
 *   ①10.56s … 0.76-1.17 / 1.80-2.29 / 2.73-3.11 / 5.03-5.40 / 6.96-7.49 / 8.93-9.33
 *   ②16.01s … 0.62-1.19 / 3.42-4.26 / 6.70-7.70 / 9.01-9.66 / 11.08-11.96 / 13.21-13.74 / 15.60-
 *   ③ 4.46s … 1.34-1.79 / 3.34-
 */
const CUES = [
  // 掴み（無音の上に置く。ミュート自動再生でも意味が通る＝Metaの既定）
  { t0: 0.3, t1: 3.0, style: 'HookBig', text: '1997年の夏へ。' },
  { t0: 3.2, t1: 6.9, style: 'Hook', text: 'タイムスリップできる\\N深夜ラジオがあります' },
  // シンヤ①（7.0〜17.56）
  { t0: 7.0, t1: 9.29, style: 'Sub', text: 'こんばんは。シンヤです。' },
  { t0: 9.29, t1: 17.56, style: 'Sub', text: 'ここは、1985年から2000年までの季節を、\\Nひと晩ずつ流している深夜ラジオです。' },
  // シンヤ②（18.2〜34.21）
  { t0: 18.2, t1: 22.46, style: 'Sub', text: '今夜は、1997年の夏。' },
  { t0: 22.46, t1: 25.9, style: 'Sub', text: 'KinKi Kidsがデビューした夏です。' },
  { t0: 25.9, t1: 30.16, style: 'Sub', text: '詞は松本隆、曲は山下達郎。' },
  { t0: 30.16, t1: 34.21, style: 'Sub', text: 'この話の続きに、\\Nあの曲がそのまま流れます。' },
  // シンヤ③（34.8〜38.14）
  { t0: 34.8, t1: 36.59, style: 'Hook', text: '無料で聴けます。' },
  { t0: 36.59, t1: 38.4, style: 'Hook', text: '登録も要りません。' },
  // エンドカード（38.6〜45.2）
  // ⚠️ Alignment 5（中央）だと MarginV がほとんど効かず3行が団子になる（2026-09-04 フレーム実測）。
  //    エンドカードは \pos で明示的に置く。
  { t0: 38.7, t1: 45.2, style: 'EndTitle', pos: [540, 800], text: 'タイムスリップラジオ\\NReDial' },
  { t0: 39.3, t1: 45.2, style: 'EndSub', pos: [540, 1090], text: '無料で聴けます・登録は要りません' },
  { t0: 39.9, t1: 45.2, style: 'EndUrl', pos: [540, 1270], text: 'redial.jp' },
];

const ASS_HEAD = [
  '[Script Info]',
  'ScriptType: v4.00+',
  `PlayResX: ${W}`,
  `PlayResY: ${H}`,
  'WrapStyle: 2',
  'ScaledBorderAndShadow: yes',
  '',
  '[V4+ Styles]',
  'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
  // 本文（下寄せ・セーフゾーン内）。fs76 = ショートの56の約1.4倍
  'Style: Sub,Noto Sans JP,76,&H00FFFFFF,&H000000FF,&H00101010,&H90000000,1,0,0,0,100,100,0,0,1,4.5,2,2,80,80,240,1',
  // 掴み・締め（画面中央・特大）
  // 全角1字 ≒ 0.689×Fontsize（このリポジトリの実測値・check-overflow.mjs と同じ）。
  // 使用幅 960px に**いちばん長い行**を収める: 10字なら fs139 が上限、9字なら fs154。
  // ⚠️ 152 にしたら「深夜ラジオがあります」(10字)が左右へ溢れた（2026-09-04 フレーム実測）。
  'Style: Hook,Noto Serif JP,132,&H00FFFFFF,&H000000FF,&H00FFFFFF,&H00000000,1,0,0,0,100,100,2,0,1,1.2,0,5,60,60,0,1',
  // 掴みの1行目だけは短い（「1997年の夏へ。」=7字）ので大きく出す
  'Style: HookBig,Noto Serif JP,176,&H00FFFFFF,&H000000FF,&H00FFFFFF,&H00000000,1,0,0,0,100,100,2,0,1,1.4,0,5,60,60,0,1',
  // エンドカード
  'Style: EndTitle,Noto Serif JP,96,&H00F0F4F8,&H00000000,&H00101010,&H00000000,1,0,0,0,100,100,4,0,1,0,0,5,80,80,300,1',
  'Style: EndSub,Noto Sans JP,58,&H00C8D4DC,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,80,80,-160,1',
  'Style: EndUrl,Noto Sans JP,70,&H0058C8F0,&H00000000,&H00101010,&H00000000,1,0,0,0,100,100,6,0,1,0,0,5,80,80,-420,1',
  '',
  '[Events]',
  'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
];

function buildAss(assPath) {
  const lines = [...ASS_HEAD];
  for (const c of CUES) {
    const prefix = c.pos ? `{\\pos(${c.pos[0]},${c.pos[1]})}` : '';
    lines.push(`Dialogue: 0,${assTime(c.t0)},${assTime(c.t1)},${c.style},,0,0,0,,${prefix}${c.text}`);
  }
  fs.writeFileSync(assPath, lines.join('\n') + '\n', 'utf8');
}

/** サイトの実物スクショから、場面ごとの切り出しを作る（座標はブラウザで実測したCSS px×2）。 */
function makeSiteCrops() {
  const src = path.join(ASSETS, 'site375.png');
  if (!fs.existsSync(src)) throw new Error(`サイトのスクショが無い: ${src}`);
  // FV: CSS y40〜580（ヘッダ＋黒帯の定義文＋▶無料で聴く＋安心行）
  ff(['-i', src, '-vf', 'crop=750:1080:0:80', path.join(OUT_DIR, 'crop-fv.png')]);
  // 曲目: CSS y660〜1200（PREVIEW＋『硝子の少年 / KinKi Kids』が見える）
  ff(['-i', src, '-vf', 'crop=750:1080:0:1320', path.join(OUT_DIR, 'crop-track.png')]);
}

/** 静止画を「画面の中の画面」として置く場面（上300/下520を空ける＝セーフゾーン＋字幕の場所）。 */
function renderSiteScene(cropPng, dur, out) {
  const zoom = `scale=764:1100,pad=772:1108:4:4:0x2A2E33`; // 4pxの薄い縁＝画面らしさ
  ff([
    '-f', 'lavfi', '-i', `color=c=${BG}:s=${W}x${H}:r=${FPS}:d=${dur}`,
    '-loop', '1', '-t', String(dur), '-i', cropPng,
    '-filter_complex', `[1:v]${zoom}[s];[0:v][s]overlay=x=(W-w)/2:y=296:shortest=1,format=yuv420p[v]`,
    '-map', '[v]', '-r', String(FPS), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out,
  ]);
}

function renderStill(png, dur, out, kenburns) {
  // 背景は 9:16 にカバーで敷き、ゆっくり寄る（1.00→1.06）。
  // ⚠️ zoompan の d は「入力1枚あたりに吐く枚数」。`-loop 1` の入力に d=総フレーム数 を渡すと
  //    枚数が二乗に爆発する（2026-09-04 に踏んで11分回した）。**d=1 にして z を累積させる**のが正。
  const frames = Math.round(dur * FPS);
  const step = (0.06 / frames).toFixed(6);
  const vf = kenburns
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
      `zoompan=z='min(zoom+${step},1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},format=yuv420p`
    : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=yuv420p`;
  ff(['-loop', '1', '-t', String(dur), '-i', png, '-vf', vf, '-r', String(FPS), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
}

function renderBlack(dur, out) {
  ff(['-f', 'lavfi', '-i', `color=c=${BG}:s=${W}x${H}:r=${FPS}:d=${dur}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const assPath = path.join(OUT_DIR, '.ad-v1.ass');
  buildAss(assPath);
  makeSiteCrops();
  if (NO_RENDER) { console.log(`ASSと切り出しだけ作りました: ${OUT_DIR}`); return; }

  const room = path.resolve('assets', 'shorts', 'backgrounds', 'cassette-night.png');
  const segs = [];
  for (const s of SCENES) {
    const out = path.join(OUT_DIR, `.seg-${s.key}.mp4`);
    if (s.key === 'room') renderStill(room, s.dur, out, true);
    else if (s.key === 'siteFv') renderSiteScene(path.join(OUT_DIR, 'crop-fv.png'), s.dur, out);
    else if (s.key === 'siteTrack') renderSiteScene(path.join(OUT_DIR, 'crop-track.png'), s.dur, out);
    else renderBlack(s.dur, out);
    segs.push(out);
    console.log(`  場面 ${s.key} ${s.dur}s`);
  }

  const listPath = path.join(OUT_DIR, '.concat.txt');
  fs.writeFileSync(listPath, segs.map((s) => `file '${s.replace(/\\/g, '/')}'`).join('\n') + '\n', 'utf8');
  const base = path.join(OUT_DIR, '.base.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', base]);

  // 音: 無音の土台に3カットを実測位置で載せる
  const a = (n) => path.join(ASSETS, `ad2-v1-0${n}.mp3`);
  const total = SCENES.reduce((n, s) => n + s.dur, 0);
  const out = path.join(OUT_DIR, 'ad-v1-1997summer.mp4');
  ff([
    '-i', base,
    '-i', a(1), '-i', a(2), '-i', a(3),
    '-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex',
    `[1:a]adelay=7000|7000[a1];[2:a]adelay=18200|18200[a2];[3:a]adelay=34800|34800[a3];` +
    `[4:a][a1][a2][a3]amix=inputs=4:duration=first:normalize=0[aout];` +
    `[0:v]subtitles=filename='${ffPath(assPath)}':fontsdir='${ffPath(FONTS_DIR)}'[v]`,
    '-map', '[v]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(total), out,
  ]);
  console.log(`\n✅ ${out}  (${total.toFixed(1)}s)`);
}

main();
