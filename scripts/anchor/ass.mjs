/**
 * 長尺アンカーのASS生成（16:9 / PlayRes 1920x1080）。
 * 焼き込むのは「額縁」だけ＝年バッジ・タイトル板・季節カード・曲予告カード・エンドカード。
 * トーク字幕は焼き込まず .srt を別出し（YouTubeの字幕アップロード用・meta.mjs）。
 * 設計: redial/docs/ANCHOR_VIDEO_DESIGN_2026-07.md §4
 */
import fs from 'node:fs';
import { assTime } from '../shorts/util.mjs';

function assEscape(s) {
  return (s ?? '').replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim();
}

/**
 * 日本語を \N で折り返す。libassは空白の無い日本語を自動改行してくれず、
 * 長いタイトルが画面外へはみ出すため（2026-07-15の初レンダで実際に発生）、こちらで折る。
 * 句読点・中黒・ダッシュの直後を優先し、無ければ maxPerLine で強制的に折る。
 */
export function wrapJa(text, maxPerLine = 22) {
  const s = assEscape(text);
  if (s.length <= maxPerLine) return s;
  const lines = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    cur += s[i];
    const atBreak = /[、。・]/.test(s[i]) || /^(——|—)$/.test(s.slice(i - 1, i + 1));
    if (cur.length >= maxPerLine || (atBreak && cur.length >= maxPerLine * 0.6)) {
      lines.push(cur);
      cur = '';
    }
  }
  if (cur) lines.push(cur);
  return lines.join('\\N');
}

/** 全画面スクリム（カード時に背景を沈める）。libassの描画モードで矩形を1枚置く。 */
function scrim(start, end, alphaHex = '&H50&') {
  return `Dialogue: 0,${assTime(start)},${assTime(end)},Scrim,,0,0,0,,{\\fad(300,300)\\p1\\an7\\pos(0,0)\\c&H000000&\\alpha${alphaHex}}m 0 0 l 1920 0 l 1920 1080 l 0 1080{\\p0}`;
}

/** サムネイル用ASS（1920x1080で描いて1280x720に縮小）。年号を大書き＋一行のフック。 */
export function buildThumbAss({ assPath, year, seasonJP, hook }) {
  const styles = [
    'Style: Year,Noto Serif JP,300,&H00E6F3F8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,12,0,1,4,3,5,80,80,120,1',
    // サムネのフックは「スマホの一覧で読めるか」が基準（1280x720に縮小され、さらに一覧では約300px幅になる）
    'Style: Hook,Noto Serif JP,96,&H00D8ECF5,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,3,0,1,4,2,2,110,110,96,1',
    'Style: Mark,Noto Serif JP,40,&H00A8C4D0,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,3,0,1,2,1,9,60,60,60,1',
    'Style: Scrim,Noto Sans JP,10,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
  ];
  const events = [
    scrim(0, 5, '&H60&').replace('\\fad(300,300)', ''),
    `Dialogue: 0,${assTime(0)},${assTime(5)},Year,,0,0,0,,${assEscape(`${year}・${seasonJP}`)}`,
    `Dialogue: 0,${assTime(0)},${assTime(5)},Mark,,0,0,0,,ReDial`,
  ];
  if (hook) events.push(`Dialogue: 0,${assTime(0)},${assTime(5)},Hook,,0,0,0,,${wrapJa(hook, 16)}`);

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
  return { assPath };
}

export function buildAnchorAss({
  assPath, items, cellRanges, total, title, djName, endcardSec, siteLabel,
}) {
  const styles = [
    // Name,Fontname,Fontsize,Primary,Secondary,Outline,Back,Bold,Italic,U,S,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,ML,MR,MV,Encoding
    'Style: Badge,Noto Serif JP,44,&H00B0D9E8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,2,0,1,2,1,7,56,56,52,1',
    'Style: Card,Noto Serif JP,64,&H00E6F3F8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,1,0,1,3,2,5,140,140,0,1',
    'Style: Season,Noto Serif JP,110,&H00D8ECF5,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,8,0,1,3,2,5,140,140,0,1',
    'Style: Title,Noto Serif JP,58,&H00F0F0F0,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,0,0,1,3,2,5,160,160,0,1',
    'Style: Scrim,Noto Sans JP,10,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
  ];

  const events = [];

  // 年バッジ＝この動画が「いつの回か」を全編通して掲げる額縁。DJ名乗りを添えて正体を運ぶ（SHORTS_PLAYBOOK §8.1）
  for (const r of cellRanges) {
    const dj = djName ? `\\N{\\fs26\\c&H00909090&}${assEscape(djName)}` : '';
    events.push(`Dialogue: 0,${assTime(r.start)},${assTime(r.end)},Badge,,0,0,0,,${assEscape(`${r.year}・${r.seasonJP}`)}${dj}`);
  }

  // オープニングのタイトル板（6秒）。※YouTube用の長いSEOタイトルではなく、画面用の短い題を渡すこと。
  // 配列で渡せば1要素=1行（改行位置を明示できる）。文字列なら自動折り返し。
  if (title) {
    const titleText = Array.isArray(title)
      ? title.map((l) => assEscape(l)).filter(Boolean).join('\\N')
      : wrapJa(title, 22);
    events.push(scrim(0, 6, '&H70&'));
    events.push(`Dialogue: 0,${assTime(0)},${assTime(6)},Title,,0,0,0,,{\\fad(400,500)}${titleText}`);
  }

  for (const it of items) {
    if (it.type === 'season') {
      // 合本の章扉＝「ぜんぶ◯◯年」の額縁
      events.push(scrim(it.start, it.start + it.dur, '&H40&'));
      events.push(`Dialogue: 0,${assTime(it.start)},${assTime(it.start + it.dur)},Season,,0,0,0,,{\\fad(400,400)}${assEscape(it.label)}`);
    } else if (it.type === 'song') {
      // 曲スロット予告カード＝「流れない曲」をCTAに変える装置（MARKETING_FUNNEL §3.1-3）
      const end = it.start + it.dur;
      events.push(scrim(it.start, end, '&H38&'));
      const artist = it.artist ? `\\N{\\fs42\\c&H00C8C8C8&}${assEscape(it.artist)}` : '';
      const cta = `\\N\\N{\\fs38\\c&H00A8C4D0&}音楽つきのフル版は${assEscape(siteLabel)}`;
      events.push(
        `Dialogue: 0,${assTime(it.start)},${assTime(end)},Card,,0,0,0,,{\\fad(300,300)}♪ ここで「${assEscape(it.title)}」が流れます${artist}${cta}`,
      );
    }
  }

  // エンドカード
  const endStart = total - endcardSec;
  events.push(scrim(endStart, total, '&H30&'));
  events.push(
    `Dialogue: 0,${assTime(endStart)},${assTime(total)},Card,,0,0,0,,{\\fad(500,300)}ReDial ——あなたの季節に、もう一度。\\N\\N{\\fs38\\c&H00A8C4D0&}音楽つきのフルエピソードは${assEscape(siteLabel)}`,
  );

  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
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
  return { assPath, eventCount: events.length };
}
