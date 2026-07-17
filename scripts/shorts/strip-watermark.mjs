/**
 * Geminiの透かし（✦）を消す。原本 → 実際に使う背景 の派生工程。
 *
 * Geminiの出力は右下に✦が入る（2026-07-17 実測: 768×1376 で x624-671 / y1232-1279）。
 * レンダは背景を 1080×1920 に拡大して使うので、消さないと動画に写り込む。
 *
 * 埋め方＝箱の外周からの双一次補間。単純な「近傍パッチのコピー」は横方向の質感にしか効かず、
 * konbini-night のような斜めの帯が走る画像では矩形の跡が残る（2026-07-17 に実地で確認）。
 *
 * 使い方:
 *   node scripts/shorts/strip-watermark.mjs <in.png> <out.png> [--box left,top,w,h] [--check]
 */
import sharp from 'sharp';

const args = process.argv.slice(2);
const [inPath, outPath] = args.filter((a) => !a.startsWith('--'));
if (!inPath || !outPath) {
  console.error('使い方: node scripts/shorts/strip-watermark.mjs <in.png> <out.png> [--box l,t,w,h]');
  process.exit(1);
}
const boxArg = args.find((a) => a.startsWith('--box='))?.split('=')[1];
// 既定＝実測の✦位置に余白8pxを足した箱
const [left, top, w, h] = boxArg ? boxArg.split(',').map(Number) : [614, 1222, 68, 68];

const { data, info } = await sharp(inPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
if (left + w >= W || top + h >= info.height || left < 1 || top < 1) {
  console.error(`箱が画像(${W}x${info.height})の外にはみ出しています: ${left},${top},${w},${h}`);
  process.exit(1);
}

const px = (x, y, c) => data[(y * W + x) * 3 + c];
const out = Buffer.from(data);

for (let y = top; y < top + h; y++) {
  for (let x = left; x < left + w; x++) {
    const dx = (x - left + 1) / (w + 1);
    const dy = (y - top + 1) / (h + 1);
    for (let c = 0; c < 3; c++) {
      const L = px(left - 1, y, c);
      const R = px(left + w, y, c);
      const T = px(x, top - 1, c);
      const B = px(x, top + h, c);
      let v = ((1 - dx) * L + dx * R + (1 - dy) * T + dy * B) / 2;
      // 周囲と同程度の粒状感を戻す（のっぺりした面は逆に目立つ）
      v += ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 3.0 - 1.5;
      out[(y * W + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
}

await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toFile(outPath);

// 検証: 塗った領域が周囲の明るさに馴染んだか
const lum = (buf, x, y) => {
  const i = (y * W + x) * 3;
  return buf[i] * 0.299 + buf[i + 1] * 0.587 + buf[i + 2] * 0.114;
};
let before = 0, after = 0;
for (let y = top; y < top + h; y++) {
  for (let x = left; x < left + w; x++) {
    before = Math.max(before, lum(data, x, y));
    after = Math.max(after, lum(out, x, y));
  }
}
console.log(`${outPath}  透かし領域の最大輝度 ${before.toFixed(0)} → ${after.toFixed(0)}`);
