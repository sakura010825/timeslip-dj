/**
 * Geminiの透かし（✦）を消す。原本 → 実際に使う背景 の派生工程。
 *
 * Geminiの出力は右下に✦が入る（2026-07-17 実測: 768×1376 で x624-671 / y1232-1279）。
 * レンダは背景を 1080×1920 に拡大して使うので、消さないと動画に写り込む。
 *
 * ■ 既定は crop（透かしの上で切り落とす）
 *   塗りつぶし系は「透かしが実contentの上に乗っている画像」で必ず破綻する。実地の失敗:
 *     - 近傍パッチのコピー → konbini-night の斜めの帯に矩形の跡（横方向にしか効かない）
 *     - 外周からの双一次補間 → purikura の光の筋が途切れる／summer-poster に矩形の跡
 *   暗い画像なら下部scrimに沈んで見えないが、明るい題材では見える。画像ごとに判断が要る方式は
 *   将来の背景で必ず事故るので、常に安全な crop を既定にする（CLAUDE.md「確実に収まる」）。
 *   代償は解像度: 768→1080 の拡大率が 1.41 から 1.57 になる程度。失う下端はほぼ前景の床/路面。
 *
 * ■ --mode inpaint は、下端に残したい要素がある場合の逃げ道（暗い画像限定で使うこと）
 *
 * 使い方:
 *   node scripts/shorts/strip-watermark.mjs <in.png> <out.png> [--mode crop|inpaint] [--box l,t,w,h]
 */
import sharp from 'sharp';

const args = process.argv.slice(2);
const [inPath, outPath] = args.filter((a) => !a.startsWith('--'));
if (!inPath || !outPath) {
  console.error('使い方: node scripts/shorts/strip-watermark.mjs <in.png> <out.png> [--mode crop|inpaint]');
  process.exit(1);
}
const mode = args.find((a) => a.startsWith('--mode='))?.split('=')[1] ?? 'crop';
const boxArg = args.find((a) => a.startsWith('--box='))?.split('=')[1];
// 既定＝実測の✦位置に余白8pxを足した箱
const [left, top, w, h] = boxArg ? boxArg.split(',').map(Number) : [614, 1222, 68, 68];

const meta = await sharp(inPath).metadata();
if (left + w > meta.width || top + h > meta.height) {
  console.error(`箱が画像(${meta.width}x${meta.height})の外です: ${left},${top},${w},${h}`);
  process.exit(1);
}

const lumOf = (buf, W, x, y) => {
  const i = (y * W + x) * 3;
  return buf[i] * 0.299 + buf[i + 1] * 0.587 + buf[i + 2] * 0.114;
};

if (mode === 'crop') {
  // 透かしの上で切る。幅はそのまま＝レンダ側の cover で中央が使われる。
  const newH = top;
  await sharp(inPath).removeAlpha().extract({ left: 0, top: 0, width: meta.width, height: newH }).png().toFile(outPath);
  const ar = (meta.width / newH).toFixed(3);
  console.log(`${outPath}  ${meta.width}x${meta.height} → ${meta.width}x${newH} (AR=${ar}) 透かしごと下端を除去`);
} else {
  const { data, info } = await sharp(inPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const px = (x, y, c) => data[(y * W + x) * 3 + c];
  const out = Buffer.from(data);
  for (let y = top; y < top + h; y++) {
    for (let x = left; x < left + w; x++) {
      const dx = (x - left + 1) / (w + 1);
      const dy = (y - top + 1) / (h + 1);
      for (let c = 0; c < 3; c++) {
        const L = px(left - 1, y, c), R = px(left + w, y, c);
        const T = px(x, top - 1, c), B = px(x, top + h, c);
        let v = ((1 - dx) * L + dx * R + (1 - dy) * T + dy * B) / 2;
        v += ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 3.0 - 1.5;
        out[(y * W + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toFile(outPath);
  let before = 0, after = 0;
  for (let y = top; y < top + h; y++) {
    for (let x = left; x < left + w; x++) {
      before = Math.max(before, lumOf(data, W, x, y));
      after = Math.max(after, lumOf(out, W, x, y));
    }
  }
  console.log(`${outPath}  [inpaint] 透かし領域の最大輝度 ${before.toFixed(0)} → ${after.toFixed(0)}`);
}
