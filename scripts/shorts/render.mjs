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

/**
 * clips = [{ mp3Path, win }, ...]。型A/型Bは1要素、型C（走馬灯）はエピソード各所からの
 * 断片を並べるので複数要素になる。断片の境目は 0.12s のフェードで繋ぐ（無処理だと
 * 波形の不連続がプチッと鳴る）。
 */
export async function renderShort({ clips, bg, assPath, outMp4, endcardSec }) {
  const dur = +clips.reduce((s, c) => s + c.win.dur, 0).toFixed(3);
  const total = +(dur + endcardSec).toFixed(3);

  const assArg = `subtitles=filename='${ffPath(assPath)}':fontsdir='${ffPath(FONTS_DIR)}'`;

  const inputs = [];
  let bgChain;

  const bgPath = bg ? path.resolve(BG_DIR, bg) : null;
  if (bgPath && fs.existsSync(bgPath)) {
    // 背景静止画＋ゆっくりズーム（Ken Burns）
    inputs.push('-loop', '1', '-t', String(total), '-i', bgPath);
    // 上のキラキラは残し、字幕帯（下側）だけをグラデ乗算で暗くして可読性を確保（hideフィードバック 2026-07-13）。
    // eqは軽い暗転＋彩度維持でカラフルさを保つ／下部scrim=白→暗灰の縦グラデをmultiply。
    bgChain =
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
      `zoompan=z='min(zoom+0.0004,1.12)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${FPS},` +
      `eq=brightness=-0.08:contrast=1.02:saturation=0.98,vignette=PI/6,setsar=1,format=gbrp[bgraw];` +
      `gradients=s=1080x1920:c0=0xffffff:c1=0x2a2a2a:x0=540:y0=930:x1=540:y1=1920:d=${total}:r=${FPS},format=gbrp[scrim];` +
      `[bgraw][scrim]blend=all_mode=multiply,format=yuv420p[bg]`;
  } else {
    // フォールバック: 暗い紺のゆっくり動くグラデ＋ビネット（画像プール未整備でも動く・設計 §6.4）
    // ※temporal noiseは全フレーム再生成で圧縮不能→巨大化するため使わない
    if (bg) console.warn(`   ⚠ 背景画像が見つからないためフォールバック背景を使用: ${bgPath}`);
    // 中心がほのかに灯る放射グラデ（真っ暗の寂しさを減らす・hideフィードバック 2026-07-13）
    inputs.push('-f', 'lavfi', '-t', String(total), '-i',
      `gradients=s=1080x1920:c0=0x1e2f44:c1=0x070b12:type=radial:d=${total}:speed=0.004:r=${FPS}`);
    bgChain = `[0:v]vignette=PI/6,setsar=1[bg]`;
  }

  // 音声入力（断片ごとに切り出し）。入力番号は背景が[0]なので 1..N。
  for (const c of clips) {
    inputs.push('-ss', String(c.win.t0), '-t', String(c.win.dur), '-i', c.mp3Path);
  }

  // 断片ごとに境目のクリック音を消してから連結する。
  const clipChains = clips.map((c, i) => {
    const d = c.win.dur;
    const fo = Math.max(0, d - 0.12);
    return `[${i + 1}:a]afade=t=in:st=0:d=0.12,afade=t=out:st=${fo}:d=0.12[c${i}]`;
  });
  const concatChain = clips.length > 1
    ? `${clips.map((_, i) => `[c${i}]`).join('')}concat=n=${clips.length}:v=0:a=1[acat]`
    : `[c0]anull[acat]`;

  const filter = [
    bgChain,
    ...clipChains,
    concatChain,
    `[acat]asplit=2[awav][a0]`,
    // ⚠️ draw=full は必須。既定の draw=scale は「1列に当たったサンプル数」で輝度を割るため、
    // 幅1080px×rate30 では1列あたり約1.4サンプルしか無く、波形が最大輝度80＝ほぼ見えない
    // （2026-07-16 アンカー側で発覚し、ショートも同じ穴だったことが判明）。
    `[awav]showwaves=s=1080x140:mode=cline:rate=${FPS}:colors=0xB0D9E8:draw=full[wav]`,
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
