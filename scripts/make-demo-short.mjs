/**
 * 型D「体験デモショート」生成（2026-08-12・チャンネル活性化スプリントC）。
 *
 * 「Shortsを見た人がReDialの中身（トーク→本物の曲が流れる構造）を知らないまま帰る」への答え。
 * **サイトの実画面**を見せ、曲が鳴る0.5秒前で切る＝型Bクリフハンガー原理の製品デモ適用。
 * 曲音声はゼロ（権利安全）。台本はhide承認済み（8/12）。
 *
 * 素材:
 *   output/demo-short/ui.png = redial.jp/episodes/1990-winter のモバイル実画面。
 *   撮影コマンド（再現用）:
 *     chrome --headless=new --force-device-scale-factor=3 --window-size=560,1500
 *            --hide-scrollbars --screenshot=ui.png https://redial.jp/episodes/1990-winter
 *
 * 作り（make-trailer.mjs と同じ思想）:
 *   - 行ごとTTS→実尺測定→**字幕は台本テキストを実測タイミングで焼く**（Whisper字幕不使用）
 *   - 画面は実UIの切り出しを1080x1920の暗幕に載せ、zoompanでゆっくり寄る
 *   - 締めカード「この先は、本物が流れます。」＋redial.jp——毎晩22時
 *
 * usage:
 *   node --env-file=.env.local scripts/make-demo-short.mjs           # 生成
 *   node --env-file=.env.local scripts/make-demo-short.mjs --no-tts  # 既存mp3で再合成
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { ensureDir, assTime, FONTS_DIR } from './shorts/util.mjs';

const OUT = path.resolve('output', 'demo-short');
const UI = path.resolve(OUT, 'ui.png');
const FPS = 30;
const W = 1080;
const H = 1920;
const ENDCARD_SEC = 5.0;
const CUT_GAP = 0.5; // 「鳴る直前」の無音＝切りの間

/** 台本（tts=読み / show=字幕 / crop=ui.png の切り出し[y,h] / gap=行後の間） */
const LINES = [
  { tts: 'リダイヤルの夜は、こうなっています。', show: 'redial.jp の夜は、\\Nこうなっています。', crop: [180, 1930], gap: 0.5 },
  { tts: '私が、当時の話をして、', show: '私が、当時の話をして——', crop: [960, 1640], gap: 0.4 },
  { tts: 'その続きに、当時の曲が、そのまま流れます。', show: 'その続きに、当時の曲が、\\Nそのまま流れます。', crop: [1450, 950], gap: 0.6 },
  { tts: 'たとえば、1990年の冬なら、愛は勝つの、鳴る直前まで。', show: 'たとえば、1990年の冬なら——\\N愛は勝つの、鳴る直前まで。', crop: [1545, 260], gap: CUT_GAP },
];

const NO_TTS = process.argv.includes('--no-tts');

async function ttsLine(text, outPath) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.TTS_MODEL, voice: process.env.TTS_VOICE,
      instructions: process.env.TTS_INSTRUCTIONS, input: text, response_format: 'mp3',
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

function probeDur(p) {
  const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe失敗: ${p}`);
  return d;
}

/** ui.png の帯 [y,h] を暗幕1080x1920の中央に置いたフレームを作る */
async function composeFrame(crop, outPath, { cardW = 960 } = {}) {
  const meta = await sharp(UI).metadata();
  const band = await sharp(UI)
    .extract({ left: 0, top: crop[0], width: meta.width, height: crop[1] })
    .resize({ width: cardW })
    .png().toBuffer();
  const bandMeta = await sharp(band).metadata();
  // 枠線（サイトの直線的な美学に合わせて角丸なし・1pxの淡い線）
  const bordered = await sharp({
    create: { width: bandMeta.width + 2, height: bandMeta.height + 2, channels: 4, background: { r: 58, g: 58, b: 66, alpha: 1 } },
  }).composite([{ input: band, left: 1, top: 1 }]).png().toBuffer();
  const bm = await sharp(bordered).metadata();
  // 置き位置: 上120(バッジ帯)〜下420(字幕・波形帯)を避けた領域の中央
  const areaTop = 130, areaBottom = H - 430;
  const top = Math.max(areaTop, Math.round(areaTop + (areaBottom - areaTop - bm.height) / 2));
  const left = Math.round((W - bm.width) / 2);
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 10, g: 10, b: 14, alpha: 1 } } })
    .composite([{ input: bordered, left, top: Math.min(top, areaBottom - bm.height < areaTop ? areaTop : areaBottom - bm.height) }])
    .png().toFile(outPath);
}

function buildAss({ assPath, subs, total, talkTotal }) {
  const styles = [
    'Style: Badge,Noto Serif JP,34,&H00B0D9E8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,2,0,1,2,1,7,44,44,40,1',
    'Style: Line,Noto Serif JP,58,&H00F0F0F0,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,1,0,1,3,2,2,70,70,330,1',
    'Style: Card,Noto Serif JP,72,&H00E6F3F8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,1,0,1,3,2,5,70,70,0,1',
  ];
  const events = [
    `Dialogue: 0,${assTime(0)},${assTime(talkTotal)},Badge,,0,0,0,,ReDial\\N{\\fs22\\c&H00909090&}あの季節の深夜ラジオ`,
  ];
  for (const s of subs) {
    events.push(`Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Line,,0,0,0,,{\\fad(160,200)}${s.show}`);
  }
  const endStart = total - ENDCARD_SEC;
  events.push(
    `Dialogue: 0,${assTime(endStart)},${assTime(total)},Card,,0,0,0,,{\\fad(400,300)}この先は、\\N本物が流れます。\\N\\N{\\fs46\\c&H00B0D9E8&}redial.jp\\N{\\fs34\\c&H00A0A0A0&}毎晩22時、あの季節の深夜ラジオ`,
  );
  fs.writeFileSync(assPath, [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`,
    'WrapStyle: 0', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: TV.709', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles, '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events, '',
  ].join('\n'), 'utf8');
}

function ffPath(p) { return p.replace(/\\/g, '/').replace(/:/g, '\\:'); }

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d; if (err.length > 8000) err = err.slice(-4000); });
    ff.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}\n${err.slice(-1500)}`))));
  });
}

async function main() {
  ensureDir(OUT);
  if (!fs.existsSync(UI)) throw new Error('ui.png がありません（ヘッダの撮影コマンド参照）');

  // 1) TTS
  const mp3s = LINES.map((_, i) => path.resolve(OUT, `line${i + 1}.mp3`));
  if (!NO_TTS) {
    for (let i = 0; i < LINES.length; i++) {
      process.stdout.write(`TTS ${i + 1}/${LINES.length}\r`);
      await ttsLine(LINES[i].tts, mp3s[i]);
    }
    console.log('TTS 完了            ');
  }

  // 2) 実尺→タイムライン
  let t = 0;
  const segs = [];
  const subs = [];
  for (let i = 0; i < LINES.length; i++) {
    const dur = probeDur(mp3s[i]);
    const segDur = dur + LINES[i].gap;
    segs.push({ mp3: mp3s[i], dur, gap: LINES[i].gap, segDur, start: t });
    subs.push({ start: t, end: t + dur + Math.min(LINES[i].gap, 0.45), show: LINES[i].show });
    t += segDur;
  }
  const talkTotal = +t.toFixed(3);
  const total = +(talkTotal + ENDCARD_SEC).toFixed(3);
  console.log(`ナレーション ${talkTotal.toFixed(1)}s ＋ 締めカード ${ENDCARD_SEC}s ＝ ${total.toFixed(1)}s`);
  for (const s of subs) console.log(`  ${assTime(s.start)}–${assTime(s.end)}  ${s.show.replace(/\\N/g, ' / ')}`);

  // 3) フレーム合成（行ごと）＋締めカード（暗幕のみ・文字はASS）
  const frames = [];
  for (let i = 0; i < LINES.length; i++) {
    const f = path.resolve(OUT, `frame${i + 1}.png`);
    await composeFrame(LINES[i].crop, f, { cardW: i === 3 ? 1020 : 960 });
    frames.push(f);
  }
  const endFrame = path.resolve(OUT, 'frame-end.png');
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 10, g: 10, b: 14, alpha: 1 } } }).png().toFile(endFrame);

  // 4) ASS
  const assPath = path.resolve(OUT, '.demo.ass');
  buildAss({ assPath, subs, total, talkTotal });

  // 5) ffmpeg 合成
  const inputs = [];
  const vchains = [];
  const alabels = [];
  const durList = [...segs.map((s) => s.segDur), ENDCARD_SEC];
  const frameList = [...frames, endFrame];
  for (let i = 0; i < frameList.length; i++) {
    const n = Math.max(1, Math.round(durList[i] * FPS));
    // ⚠️ zoompan の d は「入力1フレームから作る出力フレーム数」。入力を -loop で
    //    複数フレーム化すると1枚ごとにd回複製されて映像だけ引き延ばされる
    //    （2026-08-12 初回レンダで実際に発生）。静止画は素の1フレームで渡す。
    if (i < segs.length) {
      inputs.push('-i', frameList[i]);
      vchains.push(`[${i}:v]scale=${Math.round(W * 1.1)}:${Math.round(H * 1.1)},zoompan=z='1+0.0004*on':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${n}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`);
    } else {
      inputs.push('-loop', '1', '-t', String(durList[i]), '-i', frameList[i]);
      vchains.push(`[${i}:v]scale=${W}:${H},fps=${FPS},setsar=1,format=yuv420p[v${i}]`);
    }
  }
  for (let i = 0; i < segs.length; i++) {
    const idx = frameList.length + i;
    inputs.push('-i', segs[i].mp3);
    alabels.push({ idx, dur: segs[i].dur, gap: segs[i].gap });
  }
  const achains = [];
  const aconcat = [];
  alabels.forEach((a, i) => {
    achains.push(`[${a.idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${a.dur},asetpts=N/SR/TB[a${i}]`);
    aconcat.push(`[a${i}]`);
    if (a.gap > 0) {
      achains.push(`anullsrc=r=44100:cl=stereo,atrim=0:${a.gap}[g${i}]`);
      aconcat.push(`[g${i}]`);
    }
  });
  const filter = [
    ...vchains,
    `${frameList.map((_, i) => `[v${i}]`).join('')}concat=n=${frameList.length}:v=1:a=0[vcat]`,
    ...achains,
    `${aconcat.join('')}concat=n=${aconcat.length}:v=0:a=1[araw]`,
    `[araw]asplit=2[awav][amain]`,
    // ⚠️ draw=full 必須（feedback_ffmpeg_showwaves_and_labels）
    `[awav]showwaves=s=${W}x110:mode=cline:rate=${FPS}:colors=0xB0D9E8:draw=full[wav]`,
    `[vcat][wav]overlay=x=0:y=${H - 150}:shortest=0[vw]`,
    `[vw]subtitles=filename='${ffPath(assPath)}':fontsdir='${ffPath(FONTS_DIR)}'[vid]`,
    `[amain]afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, talkTotal - 0.9)}:d=0.9,apad[aud]`,
  ].join(';');

  const outMp4 = path.resolve(OUT, 'demo-1990-winter-aiwakatsu.mp4');
  await runFfmpeg([
    '-y', ...inputs,
    '-filter_complex', filter,
    '-map', '[vid]', '-map', '[aud]',
    '-t', String(total), '-r', String(FPS),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-crf', '21', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
    outMp4,
  ]);
  console.log(`✓ ${path.relative(process.cwd(), outMp4)} (${(fs.statSync(outMp4).size / 1024 / 1024).toFixed(1)}MB / ${total.toFixed(1)}s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
