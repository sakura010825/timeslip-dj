/**
 * 公開エピソードの「日付の読み上げ」を機械監査する（2026-07-24）。
 *
 * なぜ必要か:
 *   2000秋 seg1 の「九月二十四日」が、音声で **「くがつ じゅうに じゅうよっか」** と
 *   誤読されたまま公開されていた（hide試聴で発覚）。日の読みは不規則（1日=ついたち／
 *   20日=はつか／24日=にじゅうよっか…）で、TTSの典型的な失敗点。台本は正しいので
 *   校正では絶対に見つからず、**音を聴くまで分からない**。
 *   カタログ全体に漢数字の日付が87箇所あり、全部を人が聴くのは現実的でない。
 *
 * やること:
 *   台本の漢数字日付を算用数字に直し、同じ音声のWhisper転写に**その日付が現れるか**を見る。
 *   現れなければ、TTSが別の読み方をした疑い＝耳で確認する候補。
 *   あわせて「◯月◯日◯日」のような構造的にありえない形も拾う（誤読の直接の痕跡）。
 *
 * ⚠️ Whisperは数字表記が揺れる（非決定的）ので、これは**候補の絞り込み**であって判定ではない。
 *   出た箇所は必ず耳で確認する。逆に、出なかった箇所は概ね安全と見てよい。
 *
 * usage: node --env-file=.env.local scripts/audit-dates.mjs [--cell 2000-autumn]
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readJson } from './shorts/util.mjs';
import { locateSegAudio, getWords } from './shorts/resolve.mjs';

const args = parseArgs(process.argv.slice(2));
const STOCK = path.resolve('..', 'redial', 'data', 'stock');
const SCRIPTS = path.resolve('..', 'redial', 'data', 'scripts');

const K = '〇一二三四五六七八九十';
const DIGIT = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 漢数字（1〜31相当）を数値に。十の位は「十」記法を解く。 */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function kan2num(s) {
  if (!s) return null;
  if (!s.includes('十')) {
    let n = 0;
    for (const ch of s) {
      if (!(ch in DIGIT)) return null;
      n = n * 10 + DIGIT[ch];
    }
    return n;
  }
  const [hi, lo] = s.split('十');
  const h = hi === '' ? 1 : DIGIT[hi];
  const l = lo === '' ? 0 : DIGIT[lo];
  if (h == null || l == null) return null;
  return h * 10 + l;
}

const DATE_RE = new RegExp(`([${K}]{1,3})月([${K}]{1,3})日`, 'g');

/**
 * 日付の**正しい読み**。ここが監査の本体。
 * Whisperは同じ音声を算用数字・漢数字・ひらがなのどれで書くか一定しないので、
 * 「文字列が出てくるか」ではなく「**正しい読みのどれかで出てくるか**」を見る。
 * 日の読みは不規則（1=ついたち／4=よっか／20=はつか／24=にじゅうよっか）で、
 * ここがTTSの失敗点そのもの。よって表を持つこと自体が検査になる。
 */
const MONTH_KANA = ['', 'いちがつ', 'にがつ', 'さんがつ', 'しがつ', 'ごがつ', 'ろくがつ', 'しちがつ', 'はちがつ', 'くがつ', 'じゅうがつ', 'じゅういちがつ', 'じゅうにがつ'];
const MONTH_ALT = { 7: ['なながつ'], 9: ['きゅうがつ'] };
const DAY_KANA = ['', 'ついたち', 'ふつか', 'みっか', 'よっか', 'いつか', 'むいか', 'なのか', 'ようか', 'ここのか', 'とおか',
  'じゅういちにち', 'じゅうににち', 'じゅうさんにち', 'じゅうよっか', 'じゅうごにち', 'じゅうろくにち', 'じゅうしちにち', 'じゅうはちにち', 'じゅうくにち', 'はつか',
  'にじゅういちにち', 'にじゅうににち', 'にじゅうさんにち', 'にじゅうよっか', 'にじゅうごにち', 'にじゅうろくにち', 'にじゅうしちにち', 'にじゅうはちにち', 'にじゅうくにち', 'さんじゅうにち', 'さんじゅういちにち'];
// 話者によって許容される別読み（誤りではない）
const DAY_ALT = { 17: ['じゅうななにち'], 19: ['じゅうきゅうにち'], 27: ['にじゅうななにち'], 29: ['にじゅうきゅうにち'] };

function readingsFor(mm, dd) {
  const ms = [MONTH_KANA[mm], ...(MONTH_ALT[mm] ?? [])].filter(Boolean);
  const ds = [DAY_KANA[dd], ...(DAY_ALT[dd] ?? [])].filter(Boolean);
  const out = [];
  for (const m of ms) for (const d of ds) out.push(m + d);
  return out;
}

/** 構造的にありえない日付表記（誤読の直接の痕跡） */
const IMPOSSIBLE = [
  { re: /\d+月\d+日\d+日/, why: '日が二重' },
  { re: /\d+日\d+日/, why: '日が二重' },
  { re: /\d+月\d+月/, why: '月が二重' },
  { re: /\d+年\d+年/, why: '年が二重' },
];

const cells = args.cell
  ? [String(args.cell)]
  : fs.readdirSync(STOCK).filter((d) => fs.existsSync(path.join(STOCK, d, 'segments'))).sort();

let checked = 0;
let missing = 0;
let broken = 0;

for (const cell of cells) {
  const sp = path.join(SCRIPTS, `${cell}-v1.json`);
  if (!fs.existsSync(sp)) continue;
  const segments = readJson(sp).segments ?? [];

  for (let i = 0; i < segments.length; i++) {
    const script = (segments[i].script ?? '').toString();
    const want = [...script.matchAll(DATE_RE)]
      .map((m) => ({ raw: m[0], mm: kan2num(m[1]), dd: kan2num(m[2]) }))
      .filter((d) => d.mm && d.dd);
    if (!want.length) continue;

    let text;
    try {
      const { mp3Path } = locateSegAudio(cell, i);
      const data = await getWords(cell, i, mp3Path);
      text = (data.text ?? '').replace(/[\s,、]/g, '');
    } catch (e) {
      console.log(`?  ${cell} seg${i}  転写を取得できません: ${e.message}`);
      continue;
    }

    for (const d of want) {
      checked++;
      // 算用数字 / 漢数字そのまま / 正しいかな読み のいずれかで出ていれば合格
      const forms = [
        new RegExp(`${d.mm}月${d.dd}(日|$|[^\\d])`),
        new RegExp(escapeRe(d.raw)),
        ...readingsFor(d.mm, d.dd).map((r) => new RegExp(escapeRe(r))),
      ];
      if (forms.some((re) => re.test(text))) continue;
      missing++;
      const near = text.match(new RegExp(`.{0,20}(${d.mm}月|${escapeRe(d.raw)}|${MONTH_KANA[d.mm]}).{0,20}`));
      console.log(`✗ ${cell} seg${i}  台本「${d.raw}」= ${d.mm}月${d.dd}日 の正しい読みが転写に無い`);
      if (near) console.log(`     転写の該当付近: …${near[0]}…`);
    }

    for (const p of IMPOSSIBLE) {
      const m = text.match(new RegExp(p.re.source, 'g'));
      if (m) {
        broken += m.length;
        console.log(`‼ ${cell} seg${i}  日付の形が壊れています（${p.why}）: ${m.join(' / ')}`);
        break;
      }
    }
  }
}

console.log(`\n日付 ${checked} 箇所を検査 → 転写に出ない ${missing} 件 / 形が壊れている ${broken} 件`);
console.log('※ 出た箇所は耳で確認すること。Whisperの数字表記は揺れるため、これは候補の絞り込み。');
if (missing || broken) process.exitCode = 1;
