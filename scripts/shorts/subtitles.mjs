/**
 * 字幕ASS生成。Whisperの segment（文/フレーズ単位・クリーンな句読点・信頼できる時刻）を字幕イベントの
 * 基本単位にする。word トークンは日本語で境界が不安定（例「シール」→「シ」+「ール」）なため使わない。
 * 改行は「シンヤの間＝segment内の空白」と句読点でのみ行い、単語の途中で切らない（hideフィードバック 2026-07-13）。
 * 設計 §5。libassで描画。日本語フォントは fontsdir で渡す。
 */
import fs from 'node:fs';
import { assTime, normalizeForCompare } from './util.mjs';

const SEASON_JP = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const MAX_LINE = 15; // 1行の全角目安（フォント56px・使用幅936px≒16.7字ぶん）。超えたら改行する
const SPLIT_EVENT = 34; // これを超えるsegmentは時間比で2イベントに分割

/** ASSテキスト用エスケープ（改行・オーバーライド記号の暴発防止） */
function assEscape(s) {
  return (s ?? '').replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim();
}

const visLen = (s) => normalizeForCompare(s).length;

/** segment.text → フレーズ配列（空白＝間、読点直後で分割・単語は割らない）
 *  ⚠️ 句点の直後に閉じ括弧が続く「…なさい。」と書いた」のような並びで機械的に割ると、
 *     「」」だけが次行の先頭に取り残される（2026-07-17 1995春で露見）。閉じ括弧・読点が
 *     続く場合は割らない（禁則）。 */
function toPhrases(text) {
  return (text ?? '')
    .trim()
    .replace(/^[、。」』）・\s]+/, '')
    .split(/\s+/)
    .flatMap((p) => p.split(/(?<=[、。])(?![」』）\]｝、。・])/))
    .map((p) => p.trim())
    .filter(Boolean);
}

/** 表示幅（全角=1・半角=0.5）。visLenは比較用の正規化（読点除去・カナ化）で表示幅ではない。 */
const dispLen = (s) => Array.from(s ?? '')
  .reduce((n, ch) => n + (/[\x00-\xFF｡-ﾟ]/.test(ch) ? 0.5 : 1), 0);

/** 折り返しの最小単位。全角は1文字＝1トークン、半角の連続（1995 / ReDial 等）は割らずに1トークン。 */
function tokenizeJa(s) {
  const toks = [];
  let buf = '';
  for (const ch of Array.from(s ?? '')) {
    if (/[0-9A-Za-z]/.test(ch)) { buf += ch; continue; }
    if (buf) { toks.push(buf); buf = ''; }
    toks.push(ch);
  }
  if (buf) toks.push(buf);
  return toks;
}

/** ⚠️ libassは空白の無い日本語を自動折返ししない（WrapStyle:0は空白でしか折らない）。
 *  2026-07-16にアンカー側で判明し、ショートも同じ穴だった（読点の無い長文が画面外へ溢れる）。
 *  文字数で折るが、西暦や英単語は割らず、行頭に来てはいけない約物は前行に残す。 */
const CLOSER = /^[、。，．！？!?」』）\]｝・ー…ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]$/;

/** トークン列を幅 max で貪欲に折る。行頭に来てはいけない約物は前行に残す。 */
function wrapTokens(toks, max) {
  const lines = [];
  let cur = '';
  for (const tok of toks) {
    if (cur && dispLen(cur) + dispLen(tok) > max && !CLOSER.test(tok)) { lines.push(cur); cur = ''; }
    cur += tok;
  }
  if (cur) lines.push(cur);
  return lines;
}

function wrapJa(s, max = MAX_LINE) {
  const t = (s ?? '').trim();
  if (!t || dispLen(t) <= max) return t;
  const toks = tokenizeJa(t);
  const greedy = wrapTokens(toks, max);

  // 2行で収まるなら、**句読点の直後**で割るのが最も自然。文字数だけで割ると
  // 「数字で気持／ちを伝えていた」のように語の途中で切れて素人臭くなる（2026-07-22 実測）。
  // 両行が max に収まる候補のうち、行長が最も揃うものを選ぶ。
  if (greedy.length === 2) {
    let best = null;
    for (let i = 0; i < t.length - 1; i++) {
      if (!/[、。]/.test(t[i])) continue;
      // 「生きろ。」の 。 のように、直後が閉じ括弧なら割らない（」だけが次行頭に落ちる）
      if (/^[」』）\]｝】〉》]/.test(t[i + 1] ?? '')) continue;
      const a = t.slice(0, i + 1);
      const b = t.slice(i + 1);
      if (!b || dispLen(a) > max || dispLen(b) > max) continue;
      const cost = Math.abs(dispLen(a) - dispLen(b));
      if (!best || cost < best.cost) best = { a, b, cost };
    }
    if (best) return [best.a, best.b].join('\\N');
  }
  // 貪欲に詰めると最終行が「た。」だけ、のような落ち穂になる（2026-07-22 実測:
  // 「今夜はあの春を少しだけ歩きまし／た。」「…逆転へ向かっていっ／た」）。
  // 読めるが素人臭く見えるので、行数を増やさずに幅を詰めて行長を揃え直す。
  const n = greedy.length;
  if (n >= 2 && dispLen(greedy[n - 1]) < max * 0.4) {
    const balanced = wrapTokens(toks, Math.ceil(dispLen(t) / n));
    if (balanced.length === n) return balanced.join('\\N');
  }
  return greedy.join('\\N');
}

/** フレーズ配列を1つの表示テキストに。長い場合はフレーズ境界（中央寄り・句読点優先）で改行し、
 *  それでも1行が長いときは wrapJa で強制的に折る。 */
function renderLine(phrases) {
  const escaped = phrases.map(assEscape).filter(Boolean);
  if (!escaped.length) return '';
  const total = visLen(escaped.join(''));
  if (total <= MAX_LINE) return escaped.join('');
  if (escaped.length === 1) return wrapJa(escaped[0]);

  const cum = [];
  let acc = 0;
  for (const e of escaped) { acc += visLen(e); cum.push(acc); }
  const half = total / 2;
  let bestIdx = 0;
  let bestCost = Infinity;
  for (let i = 0; i < escaped.length - 1; i++) {
    const afterPunct = /[、。・」』）]$/.test(escaped[i]);
    const cost = Math.abs(cum[i] - half) - (afterPunct ? 3 : 0);
    if (cost < bestCost) { bestCost = cost; bestIdx = i; }
  }
  const a = wrapJa(escaped.slice(0, bestIdx + 1).join(''));
  const b = wrapJa(escaped.slice(bestIdx + 1).join(''));
  return [a, b].filter(Boolean).join('\\N');
}

/** Whisper segments → 字幕イベント（クリップ相対時刻）。events = [{start,end,text}] */
function segmentsToEvents(segments, t0, t1) {
  const dur = t1 - t0;
  const base = [];
  for (const seg of segments ?? []) {
    if (seg.end <= t0 + 0.1 || seg.start >= t1 - 0.1) continue;
    const s = Math.max(0, seg.start - t0);
    const e = Math.min(dur, seg.end - t0);
    const phrases = toPhrases(seg.text);
    if (!phrases.length) continue;
    base.push({ start: s, end: e, phrases });
  }

  // 長すぎる segment は中央のフレーズ境界で2イベントに（時間は文字数比で配分）
  const events = [];
  for (const ev of base) {
    const vis = ev.phrases.reduce((n, p) => n + visLen(p), 0);
    if (vis > SPLIT_EVENT && ev.phrases.length >= 2) {
      const half = vis / 2;
      let acc = 0; let bi = 0; let best = Infinity;
      for (let i = 0; i < ev.phrases.length - 1; i++) {
        acc += visLen(ev.phrases[i]);
        if (Math.abs(acc - half) < best) { best = Math.abs(acc - half); bi = i; }
      }
      const a = ev.phrases.slice(0, bi + 1);
      const b = ev.phrases.slice(bi + 1);
      const aVis = a.reduce((n, p) => n + visLen(p), 0);
      const mid = ev.start + (ev.end - ev.start) * (aVis / vis);
      events.push({ start: ev.start, end: mid, text: renderLine(a) });
      events.push({ start: mid, end: ev.end, text: renderLine(b) });
    } else {
      events.push({ start: ev.start, end: ev.end, text: renderLine(ev.phrases) });
    }
  }

  // 最小表示・重なり調整
  for (let i = 0; i < events.length; i++) {
    if (events[i].end - events[i].start < 0.5) events[i].end = Math.min(dur, events[i].start + 0.6);
    if (i + 1 < events.length && events[i].end > events[i + 1].start) {
      events[i].end = Math.max(events[i].start + 0.4, events[i + 1].start - 0.02);
    }
  }
  return events;
}

/** 誤読語の literal 置換（[wrong,right]…）。Whisperの固有名詞誤りを、
 *  セグメントのタイミングを保ったまま校正する。音声(TTS)は正しく字幕化だけが誤るため。 */
function applyFixes(text, fixes) {
  if (!fixes || !fixes.length || !text) return text;
  let t = text;
  for (const [from, to] of fixes) {
    if (from) t = t.split(from).join(to ?? '');
  }
  return t;
}

/**
 * clips = [{ segments, win }, ...]。型A/型Bは1要素、型C（走馬灯）は複数。
 * 断片ごとに時刻を先頭からの通算へ寄せて1本の字幕トラックにする。
 */
export function buildAss({ assPath, clips, year, season, title, topic, subsOverride, endcardSec, djName, songCard, walkingFlame, fixes }) {
  const dur = clips.reduce((s, c) => s + c.win.dur, 0);
  const total = dur + endcardSec;
  const seasonJP = SEASON_JP[season] ?? '';

  let subEvents;
  if (subsOverride) {
    const lines = subsOverride.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const slot = dur / Math.max(1, lines.length);
    subEvents = lines.map((text, i) => ({ start: i * slot, end: (i + 1) * slot, text: assEscape(applyFixes(text, fixes)) }));
  } else {
    subEvents = [];
    let offset = 0;
    for (const c of clips) {
      const fixed = (c.segments ?? []).map((s) => ({ ...s, text: applyFixes(s.text, fixes) }));
      for (const e of segmentsToEvents(fixed, c.win.t0, c.win.t1)) {
        subEvents.push({ ...e, start: e.start + offset, end: e.end + offset });
      }
      offset += c.win.dur;
    }
  }

  const styles = [
    // Name,Fontname,Fontsize,Primary,Secondary,Outline,Back,Bold,Italic,U,S,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,ML,MR,MV,Encoding
    'Style: Sub,Noto Sans JP,56,&H00FFFFFF,&H000000FF,&H00202020,&H80000000,1,0,0,0,100,100,0,0,1,3.4,2,2,72,72,430,1',
    'Style: Badge,Noto Serif JP,46,&H00B0D9E8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,2,0,1,2,1,7,54,54,64,1',
    'Style: Endcard,Noto Serif JP,66,&H00D8ECF5,&H00000000,&H00101010,&H90000000,0,0,0,0,100,100,0,0,1,3,3,5,90,90,0,1',
  ];

  const events = [];
  // 左上バッジ＝**いつ見ても「何年のどの季節の何の話か」が分かる**ための常設表示。
  // 冒頭3.6秒のタイトルだけだと途中から見た人に何も伝わらない（hide試写 2026-07-22）。
  // 1行目=年と季節（フル表記）／2行目=題材。2行目は控えめにして声の邪魔をしない。
  const badge = topic
    ? `${assEscape(`${year}年・${seasonJP}`)}\\N{\\fs30\\c&H0098BCCC&}${assEscape(topic)}`
    : assEscape(`${year}年・${seasonJP}`);
  events.push(`Dialogue: 0,${assTime(0)},${assTime(total)},Badge,,0,0,0,,${badge}`);
  for (const e of subEvents) {
    events.push(`Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Sub,,0,0,0,,${e.text}`);
  }
  // エンドカード＝感情の宛先をReDialに書き換える装置（Fable 2026-07-13 マーケ再設計）。
  // 型B（--song）: 曲予告クリフハンガー「♪ ここで『◯◯』が流れます／音楽つきのフル版は、ReDialで。」
  // 型A/C（既定）: 「♪ この続きに、あの頃の曲が流れます／ReDial——あなたの季節に、もう一度。」
  // 曲名が長いと1行に収まらない（Endcard fs66・使用幅900px）→ wrapJaで折る
  // 型C（走馬灯・複数断片）: 年という額縁で閉じ、**問い**で個人化へ渡す（Playbook §8.3）。
  // 「あなたの◯は、何年ですか」＝ 最初のひと回（年×季節を編む）への導火線。
  // ⚠️ Shortsは説明欄・コメントのURLがクリック不能（MARKETING_FUNNEL §3.1）。
  // つまり**画面にドメインを文字で出すことが、唯一その場で渡せる宛先**。
  // 「ReDialで。」だけでは、良いと思った人が行き先を持ち帰れない（hide試写 2026-07-22）。
  const SITE = 'redial.jp';
  const endcard = songCard
    ? `${wrapJa(`♪ ここで「${assEscape(songCard)}」が流れます`, 19)}\\N{\\fs40\\c&H00C8C8C8&}音楽つきのフル版（無料）は ${SITE}`
    : walkingFlame
      ? `${wrapJa(`ぜんぶ、${year}年の${seasonJP}です。`, 19)}\\N{\\fs40\\c&H00C8C8C8&}あなたの${seasonJP}は、何年ですか。 —— ${SITE}`
      : `♪ この続きに、あの頃の曲が流れます\\N{\\fs40\\c&H00C8C8C8&}音楽つきのフル版（無料）は ${SITE}`;
  events.push(`Dialogue: 0,${assTime(dur)},${assTime(total)},Endcard,,0,0,0,,${endcard}`);
  if (title) {
    // 冒頭に「何の話か」を平易に提示＋シンヤ名乗りで「これは深夜DJラジオ」という正体を毎回運ぶ。
    const djLine = djName ? `\\N{\\fs32\\c&H00B0B0B0&}${assEscape(djName)}` : '';
    // タイトルは長いと左右に溢れる（YouTube用のSEOタイトルをそのまま画面に出しているため）。
    // fs54は実測で1字=37.2px・使用幅900px（1080-90-90）→ 収まる上限24字。安全側で23。
    const cardText = wrapJa(assEscape(title), 23);
    events.push(`Dialogue: 0,${assTime(0)},${assTime(Math.min(3.6, dur))},Endcard,,0,0,1140,,{\\fs54\\c&H00F0F0F0&}${cardText}${djLine}`);
  }

  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');

  fs.writeFileSync(assPath, ass, 'utf8');
  return { assPath, subCount: subEvents.length, total };
}
