/**
 * 字幕ASS生成: Whisper word ts → 文単位・13字前後で整形 → 年バッジ＋字幕＋エンドカードを1本のASSに。
 * 設計 §5。libassで描画（drawtext多重を避ける）。日本語フォントは fontsdir で渡す。
 */
import fs from 'node:fs';
import { assTime, normalizeForCompare } from './util.mjs';

const SEASON_JP = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

/** ASSテキスト用エスケープ（改行・オーバーライド記号の暴発防止） */
function assEscape(s) {
  return (s ?? '').replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim();
}

const SENT_END = /[。！？]$/;
const SOFT_BREAK = /[、」』）]$/;
const MAX_LINE = 15; // 全角15字前後・これを超えたら1回だけ改行（設計 §5.2）

/**
 * word列を [t0,t1] で切り、クリップ相対時刻で字幕イベントの配列を作る。
 * 返り値: [{ start, end, text }]（時刻はクリップ先頭=0基準）
 */
function buildSubEvents(words, t0, t1) {
  const dur = t1 - t0;
  const clip = words
    .filter((w) => w.end > t0 + 0.02 && w.start < t1 - 0.02)
    .map((w) => ({
      text: w.word,
      s: Math.max(0, w.start - t0),
      e: Math.min(dur, w.end - t0),
    }));

  const events = [];
  let buf = null;
  const visLen = (s) => normalizeForCompare(s).length;

  // 区切りは「句読点境界（。！？」＝常に／、＝ある程度たまったら）」のみ。
  // 文節の途中で切らない（hideフィードバック 2026-07-13）。句読点なしで極端に長い場合だけ緊急区切り。
  const EMERGENCY = 26;
  for (const w of clip) {
    const wtext = w.text.replace(/\s+/g, '');
    if (!wtext) continue;
    if (!buf) buf = { start: w.s, end: w.e, text: '' };
    buf.text += wtext;
    buf.end = w.e;

    const vis = visLen(buf.text);
    const endsSentence = SENT_END.test(wtext);
    const endsSoft = SOFT_BREAK.test(wtext);
    if (endsSentence || (endsSoft && vis >= 8) || vis >= EMERGENCY) {
      events.push(flush(buf));
      buf = null;
    }
  }
  if (buf && buf.text) events.push(flush(buf));

  // 隣接イベントの時間が重ならないよう最小表示0.6s確保・末尾はdurへ
  for (let i = 0; i < events.length; i++) {
    if (events[i].end - events[i].start < 0.5) events[i].end = Math.min(dur, events[i].start + 0.6);
    if (i + 1 < events.length && events[i].end > events[i + 1].start) {
      events[i].end = Math.max(events[i].start + 0.4, events[i + 1].start - 0.02);
    }
  }
  return events;
}

function flush(buf) {
  // 先頭の読点類を落とすだけ。改行(\N)挿入は assEscape の後に行う（バックスラッシュ全角化を避ける）
  const text = buf.text.replace(/^[、。」』）\s]+/, '');
  return { start: buf.start, end: buf.end, text };
}

/** エスケープ済みテキストに、長い場合だけ中央付近の句読点で1回 \N を挿入する */
function wrapForAss(escaped) {
  if (normalizeForCompare(escaped).length <= MAX_LINE) return escaped;
  const mid = Math.floor(escaped.length / 2);
  let brk = mid;
  for (let d = 0; d < escaped.length; d++) {
    for (const i of [mid + d, mid - d]) {
      if (i > 1 && i < escaped.length - 1 && /[、。・]/.test(escaped[i - 1])) { brk = i; d = escaped.length; break; }
    }
  }
  return escaped.slice(0, brk) + '\\N' + escaped.slice(brk);
}

export function buildAss({ assPath, words, win, year, season, title, subsOverride, endcardSec }) {
  const dur = win.dur;
  const total = dur + endcardSec;
  const seasonJP = SEASON_JP[season] ?? '';

  let subEvents;
  if (subsOverride) {
    // 手直し字幕: 1行1字幕。時刻は均等割付（word時刻に頼らない安全策）
    const lines = subsOverride.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const slot = dur / Math.max(1, lines.length);
    subEvents = lines.map((text, i) => ({ start: i * slot, end: (i + 1) * slot, text: assEscape(text) }));
  } else {
    subEvents = buildSubEvents(words, win.t0, win.t1).map((e) => ({ ...e, text: wrapForAss(assEscape(e.text)) }));
  }

  const styles = [
    // Name,Fontname,Fontsize,Primary,Secondary,Outline,Back,Bold,Italic,U,S,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,ML,MR,MV,Encoding
    'Style: Sub,Noto Sans JP,58,&H00FFFFFF,&H000000FF,&H00202020,&H80000000,1,0,0,0,100,100,0,0,1,3.4,2,2,90,90,430,1',
    'Style: Badge,Noto Serif JP,46,&H00B0D9E8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,2,0,1,2,1,7,54,54,64,1',
    'Style: Endcard,Noto Serif JP,66,&H00D8ECF5,&H00000000,&H00101010,&H90000000,0,0,0,0,100,100,0,0,1,3,3,5,90,90,0,1',
  ];

  const events = [];
  // 年バッジ（全期間）
  events.push(`Dialogue: 0,${assTime(0)},${assTime(total)},Badge,,0,0,0,,${assEscape(`${year}・${seasonJP}`)}`);
  // 字幕
  for (const e of subEvents) {
    events.push(`Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Sub,,0,0,0,,${e.text}`);
  }
  // エンドカード（末尾 endcardSec）
  const endcard = `ReDial——あなたの季節に、もう一度。\\N{\\fs38\\c&H00C8C8C8&}フル版は音楽つき30分・プロフィールのリンクから`;
  events.push(`Dialogue: 0,${assTime(dur)},${assTime(total)},Endcard,,0,0,0,,${endcard}`);
  // タイトル（任意・冒頭2.5sだけ上部に大きく・フックの補強）
  if (title) {
    events.push(`Dialogue: 0,${assTime(0)},${assTime(Math.min(2.6, dur))},Endcard,,0,0,1180,,{\\fs52\\c&H00F0F0F0&}${assEscape(title)}`);
  }

  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 2',
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
