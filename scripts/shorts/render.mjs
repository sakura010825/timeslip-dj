/**
 * ffmpeg合成: 背景(静止画Ken Burns or 合成フォールバック)＋showwaves波形＋ASS(年バッジ/字幕/エンドカード)
 * ＋切り出し音声(afade)。9:16 / 1080×1920 / 30fps。設計 §6。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FONTS_DIR, BG_DIR } from './util.mjs';

const FPS = 30;

/** ffmpegのfilter/subtitles引数用にパスをエスケープ（Windowsのドライブ':'と'\'を無害化） */
function ffPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${err.slice(-1500)}`));
    });
  });
}

export async function renderShort({ mp3Path, win, bg, assPath, outMp4, endcardSec }) {
  const dur = win.dur;
  const total = +(dur + endcardSec).toFixed(3);
  const totalFrames = Math.round(total * FPS);

  const assArg = `subtitles=filename='${ffPath(assPath)}':fontsdir='${ffPath(FONTS_DIR)}'`;

  const inputs = [];
  let bgChain;

  const bgPath = bg ? path.resolve(BG_DIR, bg) : null;
  if (bgPath && fs.existsSync(bgPath)) {
    // 背景静止画＋ゆっくりズーム（Ken Burns）
    inputs.push('-loop', '1', '-t', String(total), '-i', bgPath);
    bgChain =
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
      `zoompan=z='min(zoom+0.0004,1.12)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${FPS},` +
      `setsar=1[bg]`;
  } else {
    // フォールバック: 暗い紺のゆっくり動くグラデ＋ビネット（画像プール未整備でも動く・設計 §6.4）
    // ※temporal noiseは全フレーム再生成で圧縮不能→巨大化するため使わない
    if (bg) console.warn(`   ⚠ 背景画像が見つからないためフォールバック背景を使用: ${bgPath}`);
    inputs.push('-f', 'lavfi', '-t', String(total), '-i',
      `gradients=s=1080x1920:c0=0x0b1a2e:c1=0x05090f:x0=0:y0=0:x1=1080:y1=1920:d=${total}:speed=0.006:r=${FPS}`);
    bgChain = `[0:v]vignette=PI/5,setsar=1[bg]`;
  }

  // 音声入力（切り出し）
  inputs.push('-ss', String(win.t0), '-t', String(dur), '-i', mp3Path);

  const filter = [
    bgChain,
    `[1:a]asplit=2[awav][a0]`,
    `[awav]showwaves=s=1080x140:mode=cline:rate=${FPS}:colors=0xB0D9E8[wav]`,
    `[bg][wav]overlay=x=0:y=H-210:shortest=0[bgw]`,
    `[bgw]${assArg}[vid]`,
    `[a0]afade=t=in:st=0:d=0.3,afade=t=out:st=${Math.max(0, dur - 0.3)}:d=0.3,apad[aud]`,
  ].join(';');

  const args = [
    '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[vid]', '-map', '[aud]',
    '-t', String(total),
    '-r', String(FPS),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-crf', '20', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outMp4,
  ];

  await runFfmpeg(args);
}
