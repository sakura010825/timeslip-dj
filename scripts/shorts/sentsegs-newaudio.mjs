// 2026-10-01 第10バッチの新作（本編に無い話を新しく読み上げた音声）で使った道具を残したもの。
// 原稿の文ごとに Whisper キャッシュの segments を置き直す（語の時刻で文の頭を探し、直前の無音の真ん中で区切る）。
// 次に新作を作るときは items を書き換えて `node scripts/shorts/sentsegs-newaudio.mjs` で回す（make-short の --dry-run でキャッシュを作った後）。
// 新作の字幕を「原稿の文ごと」に置き直す。
// 文字起こし（whisper-1）の語の時刻で各文の頭を探し、その直前の無音の真ん中を文の切れ目にする。
// 結果を Whisper キャッシュの segments に書き戻す（sig と words はそのまま＝make-short がそのまま使う）。
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const CACHE = "C:/Users/user/dev/timeslip-dj/output/shorts/.cache";
const STOCK = "C:/Users/user/dev/timeslip-dj/data/short-stock";
const items = [
  {
    cell: "1996-spring", mp3: "seg10-new-longvacation.mp3",
    anchors: ["1996年の春", "月曜はOL", "ピアニスト役", "月曜の夜9時"],
    lines: [
      "木村拓哉と山口智子の、 『ロングバケーション』。",
      "1996年の春に始まって、 最終回は36.7%。",
      "月曜はOLが、 街から消える、 と言われた。",
      "ピアニスト役の影響で、 ピアノを習い始める、 男の人まで増えた。",
      "月曜の夜9時が、 待ち遠しかった春でした。",
    ],
  },
  {
    cell: "1985-spring", mp3: "seg10-new-onyanko.mp3",
    anchors: ["1985年の春", "名前の前に", "1986年には", "あの時間"],
    lines: [
      "おニャン子クラブ。",
      "1985年の春、 夕方5時の、 『夕やけニャンニャン』から、 生まれた。",
      "名前の前に、 会員番号がついて、 新田恵利は4番でした。",
      "1986年には、 オリコンの週間1位の、 半分以上が、 おニャン子関連の曲だった。",
      "あの時間、 急いで家に帰った人も、 いたはずです。",
    ],
  },
  {
    cell: "1990-winter", mp3: "seg10-new-tokyolovestory.mp3",
    anchors: ["1991年の冬", "月曜の夜9時", "主題歌は", "あのイントロ"],
    lines: [
      "鈴木保奈美と織田裕二の、 『東京ラブストーリー』。",
      "1991年の冬に始まって、 最終回は、 32%を超えた。",
      "月曜の夜9時、 繁華街から人が消える、 と言われた。",
      "主題歌は、 小田和正の、 『ラブ・ストーリーは突然に』。",
      "あのイントロを聴くと、 月曜の夜に戻る人が、 いるはずです。",
    ],
  },
  {
    cell: "1999-winter", mp3: "seg10-new-lovemachine.mp3",
    anchors: ["1999年の9月", "グループで初めて", "加入してまだ", "年の瀬の"],
    lines: [
      "モーニング娘。の、 『LOVEマシーン』。",
      "1999年の9月に出て、 初登場1位から、 3週連続の首位。",
      "グループで初めての、 ミリオンセラーになった。",
      "加入してまだ18日、 13歳の後藤真希も、 そこで歌っていた。",
      "年の瀬のカラオケで、 声をそろえた人も、 いたはずです。",
    ],
  },
];

const norm = (s) => s.replace(/[\s、。「」『』・,.!?！？]/g, "");
function frames(mp3) {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", mp3, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], { maxBuffer: 1 << 27 });
  const out = [];
  for (let i = 0; i + 1600 <= pcm.length; i += 1600) { let s = 0; for (let j = 0; j < 800; j++) { const v = pcm.readInt16LE(i + j * 2) / 32768; s += v * v; } out.push(10 * Math.log10(s / 800 + 1e-12)); }
  return out;
}
for (const it of items) {
  const cachePath = `${CACHE}/${it.cell}-seg10.words.json`;
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const words = cache.words.map((w) => ({ t: norm(w.word), s: w.start, e: w.end }));
  let text = "", map = [];
  for (const [i, w] of words.entries()) for (const ch of w.t) { text += ch; map.push(i); }
  const fr = frames(`${STOCK}/${it.cell}/segments/${it.mp3}`);
  const quiet = fr.map((d) => d < -45);
  const vStart = quiet.indexOf(false) * 0.05, vEnd = (quiet.lastIndexOf(false) + 1) * 0.05;
  // 無音の区間
  const runs = [];
  for (let i = 0; i < quiet.length; i++) if (quiet[i]) { let j = i; while (j < quiet.length && quiet[j]) j++; runs.push({ a: i * 0.05, b: j * 0.05 }); i = j; }
  const cuts = it.anchors.map((a) => {
    const k = text.indexOf(norm(a));
    if (k < 0) throw new Error(`${it.cell}: 「${a}」が文字起こしに無い`);
    const ws = words[map[k]].s;
    // 文の頭（語の開始）に最も近い「その手前で終わる無音」の真ん中（±0.7秒）
    const cand = runs.filter((r) => r.b <= ws + 0.35 && r.b >= ws - 1.0 && r.a > vStart);
    if (!cand.length) throw new Error(`${it.cell}: 「${a}」(${ws}) の手前に無音が無い`);
    const r = cand.reduce((x, y) => (Math.abs(y.b - ws) < Math.abs(x.b - ws) ? y : x));
    return +(((r.a + r.b) / 2).toFixed(2));
  });
  const bounds = [Math.max(0, vStart - 0.05), ...cuts, Math.min(fr.length * 0.05, vEnd + 0.1)];
  cache.segments = it.lines.map((t, i) => ({ text: t, start: bounds[i], end: bounds[i + 1] }));
  cache._sentSegsNote = "2026-10-01 新作: segments は原稿の文ごと（語の時刻で文の頭を探し、直前の無音の真ん中で区切った）。words は whisper-1 のまま。";
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  console.log(`■ ${it.cell}  声 ${vStart.toFixed(2)}〜${vEnd.toFixed(2)}`);
  for (const s of cache.segments) console.log(`   ${s.start.toFixed(2)}–${s.end.toFixed(2)}  ${s.text}`);
}
