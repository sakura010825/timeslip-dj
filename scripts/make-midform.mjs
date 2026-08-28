/**
 * 中尺「5分の深夜ラジオ」生成CLI（16:9・3分超）— 2026-08-17
 *
 * 設計の正: ../redial/docs/MIDFORM_RADIO_2026-08.md
 *
 * ショート（9:16・28〜40秒）とは**別ライン**にしてある。理由は2つ:
 *   1. 毎晩回っているショートのパイプラインを壊さない（あちらは生命線）
 *   2. 中尺は構造が違う——セグメントを丸ごと使い、**曲のあった場所にカードを置く**
 *      （原盤は入れられないので「ここで◯◯が流れます」で示し、続きは redial.jp へ）
 *
 * この面の役割（8/17 の実測で確定）:
 *   - **押せる説明欄リンク**（ショートの説明欄・コメントのURLは押せない＝唯一タップで飛べる橋）
 *   - **検索の受け皿**（検索536回/30日・固有名詞で来る。ショートは検索に弱い）
 *   - **また来る理由**（新しい視聴者99.9%・定期的な視聴者0＝リピーターが実質ゼロ）
 *   ※ 登録の主戦場はショートフィード（登録の81.8%）なので、そちらは名乗り行とエンドカードで戦う
 *
 * 使い方:
 *   node --env-file=.env.local scripts/make-midform.mjs --id 1 --dry-run
 *   node --env-file=.env.local scripts/make-midform.mjs --id 1
 *
 * 出力: output/midform/{cell}-{hook}.mp4 ＋ 同名 .json（投稿メタ）
 *
 * 前提: 各セグメントの Whisper 結果が output/shorts/.cache/{cell}-seg{N}.words.json にあること
 *       （make-short.mjs が作る。無い場合はそのセグメントでショートを1本 dry-run すれば貯まる）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs, FONTS_DIR, BG_DIR, CACHE_ROOT, STOCK_ROOT } from './shorts/util.mjs';

const args = parseArgs(process.argv.slice(2));
const DRY = !!args['dry-run'];

// ── 画面（16:9） ──────────────────────────────────────────────────
const W = 1920;
const H = 1080;
const FPS = 30;
const MAX_LINE = 32; // fs44 × 使用幅1600px（1920 − 160×2）≒ 36字。安全側で32
const SITE = 'redial.jp';

// カードの尺
const TITLE_CARD_SEC = 4.0; // 冒頭（年・季節＋名乗り）
const SONG_CARD_SEC = 3.5; // セグメント間（曲のあった場所）
const END_CARD_SEC = 6.0; // 末尾（曲＋サイト＋明日の予告）

const OUT_DIR = path.resolve(process.cwd(), 'output', 'midform');
const SEASON_JP = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

const ffPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
const assEscape = (s) => String(s ?? '').replace(/\\/g, '＼').replace(/[{}]/g, '');
const dispLen = (s) =>
  Array.from(s ?? '').reduce((n, ch) => n + (/[\x00-\xFF｡-ﾟ]/.test(ch) ? 0.5 : 1), 0);

const CLOSER = /^[、。，．！？!?」』）\]｝・ー…ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]$/;

function tokenize(s) {
  const toks = [];
  let buf = '';
  for (const ch of Array.from(s ?? '')) {
    if (/[0-9A-Za-z.'’]/.test(ch)) {
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
 * 文節に割る。読点・句点の直後で割るのに加え、**空白でも割る**のが要点。
 * Whisper は台本の読点を落として空白にすることがあり（「…先頭にいた 世界記録保持者の…」）、
 * 読点だけを頼りにすると文字単位の折返しに落ちて **語の途中で切れる**
 * （2026-08-17 の1本目で「バー/コフ」が割れて発覚）。
 */
function toPhrases(t) {
  return t
    .split(/(?<=[、。])(?![」』）\]｝、。・])|\s+/)
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
}

/** 読点・句点・空白の句切りを優先して折る（語の途中で切らない）。make-postcard.mjs と同型。 */
function wrap(s, max = MAX_LINE) {
  const t = (s ?? '').trim();
  if (!t || dispLen(t) <= max) return [t];
  const lines = [];
  let cur = '';
  const phrases = toPhrases(t);
  for (const ph of phrases) {
    if (dispLen(ph) > max) {
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

function applyFixes(text, fixes) {
  if (!fixes?.length || !text) return text;
  let t = text;
  for (const [from, to] of fixes) if (from) t = t.split(from).join(to ?? '');
  return t;
}

const assTime = (sec) => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
};

function runFfmpeg(argv) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => {
      err += d.toString();
    });
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}\n${err.slice(-2000)}`)),
    );
  });
}

// ── 素材の読み込み ────────────────────────────────────────────────
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'data', 'midform.manifest.json'), 'utf8'),
);
const item = (manifest.items ?? []).find((x) => String(x.id) === String(args.id ?? 1));
if (!item) {
  console.error(`❌ midform.manifest.json に id=${args.id} がありません`);
  process.exit(1);
}

const stock = JSON.parse(
  fs.readFileSync(path.resolve(STOCK_ROOT, item.cell, 'stock.json'), 'utf8'),
);
const [year, season] = item.cell.split('-');
const seasonJP = SEASON_JP[season] ?? '';

/** 使うセグメント（音声・尺・直後の曲） */
const parts = item.segs.map((idx) => {
  const seg = stock.segments.find((s) => s.segmentIndex === idx);
  if (!seg) throw new Error(`stock.json に segmentIndex=${idx} がありません`);
  // ファイル名は `seg{index}-{segmentName}.mp3`（stock.json の segmentName にはこの接頭辞が無い）
  const mp3 = path.resolve(STOCK_ROOT, item.cell, 'segments', `seg${idx}-${seg.segmentName}.mp3`);
  if (!fs.existsSync(mp3)) throw new Error(`音声が見つかりません: ${mp3}`);
  const cache = path.resolve(CACHE_ROOT, `${item.cell}-seg${idx}.words.json`);
  if (!fs.existsSync(cache)) {
    throw new Error(
      `Whisper結果がありません: ${cache}\n   → そのセグメントでショートを1本 dry-run すると貯まります`,
    );
  }
  const w = JSON.parse(fs.readFileSync(cache, 'utf8'));
  return {
    idx,
    mp3,
    label: seg.segmentLabel ?? seg.segmentName,
    dur: Number(seg.estimatedDurationSec ?? 0),
    song: seg.songAfter?.title ?? null,
    artist: seg.songAfter?.artist ?? null,
    segments: w.segments ?? [],
  };
});

// ── タイムライン（カードと音声の並び） ───────────────────────────
// [タイトルカード] → seg1 → [曲カード] → seg2 → … → [エンドカード]
const timeline = [];
let t = 0;
timeline.push({ kind: 'title', start: 0, end: TITLE_CARD_SEC });
t = TITLE_CARD_SEC;
parts.forEach((p, i) => {
  p.tStart = t;
  t += p.dur;
  p.tEnd = t;
  const isLast = i === parts.length - 1;
  if (!isLast) {
    timeline.push({ kind: 'song', start: t, end: t + SONG_CARD_SEC, song: p.song, artist: p.artist });
    t += SONG_CARD_SEC;
  }
});
const lastSong = parts[parts.length - 1].song;
timeline.push({ kind: 'end', start: t, end: t + END_CARD_SEC, song: lastSong });
const TOTAL = +(t + END_CARD_SEC).toFixed(3);

console.log(`\n[中尺 #${item.id}] ${item.cell} seg${item.segs.join('+')} — 合計 ${(TOTAL / 60).toFixed(1)}分（${TOTAL.toFixed(1)}s）`);
for (const p of parts) {
  console.log(`   seg${p.idx} ${p.label} ${p.dur.toFixed(1)}s  → ♪ ${p.song ?? '(なし)'}`);
}
if (TOTAL <= 181) {
  console.warn('   ⚠ 3分1秒以下です。16:9なのでショート扱いにはなりませんが、中尺の狙い（4〜6分）から外れます');
}
if (DRY) {
  console.log('\n（dry-run・動画は作りません）');
  process.exit(0);
}

// ── ASS 字幕 ──────────────────────────────────────────────────────
const styles = [
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  // 字幕（下・中央）
  'Style: Sub,Noto Serif JP,44,&H00F5F5F5,&H00F5F5F5,&H96000000,&H00000000,0,0,0,0,100,100,1,0,1,2.6,0,2,160,160,150,1',
  // 年バッジ（左上）
  'Style: Badge,Noto Serif JP,30,&H00C8C8C8,&H00C8C8C8,&H96000000,&H00000000,0,0,0,0,100,100,2,0,1,2.0,0,7,90,90,70,1',
  // カード（中央）
  'Style: Card,Noto Serif JP,58,&H00F0F0F0,&H00F0F0F0,&H96000000,&H00000000,0,0,0,0,100,100,1,0,1,2.6,0,5,160,160,0,1',
];

const events = [];
// 年バッジは全編出す（どの季節の回かを常に示す）
events.push(`Dialogue: 0,${assTime(0)},${assTime(TOTAL)},Badge,,0,0,0,,${assEscape(`${year}年・${seasonJP}`)}`);

// カード
for (const c of timeline) {
  if (c.kind === 'title') {
    const body =
      `${assEscape(item.cardTitle ?? `${year}年・${seasonJP} 深夜ラジオ`)}` +
      `\\N{\\fs34\\c&H00B0B0B0&}毎晩22時の深夜ラジオ・シンヤ`;
    events.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Card,,0,0,0,,${body}`);
  } else if (c.kind === 'song') {
    const body =
      `${wrap(`♪ ここで「${assEscape(c.song ?? '')}」が流れます`, 22).join('\\N')}` +
      `\\N{\\fs38\\c&H00D0D0D0&}フル版（無料）は ${SITE}`;
    events.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Card,,0,0,0,,${body}`);
  } else {
    const body =
      `${wrap(`♪ ここで「${assEscape(c.song ?? '')}」が流れます`, 22).join('\\N')}` +
      `\\N{\\fs44\\c&H00FFFFFF&}フル版（無料）は ${SITE}` +
      `\\N{\\fs32\\c&H00B0B0B0&}明日の22時も、どこかの季節を。`;
    events.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Card,,0,0,0,,${body}`);
  }
}

/**
 * 字幕（セグメントごと。カード中は出さない）。
 * Whisperの1セグメントは最長11秒ほどあり、そのまま出すと3行になって画面を占める。
 * **SPLIT_EVENT を超える長さは文節境界で2イベントに割る**（時間は文字数比で配分）
 * ——ショート側の subtitles.mjs と同じ考え方。
 */
const SPLIT_EVENT = 34;
let subCount = 0;
// 焼き込みと同じ文字列・同じ時刻で .srt も出す（2026-08-28）。
// 目的は視聴体験ではなく**検索**: YouTubeは字幕テキストをインデックスに入れるので、
// 4〜5分ぶんの固有名詞をまとめて読ませられる。ショートには無い中尺だけの面。
// ⚠️ 焼き込み字幕があるのでCCを入れると二重になるが、既定はオフ。
//    わざわざCCを入れる人に合わせて焼き込みを外すことはしない（2026-08-28 hide判断）。
const srtCues = [];
for (const p of parts) {
  for (const s of p.segments) {
    const text = applyFixes(s.text ?? '', item.fixes);
    if (!text.trim()) continue;
    const start = p.tStart + s.start;
    const end = Math.min(p.tEnd, p.tStart + s.end);
    if (end - start < 0.3) continue;

    const phrases = toPhrases(text);
    const total = dispLen(text);
    if (total > SPLIT_EVENT && phrases.length >= 2) {
      // 中央に最も近い文節境界で2つに割る
      let acc = 0;
      let bi = 0;
      let best = Infinity;
      for (let i = 0; i < phrases.length - 1; i++) {
        acc += dispLen(phrases[i]);
        if (Math.abs(acc - total / 2) < best) {
          best = Math.abs(acc - total / 2);
          bi = i;
        }
      }
      const a = phrases.slice(0, bi + 1).join('');
      const b = phrases.slice(bi + 1).join('');
      const mid = start + (end - start) * (dispLen(a) / total);
      events.push(`Dialogue: 0,${assTime(start)},${assTime(mid)},Sub,,0,0,0,,${wrap(a).map(assEscape).join('\\N')}`);
      events.push(`Dialogue: 0,${assTime(mid)},${assTime(end)},Sub,,0,0,0,,${wrap(b).map(assEscape).join('\\N')}`);
      srtCues.push({ start, end: mid, text: a }, { start: mid, end, text: b });
      subCount += 2;
      continue;
    }
    events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Sub,,0,0,0,,${wrap(text).map(assEscape).join('\\N')}`);
    srtCues.push({ start, end, text });
    subCount++;
  }
}

const ass = [
  '[Script Info]',
  'ScriptType: v4.00+',
  `PlayResX: ${W}`,
  `PlayResY: ${H}`,
  'WrapStyle: 2',
  'ScaledBorderAndShadow: yes',
  '',
  '[V4+ Styles]',
  ...styles,
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ...events,
].join('\n');

fs.mkdirSync(OUT_DIR, { recursive: true });
const base = `${item.cell}-${item.hook}`;
const assPath = path.resolve(OUT_DIR, `.${base}.ass`);
fs.writeFileSync(assPath, ass, 'utf8');

// ── ffmpeg ────────────────────────────────────────────────────────
const bgPath = item.bg ? path.resolve(BG_DIR, item.bg) : null;
const hasBg = !!(bgPath && fs.existsSync(bgPath));
if (item.bg && !hasBg) console.warn(`   ⚠ 背景画像が見つかりません: ${bgPath}（フォールバック背景）`);

const inputs = [];
if (hasBg) {
  inputs.push('-loop', '1', '-t', String(TOTAL), '-i', bgPath);
} else {
  inputs.push(
    '-f',
    'lavfi',
    '-t',
    String(TOTAL),
    '-i',
    `gradients=s=${W}x${H}:c0=0x1e2f44:c1=0x070b12:type=radial:d=${TOTAL}:speed=0.004:r=${FPS}`,
  );
}
// 音声: 無音（タイトルカード）→ seg → 無音（曲カード）→ seg → 無音（エンドカード）
const audioInputs = [];
audioInputs.push({ kind: 'silence', sec: TITLE_CARD_SEC });
parts.forEach((p, i) => {
  audioInputs.push({ kind: 'mp3', mp3: p.mp3, sec: p.dur });
  if (i < parts.length - 1) audioInputs.push({ kind: 'silence', sec: SONG_CARD_SEC });
});
audioInputs.push({ kind: 'silence', sec: END_CARD_SEC });

for (const a of audioInputs) {
  if (a.kind === 'silence') {
    inputs.push('-f', 'lavfi', '-t', String(a.sec), '-i', 'anullsrc=r=44100:cl=stereo');
  } else {
    inputs.push('-i', a.mp3);
  }
}

const bgChain = hasBg
  ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
    `zoompan=z='min(zoom+0.00015,1.10)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},` +
    `eq=brightness=-0.04:contrast=1.03:saturation=1.0,vignette=PI/7,setsar=1[bg]`
  : `[0:v]vignette=PI/6,setsar=1[bg]`;

// 各音声を 44100/stereo に揃えてから連結（mp3と無音のフォーマット差で concat が落ちるのを防ぐ）
const aChains = audioInputs.map(
  (a, i) => `[${i + 1}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${a.sec},asetpts=N/SR/TB[a${i}]`,
);
const concat = `${audioInputs.map((_, i) => `[a${i}]`).join('')}concat=n=${audioInputs.length}:v=0:a=1[acat]`;

const filter = [
  bgChain,
  ...aChains,
  concat,
  `[acat]asplit=2[awav][a0]`,
  // draw=full は必須（既定の draw=scale だと波形がほぼ見えない・2026-07-16 の実測）
  `[awav]showwaves=s=${W}x120:mode=cline:rate=${FPS}:colors=0xB0D9E8:draw=full[wav]`,
  `[bg][wav]overlay=x=0:y=H-140:shortest=0[bgw]`,
  `[bgw]subtitles=filename='${ffPath(assPath)}':fontsdir='${ffPath(FONTS_DIR)}'[vid]`,
  `[a0]afade=t=in:st=0:d=0.4,afade=t=out:st=${Math.max(0, TOTAL - 0.6)}:d=0.6,apad[aud]`,
].join(';');

const outMp4 = path.resolve(OUT_DIR, `${base}.mp4`);
console.log('\n   レンダ中…（4〜5分の動画なので1〜3分かかります）');
await runFfmpeg([
  '-y',
  ...inputs,
  '-filter_complex',
  filter,
  '-map',
  '[vid]',
  '-map',
  '[aud]',
  '-t',
  String(TOTAL),
  '-r',
  String(FPS),
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-profile:v',
  'high',
  '-crf',
  '21',
  '-preset',
  'veryfast',
  '-c:a',
  'aac',
  '-b:a',
  '160k',
  '-movflags',
  '+faststart',
  outMp4,
]);

// ── 投稿メタ ──────────────────────────────────────────────────────
const linkBase = `https://redial.jp/episodes/${item.cell}`;
const utm = manifest.utm ?? { source: 'youtube', medium: 'midform' };
// 説明欄（2026-08-28 改訂）。中尺はショートと違い**検索の受け皿**にできる面なので、
// 固有名詞をできるだけ多く載せる。実測（`npm run yt` の「4b. 検索語」）では検索流入の61%が
// 1〜2回ずつの長い尾＝**大きな語で勝つのではなく、載っている固有名詞の総量で拾う**構造だった。
//   - 1行目は**タイトルの繰り返しをやめ**、掴みの一文にする（検索スニペットに出るのはここ）
//   - `topics`（この回に出てくるもの）と `hashtags` を manifest から載せる
const hookLine = item.hook1Line ?? `${item.cardTitle} の回です。`;
const desc = [
  hookLine,
  '',
  `🎧 この夜の続き——トークのあとに、当時の名曲がまるごと流れます。フル版（無料）は redial.jp から。`,
  `${linkBase}?utm_source=${utm.source}&utm_medium=${utm.medium}&utm_campaign=${item.campaign}`,
  '',
  'この回で流れる曲（サイトではまるごと流れます）:',
  ...parts.map((p) => `・${p.song ?? ''}${p.artist ? ` / ${p.artist}` : ''}`),
  ...(item.topics?.length ? ['', 'この回に出てくるもの:', ...item.topics.map((t) => `・${t}`)] : []),
  '',
  '毎晩22時、どこかの季節を流しています。',
  ...(item.hashtags?.length ? ['', item.hashtags.map((h) => `#${h}`).join(' ')] : []),
].join('\n');

const meta = {
  id: item.id,
  cell: item.cell,
  segs: item.segs,
  campaign: item.campaign,
  title: item.title,
  durationSec: TOTAL,
  songs: parts.map((p) => ({ song: p.song, artist: p.artist })),
  description: desc,
  landing: `${linkBase}?utm_source=${utm.source}&utm_medium=${utm.medium}&utm_campaign=${item.campaign}`,
};
fs.writeFileSync(path.resolve(OUT_DIR, `${base}.json`), JSON.stringify(meta, null, 2) + '\n', 'utf8');

// 字幕ファイル（YouTube に上げて検索インデックスに載せる）
const srtTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`;
};
const srtPath = path.resolve(OUT_DIR, `${base}.srt`);
fs.writeFileSync(
  srtPath,
  srtCues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'),
  'utf8',
);
try {
  fs.unlinkSync(assPath);
} catch {
  /* 消せなくても支障なし */
}

console.log(`\n✓ ${outMp4}`);
console.log(`   ${(TOTAL / 60).toFixed(1)}分 / 字幕 ${subCount}件 / 曲カード ${parts.length}枚`);
console.log(`   メタ: ${path.resolve(OUT_DIR, `${base}.json`)}`);
