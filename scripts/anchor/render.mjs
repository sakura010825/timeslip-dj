/**
 * 長尺アンカーのffmpeg合成（16:9 / 1920x1080）。
 * 音声 = seg mp3 と カード分の無音 を concat（＝トーク通し版・楽曲0秒）。
 * 映像 = 静止背景（Ken Burnsなし＝長尺では過剰）＋showwaves波形＋ASS額縁。
 * fps は 15（静止画主体・作業用/睡眠用の長尺なのでファイルサイズと encode 時間を優先）。
 * 設計: redial/docs/ANCHOR_VIDEO_DESIGN_2026-07.md §5
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FONTS_DIR, BG_DIR } from '../shorts/util.mjs';

const FPS = 15;
const W = 1920;
const H = 1080;

function ffPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function runFfmpeg(args, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (err.length > 8000) err = err.slice(-4000);
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s);
      if (m && onProgress) onProgress(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${err.slice(-1800)}`));
    });
  });
}

/** 背景の入力とフィルタ鎖を作る（画像があれば使い、無ければ合成グラデにフォールバック） */
function backgroundChain(bg, total) {
  const inputs = [];
  const bgPath = bg ? path.resolve(BG_DIR, bg) : null;

  if (bgPath && fs.existsSync(bgPath)) {
    inputs.push('-loop', '1', '-t', String(total), '-i', bgPath);
    // 長尺は「見続ける」ものではなく「点いている」もの。動きは足さず、暗めに落として文字を主役にする。
    const chain =
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
      `eq=brightness=-0.12:contrast=1.02:saturation=0.95,vignette=PI/5,setsar=1,fps=${FPS},format=yuv420p[bg]`;
    return { inputs, chain };
  }

  if (bg) console.warn(`   ⚠ 背景画像が見つからないためフォールバック背景を使用: ${bgPath}`);
  inputs.push('-f', 'lavfi', '-t', String(total), '-i',
    `gradients=s=${W}x${H}:c0=0x35526f:c1=0x080d16:type=radial:d=${Math.ceil(total)}:speed=0.002:r=${FPS}`);
  return { inputs, chain: `[0:v]vignette=PI/5,setsar=1,format=yuv420p[bg]` };
}

export async function renderAnchor({ items, bg, assPath, outMp4, talkTotal, endcardSec, onProgress }) {
  const total = +(talkTotal + endcardSec).toFixed(3);
  const { inputs, chain: bgChain } = backgroundChain(bg, total);

  // 音声入力: talk=mp3 / カード=無音。concat には同一フォーマットが要るので aformat を噛ませる。
  const aLabels = [];
  for (const it of items) {
    const idx = inputs.filter((a) => a === '-i').length; // これまでの入力数 = 次の入力index
    if (it.type === 'talk') {
      inputs.push('-i', it.mp3Path);
    } else {
      inputs.push('-f', 'lavfi', '-t', String(it.dur), '-i', 'anullsrc=r=44100:cl=stereo');
    }
    aLabels.push({ idx, dur: it.dur, type: it.type });
  }

  const aChains = aLabels.map((a, i) =>
    `[${a.idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${a.dur},asetpts=N/SR/TB[a${i}]`);
  const concatIn = aLabels.map((_, i) => `[a${i}]`).join('');

  const filter = [
    bgChain,
    ...aChains,
    `${concatIn}concat=n=${aLabels.length}:v=0:a=1[araw]`,
    `[araw]asplit=2[awav][a0]`,
    `[awav]showwaves=s=${W}x120:mode=cline:rate=${FPS}:colors=0xB0D9E8[wav]`,
    `[bg][wav]overlay=x=0:y=H-170:shortest=0[bgw]`,
    `[bgw]subtitles=filename='${ffPath(assPath)}':fontsdir='${ffPath(FONTS_DIR)}'[vid]`,
    `[a0]afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, talkTotal - 1.2)}:d=1.2,apad[aud]`,
  ].join(';');

  const args = [
    '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[vid]', '-map', '[aud]',
    '-t', String(total),
    '-r', String(FPS),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-crf', '22', '-preset', 'veryfast',
    '-g', String(FPS * 4),
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    outMp4,
  ];

  await runFfmpeg(args, { onProgress: onProgress ? (t) => onProgress(t, total) : undefined });
  return { total };
}

/** サムネイル（1280x720 PNG・年号を大書き）。SHORTS_PLAYBOOK §3 の「年号大書き＋夜のモチーフ」 */
export async function renderThumbnail({ bg, assPath, outPng }) {
  const bgPath = bg ? path.resolve(BG_DIR, bg) : null;
  const inputs = [];
  let chain;
  if (bgPath && fs.existsSync(bgPath)) {
    inputs.push('-loop', '1', '-i', bgPath);
    chain = `[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=brightness=-0.10:contrast=1.03,vignette=PI/5,setsar=1[b]`;
  } else {
    inputs.push('-f', 'lavfi', '-t', '1', '-i', `gradients=s=1920x1080:c0=0x3d5f80:c1=0x090f19:type=radial:d=1:r=1`);
    chain = `[0:v]vignette=PI/5,setsar=1[b]`;
  }
  const args = [
    '-y', ...inputs,
    '-filter_complex',
    `${chain};[b]subtitles=filename='${ffPath(assPath)}':fontsdir='${ffPath(FONTS_DIR)}',scale=1280:720[v]`,
    '-map', '[v]', '-frames:v', '1', outPng,
  ];
  await runFfmpeg(args);
}
