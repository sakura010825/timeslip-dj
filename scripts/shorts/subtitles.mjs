/**
 * 字幕ASS生成。Whisperの segment（文/フレーズ単位・クリーンな句読点・信頼できる時刻）を字幕イベントの
 * 基本単位にする。word トークンは日本語で境界が不安定（例「シール」→「シ」+「ール」）なため使わない。
 * 改行は「シンヤの間＝segment内の空白」と句読点でのみ行い、単語の途中で切らない（hideフィードバック 2026-07-13）。
 * 設計 §5。libassで描画。日本語フォントは fontsdir で渡す。
 */
import fs from 'node:fs';
import { assTime, normalizeForCompare } from './util.mjs';

const SEASON_JP = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const MAX_LINE = 15; // 1行の全角目安。超えたらフレーズ境界で1回改行、なお長ければlibass自動折返し
const SPLIT_EVENT = 34; // これを超えるsegmentは時間比で2イベントに分割

/** ASSテキスト用エスケープ（改行・オーバーライド記号の暴発防止） */
function assEscape(s) {
  return (s ?? '').replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim();
}

const visLen = (s) => normalizeForCompare(s).length;

/** segment.text → フレーズ配列（空白＝間、読点直後で分割・単語は割らない） */
function toPhrases(text) {
  return (text ?? '')
    .trim()
    .replace(/^[、。」』）・\s]+/, '')
    .split(/\s+/)
    .flatMap((p) => p.split(/(?<=[、。])/))
    .map((p) => p.trim())
    .filter(Boolean);
}

/** フレーズ配列を1つの表示テキストに。長い場合はフレーズ境界（中央寄り・句読点優先）で1回だけ \N。 */
function renderLine(phrases) {
  const escaped = phrases.map(assEscape).filter(Boolean);
  if (!escaped.length) return '';
  const total = visLen(escaped.join(''));
  if (total <= MAX_LINE || escaped.length === 1) return escaped.join('');

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
  return escaped.slice(0, bestIdx + 1).join('') + '\\N' + escaped.slice(bestIdx + 1).join('');
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

export function buildAss({ assPath, segments, win, year, season, title, subsOverride, endcardSec, djName, songCard }) {
  const dur = win.dur;
  const total = dur + endcardSec;
  const seasonJP = SEASON_JP[season] ?? '';

  let subEvents;
  if (subsOverride) {
    const lines = subsOverride.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const slot = dur / Math.max(1, lines.length);
    subEvents = lines.map((text, i) => ({ start: i * slot, end: (i + 1) * slot, text: assEscape(text) }));
  } else {
    subEvents = segmentsToEvents(segments, win.t0, win.t1);
  }

  const styles = [
    // Name,Fontname,Fontsize,Primary,Secondary,Outline,Back,Bold,Italic,U,S,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,ML,MR,MV,Encoding
    'Style: Sub,Noto Sans JP,56,&H00FFFFFF,&H000000FF,&H00202020,&H80000000,1,0,0,0,100,100,0,0,1,3.4,2,2,72,72,430,1',
    'Style: Badge,Noto Serif JP,46,&H00B0D9E8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,2,0,1,2,1,7,54,54,64,1',
    'Style: Endcard,Noto Serif JP,66,&H00D8ECF5,&H00000000,&H00101010,&H90000000,0,0,0,0,100,100,0,0,1,3,3,5,90,90,0,1',
  ];

  const events = [];
  events.push(`Dialogue: 0,${assTime(0)},${assTime(total)},Badge,,0,0,0,,${assEscape(`${year}・${seasonJP}`)}`);
  for (const e of subEvents) {
    events.push(`Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Sub,,0,0,0,,${e.text}`);
  }
  // エンドカード＝感情の宛先をReDialに書き換える装置（Fable 2026-07-13 マーケ再設計）。
  // 型B（--song）: 曲予告クリフハンガー「♪ ここで『◯◯』が流れます／音楽つきのフル版は、ReDialで。」
  // 型A/C（既定）: 「♪ この続きに、あの頃の曲が流れます／ReDial——あなたの季節に、もう一度。」
  const endcard = songCard
    ? `♪ ここで「${assEscape(songCard)}」が流れます\\N{\\fs40\\c&H00C8C8C8&}音楽つきのフル版は、ReDialで。`
    : `♪ この続きに、あの頃の曲が流れます\\N{\\fs40\\c&H00C8C8C8&}ReDial ——あなたの季節に、もう一度。`;
  events.push(`Dialogue: 0,${assTime(dur)},${assTime(total)},Endcard,,0,0,0,,${endcard}`);
  if (title) {
    // 冒頭に「何の話か」を平易に提示＋シンヤ名乗りで「これは深夜DJラジオ」という正体を毎回運ぶ。
    const djLine = djName ? `\\N{\\fs32\\c&H00B0B0B0&}${assEscape(djName)}` : '';
    events.push(`Dialogue: 0,${assTime(0)},${assTime(Math.min(3.6, dur))},Endcard,,0,0,1140,,{\\fs54\\c&H00F0F0F0&}${assEscape(title)}${djLine}`);
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
