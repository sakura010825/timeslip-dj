/**
 * チャンネル・トレーラー生成（2026-08-12・チャンネル活性化スプリントB）。
 *
 * 「チャンネルに来た人にReDialの楽しさが一度も見えていない」（hide指摘・8/12）への答え。
 * 台本骨子は 8/7 承認済み（こんばんは。シンヤです。〜今夜は、何年の夜にしましょうか。）。
 * YouTube Studio「未登録者向けチャンネル紹介動画」スロットに設定する 16:9・約45秒。
 *
 * 作り:
 *   - 行ごとに TTS（episodeと同じチャンク方式・S3設定は .env.local の TTS_*）
 *   - 行の実尺を ffprobe で測り、行間ギャップを足して**字幕は台本テキストを実測タイミングで焼く**
 *     （Whisper転写を字幕に使わない＝固有名詞誤聴が焼き込まれる事故が構造的に起きない。
 *       アンカーが srt を既定OFFにしたのと同じ理由・make-anchor.mjs 212行）
 *   - 発話と表示の分離: 「リダイヤル」と読ませて redial.jp を表示する（ラジオの流儀＝
 *     声は名前・画面は住所）
 *   - 映像は anchor/render.mjs の renderAnchor をそのまま流用（背景=radio-booth-night・
 *     showwaves draw=full・エンドカード6秒）
 *
 * usage:
 *   node --env-file=.env.local scripts/make-trailer.mjs             # 生成
 *   node --env-file=.env.local scripts/make-trailer.mjs --tts-only  # 音声だけ（試聴用）
 *   node --env-file=.env.local scripts/make-trailer.mjs --no-tts    # 既存mp3で映像だけ再合成
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureDir, assTime, FONTS_DIR } from './shorts/util.mjs';
import { renderAnchor } from './anchor/render.mjs';

const OUT_DIR = path.resolve('output', 'trailer');
const BG = 'radio-booth-night.png';
const ENDCARD_SEC = 6.0;

/**
 * 台本（tts=読ませる文 / show=焼く字幕 / gap=行の後の間・秒）。
 * 間はシンヤの pacing（Slow and deliberate, thoughtful pauses）に合わせて長めに取る。
 */
const LINES = [
  { tts: 'こんばんは。シンヤです。', show: 'こんばんは。シンヤです。', gap: 0.8 },
  { tts: 'ここは、1985年から2000年までの、どこかの季節につながる、深夜ラジオです。', show: 'ここは、1985年から2000年までの、\\Nどこかの季節につながる深夜ラジオです。', gap: 0.7 },
  { tts: 'たとえば、1990年の春。カセットテープに、曲を録っていた、あの頃。', show: 'たとえば、1990年の春。\\Nカセットテープに、曲を録っていたあの頃。', gap: 0.7 },
  { tts: '私が当時の話をして、その続きに、当時の曲が、そのまま流れます。', show: '私が当時の話をして——その続きに、\\N当時の曲が、そのまま流れます。', gap: 0.9 },
  { tts: 'ニュースでも、名盤解説でもなく。', show: 'ニュースでも、名盤解説でもなく。', gap: 0.5 },
  { tts: 'なんでもないけれど大切な、日常の記憶を。', show: 'なんでもないけれど大切な、日常の記憶を。', gap: 0.9 },
  { tts: 'フルエピソードは、リダイヤルで、無料で聴けます。', show: 'フルエピソードは、redial.jp で\\N無料で聴けます。', gap: 0.7 },
  { tts: '毎晩22時に、次の季節を流します。', show: '毎晩22時に、次の季節を流します。', gap: 0.9 },
  { tts: '今夜は、何年の夜にしましょうか。', show: '今夜は、何年の夜にしましょうか。', gap: 0 },
];

const args = process.argv.slice(2);
const TTS_ONLY = args.includes('--tts-only');
const NO_TTS = args.includes('--no-tts');

async function ttsLine(text, outPath) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.TTS_MODEL,
      voice: process.env.TTS_VOICE,
      instructions: process.env.TTS_INSTRUCTIONS,
      input: text,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

function probeDur(p) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p,
  ]).toString().trim();
  const d = Number(out);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe失敗: ${p} → "${out}"`);
  return d;
}

/** トレーラー専用ASS: 額縁（ReDialバッジ）＋行字幕（台本テキスト）＋エンドカード */
function buildTrailerAss({ assPath, subs, total }) {
  const styles = [
    'Style: Badge,Noto Serif JP,40,&H00B0D9E8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,2,0,1,2,1,7,56,56,52,1',
    // 行字幕: 波形(下端170px)の上・中央。ミュート自動再生でも読めることが最優先
    'Style: Line,Noto Serif JP,54,&H00E6F3F8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,1,0,1,3,2,2,140,140,210,1',
    'Style: Card,Noto Serif JP,72,&H00E6F3F8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,1,0,1,3,2,5,140,140,0,1',
    'Style: Scrim,Noto Sans JP,10,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
  ];
  const scrim = (s, e, a) =>
    `Dialogue: 0,${assTime(s)},${assTime(e)},Scrim,,0,0,0,,{\\fad(300,300)\\p1\\an7\\pos(0,0)\\c&H000000&\\alpha${a}}m 0 0 l 1920 0 l 1920 1080 l 0 1080{\\p0}`;

  const events = [
    `Dialogue: 0,${assTime(0)},${assTime(total)},Badge,,0,0,0,,ReDial\\N{\\fs26\\c&H00909090&}あの季節の深夜ラジオ`,
  ];
  for (const s of subs) {
    events.push(`Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Line,,0,0,0,,{\\fad(180,220)}${s.show}`);
  }
  const endStart = total - ENDCARD_SEC;
  events.push(scrim(endStart, total, '&H42&'));
  events.push(
    `Dialogue: 0,${assTime(endStart)},${assTime(total)},Card,,0,0,0,,{\\fad(500,300)}redial.jp\\N{\\fs40\\c&H00A8C4D0&}毎晩22時に、次の季節を流します。`,
  );

  fs.writeFileSync(assPath, [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080',
    'WrapStyle: 0', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: TV.709', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles, '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events, '',
  ].join('\n'), 'utf8');
}

async function main() {
  ensureDir(OUT_DIR);

  // 1) TTS（行ごと・既存があれば --no-tts でスキップ可能）
  const mp3s = LINES.map((_, i) => path.resolve(OUT_DIR, `line${String(i + 1).padStart(2, '0')}.mp3`));
  if (!NO_TTS) {
    for (let i = 0; i < LINES.length; i++) {
      process.stdout.write(`TTS ${i + 1}/${LINES.length}\r`);
      await ttsLine(LINES[i].tts, mp3s[i]);
    }
    console.log(`TTS ${LINES.length}/${LINES.length} 完了`);
  }

  // 2) 実尺測定 → タイムライン（talk行 + gap無音）と字幕窓
  const items = [];
  const subs = [];
  let t = 0;
  for (let i = 0; i < LINES.length; i++) {
    const dur = probeDur(mp3s[i]);
    items.push({ type: 'talk', mp3Path: mp3s[i], dur });
    // 字幕は音声より少し長く残す（間の途中まで＝読み切りの余韻）
    subs.push({ start: t, end: t + dur + Math.min(LINES[i].gap, 0.6), show: LINES[i].show });
    t += dur;
    if (LINES[i].gap > 0) {
      items.push({ type: 'gap', dur: LINES[i].gap });
      t += LINES[i].gap;
    }
  }
  const talkTotal = +t.toFixed(3);
  const total = +(talkTotal + ENDCARD_SEC).toFixed(3);
  console.log(`トーク ${talkTotal.toFixed(1)}s ＋ エンドカード ${ENDCARD_SEC}s ＝ ${total.toFixed(1)}s`);
  for (const s of subs) console.log(`  ${assTime(s.start)}–${assTime(s.end)}  ${s.show.replace(/\\N/g, ' / ')}`);
  if (TTS_ONLY) return;

  // 3) ASS → レンダ（anchorと同じ合成・波形はdraw=full）
  const assPath = path.resolve(OUT_DIR, '.trailer.ass');
  buildTrailerAss({ assPath, subs, total });
  const outMp4 = path.resolve(OUT_DIR, 'redial-channel-trailer.mp4');
  let lastPct = -1;
  await renderAnchor({
    items, bg: BG, assPath, outMp4, talkTotal, endcardSec: ENDCARD_SEC,
    onProgress: (cur, tot) => {
      const pct = Math.floor((cur / tot) * 10) * 10;
      if (pct > lastPct) { lastPct = pct; process.stdout.write(`render ${pct}%\r`); }
    },
  });
  const mb = (fs.statSync(outMp4).size / 1024 / 1024).toFixed(1);
  console.log(`✓ ${path.relative(process.cwd(), outMp4)} (${mb}MB / ${total.toFixed(1)}s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
