/**
 * 試写キット生成（2026-07-22）。
 *
 * なぜ必要か:
 *   ショートは15本あるが、hideさんに見てもらうべきは「15本それぞれの可否」ではなく
 *   **3つの型（A題材／B曲予告／C走馬灯）が広告として成立しているか**。型の判定が出れば
 *   残りは機械的に量産できる。逆に型がNGなら、量産した分だけ焼き直しになる。
 *   そこで **型ごとにまとめ、型ごとに「何を見るか」を明示した1枚** を出す。
 *
 *   Claudeが確認できるのは「曲名が漏れていないか」「字幕がはみ出していないか」まで。
 *   **クリフハンガーとして引っかかるか・問いが押しつけがましくないか は聴かないと分からない**
 *   （2026-07-17: フレーム目視・静的検査・Whisper検証を全部通してもTTSの誤読が残り、
 *   hideさんの耳で初めて出た）。この境界を明記して、判断の焦点を渡す。
 *
 * 出力: output/shorts/REVIEW_KIT.md（.gitignore 配下）
 * usage: node scripts/make-review-kit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { readJson, OUT_ROOT } from './shorts/util.mjs';

const SHORTS_OUT = path.resolve(OUT_ROOT);

const metas = fs.readdirSync(SHORTS_OUT)
  .filter((f) => f.endsWith('.json'))
  .map((f) => readJson(path.join(SHORTS_OUT, f)))
  .filter((j) => typeof j.id === 'number')
  .sort((a, b) => a.id - b.id);

const typeOf = (j) => (j.song ? 'B' : j.walkingFlame ? 'C' : 'A');
const mp4Of = (j) => {
  const slug = (j.hook ?? 'clip').trim().replace(/[/\\:*?"'’`<>|]+/g, '').replace(/\s+/g, '-').slice(0, 40);
  const stem = j.walkingFlame ? `${j.cell}-walk-${slug}` : `${j.cell}-seg${j.seg}-${slug}`;
  return path.resolve(SHORTS_OUT, `${stem}.mp4`);
};
const dur = (j) => `${Math.round(j.window?.dur ?? 0)}秒`;

const TYPES = [
  {
    key: 'A',
    name: '型A（題材型）— 認知装置',
    n: 10,
    watch: [
      '**声だけで最後まで持つか**（無音自動再生でも字幕で成立するか）',
      '固有名詞の**読み**（人名・地名。ここは耳でしか分からない）',
      '冒頭のタイトル＋シンヤ名乗りで「これは深夜ラジオだ」と伝わるか',
      'エンドカード「♪ この続きに、あの頃の曲が流れます」で**ReDialに宛先が向くか**',
    ],
    verdict: '型Aは既に承認済みの形式。**今回は再レンダのみ**（字幕の折返しを直した）ので、崩れが無いかの確認で足ります。',
  },
  {
    key: 'B',
    name: '型B（曲予告クリフハンガー）— 主力広告',
    n: 4,
    watch: [
      '🎯 **切れ目で「続きが聴きたい」と思うか、それとも単に途中で終わった感じか**（これが型Bの生死）',
      '#11/#12/#14 は文が終わってから断つ／**#13 は「今夜最後の一曲は」で文の途中から断つ**。どちらが良いか',
      'カード「♪ ここで「◯◯」が流れます」を見て、**曲を聴きたくなるか**',
      '曲名・アーティスト名が**音にも字幕にも漏れていないか**（機械では通したが最終確認）',
      'カード表示2.4秒は、読み切るのに足りるか',
    ],
    verdict: '**型Bを量産してよいか**／切り方は #13型（文の途中）と #11型（文末）のどちらを標準にするか。',
  },
  {
    key: 'C',
    name: '型C（走馬灯型）— 年ダイヤルのデモ・個人化への導火線',
    n: 1,
    watch: [
      '🎯 **断片の切り替わりが飛びすぎていないか**（米→ポケベル→問い。0.12秒のフェードで繋いでいる）',
      '🎯 **最後の問い（シンヤの声）が、押しつけがましくないか**',
      '「1993年の秋」という額縁が最初と最後にあることで、**30秒で伝わる**ようになっているか',
      'エンドカード「あなたの秋は、何年ですか。」で**自分の年を考えたくなるか**',
      '断片3つ・39秒は長すぎないか',
    ],
    verdict: '**型Cを量産してよいか**／断片の数と長さの標準をどうするか。',
  },
];

const blocks = [`# ショート試写キット（全 ${metas.length} 本）

**自動生成: \`node scripts/make-review-kit.mjs\`**

## 見てほしいのは「15本の可否」ではなく「3つの型の可否」です

型の判定が出れば、残りは機械的に量産できます。逆に型がNGなら、量産した分だけ焼き直しになります。
**各型の1本目を見て違和感があれば、その型は止めてください**（残りを見る必要はありません）。

## Claudeが確認済みのこと／確認できないこと

| 確認済み（機械で通した） | **確認できない（hideさんの目と耳が要る）** |
|---|---|
| 字幕のはみ出し 0件・孤立行 0件 | **クリフハンガーとして引っかかるか** |
| 型Bの曲名漏れ 0件（検査で自動停止） | **問いが押しつけがましくないか** |
| 窓の一致スコア・尺・音声の連結 | **固有名詞の読み**（TTSの誤読は耳でしか出ない） |
| 字幕の固有名詞を原稿へ校正 | **背景と話が合っているか** |

> 2026-07-17 の経験: フレーム目視・静的検査・Whisper検証を全部通しても、
> TTSの誤読（「かけふまさやき」／西灘の破綻）は残り、**hideさんの耳で初めて出ました**。
`];

for (const t of TYPES) {
  const items = metas.filter((j) => typeOf(j) === t.key);
  if (!items.length) continue;
  blocks.push(`
---

# ${t.name}　（${items.length}本）

## この型で見てほしいこと

${t.watch.map((w) => `- ${w}`).join('\n')}

## 出してほしい判定

${t.verdict}

## 本数と再生ファイル
`);
  for (const j of items) {
    const p = mp4Of(j);
    blocks.push(`**#${j.id} ${j.hook}**（${j.cell}・${dur(j)}）${j.song ? ` — 予告する曲: **「${j.song}」**` : ''}
\`\`\`
${fs.existsSync(p) ? p : '⚠️ mp4 が見つかりません（' + p + '）'}
\`\`\`
`);
  }
}

blocks.push(`
---

## 判定の伝え方（この3つだけで足ります）

1. **型A**: 再レンダで崩れていないか → OK / 直すところ
2. **型B**: 量産してよいか → OK / NG（理由）／ 切り方の標準は #13型（文の途中）か #11型（文末）か
3. **型C**: 量産してよいか → OK / NG（理由）／ 断片の数と長さの標準

加えて、**誤読が聞こえたら本番号と聞こえた音**を教えてください（例「#12 の"かん"が変」）。
辞書に入れて次から直します（[[feedback-tts-misreading-patterns]] の恒久ループ）。

## 量産の待機列（判定が出たら即着手できます）

- **型B**: 各セルの \`stock.json\` の \`songAfter\` から機械的に選べる。残り候補＝
  2000春『TSUNAMI』／2000秋『月光』／1991春『KISS』／1993秋『きっと忘れない』ほか
- **型C**: 全セルの \`ending-2\` に同じ問いの構造がある＝どのセルでも作れる
- 8月の目標混成は A:B:C ≒ 8:8:4（Playbook §8.5）→ **型Bあと4本・型Cあと3本**で揃う
`);

fs.writeFileSync(path.join(SHORTS_OUT, 'REVIEW_KIT.md'), blocks.join('\n'));
console.log(`✅ output/shorts/REVIEW_KIT.md を生成（${metas.length} 本 / 型A ${metas.filter((j) => typeOf(j) === 'A').length}・型B ${metas.filter((j) => typeOf(j) === 'B').length}・型C ${metas.filter((j) => typeOf(j) === 'C').length}）`);
