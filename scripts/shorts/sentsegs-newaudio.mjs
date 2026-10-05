// 2026-10-01 第10バッチの新作（本編に無い話を新しく読み上げた音声）で使った道具を残したもの。
// 原稿の文ごとに Whisper キャッシュの segments を置き直す（語の時刻で文の頭を探し、直前の無音の真ん中で区切る）。
// 2026-10-05 第11バッチ（N5〜N8）の items に書き換えた。無音が見つからない境は語の頭の0.05秒前で区切る（「ラブ・ラブ・ラブ。その年」）。
// 🔴 境は必ず聞き直して確かめる: 10/5 は語の時刻が文頭で早く出て0.5秒早い境が出た／「近くでいちばん長い無音」に寄せると読点の間（「安田成美と、」）を文の境と取り違えた。
// 次に新作を作るときは items を書き換えて `node scripts/shorts/sentsegs-newaudio.mjs` で回す（make-short の --dry-run でキャッシュを作った後）。
// 新作の字幕を「原稿の文ごと」に置き直す。
// 文字起こし（whisper-1）の語の時刻で各文の頭を探し、その直前の無音の真ん中を文の切れ目にする。
// 結果を Whisper キャッシュの segments に書き戻す（sig と words はそのまま＝make-short がそのまま使う）。
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const CACHE = "C:/Users/user/dev/timeslip-dj/output/shorts/.cache";
const STOCK = "C:/Users/user/dev/timeslip-dj/data/short-stock";
const items = [
  { cell: '1995-autumn-09', mp3: 'seg10-new-eva.mp3', anchors: ['1995年の秋', '新世紀エヴァンゲリオン', '18年たった', '夕方のテレビで'],
    lines: ['高橋洋子の、 『残酷な天使のテーゼ』。', '1995年の秋、 水曜の夕方に始まった、', '『新世紀エヴァンゲリオン』の、 主題歌。', '18年たった、 2013年にも、 カラオケの年間ランキングで、 2位だった。', '夕方のテレビで聴いた、 あの歌を、 大人になっても、 歌い続けていた。'] },
  { cell: '1992-summer', mp3: 'seg10-new-kimigairu.mp3', anchors: ['1992年', '安田なるみと', '曲はその年', '街のどこかで'],
    lines: ['米米CLUBの、 『君がいるだけで』。', '1992年、 月曜9時のドラマ、 『素顔のままで』の主題歌。', '安田成美と、 中森明菜が、 ふたりで主演したドラマだった。', '曲はその年、 いちばん売れた、 シングルになった。', '街のどこかで、 いつもこの曲が、 流れていた夏でした。'] },
  { cell: '1995-summer', mp3: 'seg10-new-aishiteru.mp3', anchors: ['1995年の夏', '耳の聞こえない', '主題歌は', 'その年'],
    lines: ['豊川悦司と、 常盤貴子の、 『愛していると言ってくれ』。', '1995年の夏の、 金曜のドラマ。', '耳の聞こえない画家に、 気持ちを伝えるために、 彼女は、 手話を覚えていった。', '主題歌は、 ドリカムの、 『ラブ・ラブ・ラブ』。', 'その年、 いちばん売れたシングルだった。'] },
  { cell: '1993-autumn', mp3: 'seg10-new-truelove.mp3', anchors: ['チェッカーズが', '月曜9時の', '売上は', '月曜の夜'],
    lines: ['藤井フミヤの、 『トゥルー・ラブ』。', 'チェッカーズが解散した、 次の年、 1993年の秋に、 ひとりで出したシングル。', '月曜9時のドラマ、 『あすなろ白書』の主題歌で、 オリコン5週連続1位。', '売り上げは、 200万枚を超えた。', '月曜の夜、 あのやさしい声が、 流れるのを、 待っていた秋でした。'] },
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
    if (!cand.length) { console.log(`  （${a} の手前に無音なし→語の頭 ${ws} の0.05秒前で区切る）`); return +((ws - 0.05).toFixed(2)); }
    const r = cand.reduce((x, y) => (Math.abs(y.b - ws) < Math.abs(x.b - ws) ? y : x));
    return +(((r.a + r.b) / 2).toFixed(2));
  });
  const bounds = [Math.max(0, vStart - 0.05), ...cuts, Math.min(fr.length * 0.05, vEnd + 0.1)];
  cache.segments = it.lines.map((t, i) => ({ text: t, start: bounds[i], end: bounds[i + 1] }));
  cache._sentSegsNote = "2026-10-05 新作: segments は原稿の文ごと（語の時刻で文の頭を探し、直前の無音の真ん中で区切った）。words は whisper-1 のまま。";
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  console.log(`■ ${it.cell}  声 ${vStart.toFixed(2)}〜${vEnd.toFixed(2)}`);
  for (const s of cache.segments) console.log(`   ${s.start.toFixed(2)}–${s.end.toFixed(2)}  ${s.text}`);
}
