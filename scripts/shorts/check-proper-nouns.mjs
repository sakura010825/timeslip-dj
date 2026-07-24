/**
 * 焼き上がったASS字幕に、既知の固有名詞の誤りが残っていないかを検査する（2026-07-22）。
 *
 * なぜ必要か:
 *   字幕はWhisper転写を元にしており、**同じ音声でも実行ごとに表記が変わる**（非決定的）。
 *   例: 1995春seg1 の「六甲道」は 六高堂 になったり正しく出たりする。
 *   そのためマニフェストの `fixes` を「今回の転写」に合わせて組んでも、次の焼き直しで
 *   別表記になって素通りする。人名・地名を1つ間違えると当事者世代の信頼を失うので、
 *   **投稿前に機械で止める**（2026-07-17「投稿前校正は必須」の恒久化）。
 *
 * 使い方: node scripts/shorts/check-proper-nouns.mjs
 *   終了コード 1 = 誤りが残っている（fixes に該当表記を足して焼き直す）
 *
 * 辞書の育て方: hideさんの試写や転写点検で新しい誤表記が出たら WRONG に足す。
 *   ここは「音は正しいが字幕の表記が誤り」を拾う場所。**音そのものの誤読は
 *   lib/tts-pronunciation-dict.ts（辞書＋再TTS）** の担当で、別問題。
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT_ROOT } from './util.mjs';

/** 誤表記 → 正しい表記。字幕に出たら不合格にする。 */
export const WRONG = {
  // 1995春 六甲道駅まわり（Whisperが実行ごとに揺れる）
  六高堂: '六甲道',
  六甲堂: '六甲道',
  路板: '路盤',
  三品田: '西灘',
  高架線網路: '高架線もろとも',
  // 人名
  松野太弥: '松任谷由実',
  松任谷由美: '松任谷由実',
  松忍太: '松任谷由実',
  雄鳴: 'ユーミン',
  雄名: 'ユーミン',
  加計夫: '掛布',
  千弁若山: '智弁和歌山',
  // 同じ人名でも実行ごとに別の誤り方をする（#9は 墓橋直子 と 高橋直子 の両方が出た）
  高橋直子: '高橋尚子',
  墓橋直子: '高橋尚子',
  // 一般語（音は正しいが表記が誤り）
  人魚のどこか: '日本のどこか',
  玉ぼっち: 'たまごっち',
  ガラスの少年: '硝子の少年',
  初秋から1位: '初週から1位',
  書いた詩と: '書いた詞と',
  調子の醤油: '銚子の醤油',
  三つの子: '三つの弧',
  神戸の町: '神戸の街',
  鼻の下: '花の下',
  // 日付（台本は「九月二十四日」＝正。Whisperが二十を十二に取り違えた）
  '9月12日4日': '9月24日',
};

/**
 * 構造的にありえない日付表記（2026-07-24）。
 *
 * なぜ辞書と別に要るか:
 *   WRONG は「一度見た誤り」しか捕まえられない。ところがWhisperの数字崩れは毎回違う形で出る
 *   （#9「九月二十四日」→「9月12日4日」）。人名と違って**日付は形が決まっている**ので、
 *   表記そのものではなく「形の破れ」で捕まえれば、初見の崩れ方でも止められる。
 *   日付はエピソードの事実そのもの＝間違えると当事者世代の信頼を失う（シドニー時差の件と同じ筋）。
 */
const IMPOSSIBLE = [
  { re: /\d+月\d+日\d+日/, why: '日が二重（◯月◯日◯日）' },
  { re: /\d+日\d+日/, why: '日が二重（◯日◯日）' },
  { re: /\d+月\d+月/, why: '月が二重（◯月◯月）' },
  { re: /\d+年\d+年/, why: '年が二重（◯年◯年）' },
];

const dir = path.resolve(OUT_ROOT);
const files = fs.readdirSync(dir).filter((f) => f.startsWith('.') && f.endsWith('.ass'));
let bad = 0;

for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const hits = Object.keys(WRONG).filter((w) => text.includes(w));
  // 形の検査は表示行ごとに見る（\N をまたぐ「…24日\N10月…」を誤検出しないため）
  const broken = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('Dialogue:')) continue;
    for (const seg of line.split(',').slice(9).join(',').split('\\N')) {
      const clean = seg.replace(/\{[^}]*\}/g, '');
      // 1箇所の崩れが複数パターンに当たる（◯月◯日◯日 は ◯日◯日 でもある）ので最初の1件だけ報告
      const p = IMPOSSIBLE.find((x) => x.re.test(clean));
      if (p) broken.push({ why: p.why, clean });
    }
  }
  if (hits.length || broken.length) {
    bad += hits.length + broken.length;
    console.log(`✗ ${f.slice(1)}`);
    for (const h of hits) console.log(`    「${h}」→「${WRONG[h]}」（manifest の fixes に足して焼き直す）`);
    for (const b of broken) console.log(`    日付の形が壊れています（${b.why}）: ${b.clean}`);
  }
}

console.log(`\n検査 ${files.length}本 / 誤り ${bad}件` + (bad ? '' : '  OK'));
if (bad) process.exitCode = 1;
