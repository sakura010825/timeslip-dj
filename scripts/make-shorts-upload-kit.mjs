/**
 * ショートの「アップロード・キット」生成（2026-07-17）。
 *
 * なぜ必要か:
 *   make-short.mjs は各本の mp4 と .json（タイトル/概要欄/ハッシュタグ）を吐くが、
 *   hideさんは JSON を10本ぶん読んでコピペする人ではない。**YouTube Studio の入力欄の順に
 *   並んだ1枚のテキスト**にして、上から順に貼れる状態にする（アンカーの make-upload-kit と同じ思想）。
 *
 * 二段導線の要:
 *   ショートは説明欄リンクがクリック不能。送客は各本の「関連動画」を**無料回アンカー（1990春）**へ
 *   向けることで成立する（登録なしでフル視聴できる唯一の回＝掴み→フル体験→サイトが完結する）。
 *   関連動画リンクは Studio でアップロード時に設定し、リンク先が既に公開済みである必要がある。
 *
 * 出力: output/shorts/UPLOAD_KIT.md（.gitignore 配下）
 *
 * usage:
 *   node scripts/make-shorts-upload-kit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { readJson, OUT_ROOT } from './shorts/util.mjs';
import { buildDescription } from './shorts/post-meta.mjs';

const SHORTS_OUT = path.resolve(OUT_ROOT); // output/shorts
const anchorsM = readJson(path.resolve('data', 'anchors.manifest.json'));
const freeAnchor = (anchorsM.anchors ?? []).find((a) => a.free) ?? null;
const ANCHOR_URL = freeAnchor?.url ?? '（未設定：アンカー公開後に data/anchors.manifest.json の url を埋める）';

// 現行の .json（_superseded は除外）を読み、id 順に
const metas = fs.readdirSync(SHORTS_OUT)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, j: readJson(path.join(SHORTS_OUT, f)) }))
  .filter((x) => typeof x.j.id === 'number')
  .sort((a, b) => a.j.id - b.j.id);

const blocks = [];
blocks.push(`# ショート初弾 アップロード・キット

**自動生成: \`node scripts/make-shorts-upload-kit.mjs\`（元データ = output/shorts/*.json）**
YouTube Studio の入力欄の順に並べてあります。上から順にコピペしてください。全 ${metas.length} 本。

## ⚠️ 先に確認: 関連動画リンク先（＝二段導線の実体）

全 ${metas.length} 本の「関連動画」を **無料回アンカー（1990春）** に向けます:
\`\`\`
${ANCHOR_URL}
\`\`\`
- なぜ全部これ1本か: 登録なしでフル版が聴ける唯一の回＝「掴み→フル体験→サイト」が完結する。ショートとアンカーのセル一致は不要（MARKETING_FUNNEL §3.1 / SHORTS_PLAYBOOK §8）。
- リンク先が**既に公開済み**である必要がある（1990春は公開済み）。
- Shorts は説明欄リンクがクリック不能なので、これが送客の主経路。加えてプロフィールのリンクも効く。

## 共通設定（全本同じ）

| 項目 | 値 |
|---|---|
| 公開設定 | 公開（または「スケジュール」で日時指定） |
| 視聴者 | **子ども向けではありません** |
| カテゴリ | エンターテイメント |
| 言語 | 日本語 |
| コメント | 許可（同窓会になる。返信はハートのみ＝世界観保護） |
| 関連動画 | 上記アンカー（1990春）を各本に設定 |

## 投稿ペース（一度にまとめて上げない）

点火スプリントは **X暖機 → ショート週3〜5本**。まとめて「スケジュール」で予約すると楽。

**型を混ぜる**（Playbook §8.5: 8月20本を A:B:C ≒ 8:8:4）。型A＝題材で掴む／
**型B＝曲予告クリフハンガー＝ReDialにしか作れない主力**。類型別に維持率と登録を読むため、
初週から両方を回す。

おすすめ初週の並び（掴みの強さ×客層の広さ・hide調整可）:
1. #10 ポケベル（型A・31秒・0840=おはようが一瞬で刺さる）
2. **#11 春よ、来い（型B・ユーミン・1995春）** — 型Bの代表として早めに出す
3. #3 プリクラ（型A・背景の質感・女性層）
4. **#12 愛は勝つ（型B・KAN・1990冬）**
5. #9 高橋尚子（型A・五輪定番・全世代）

2週目: #7 バックスクリーン / **#13 HOWEVER（型B）** / #8 生きろ。の夏 / **#14 卒業（型B）** /
#1 六甲道駅。以降 #2 B'z・#4 ガラケー・#5 コンビニ・#6 対戦台。
`);

for (const { j } of metas) {
  const mp4 = path.resolve(SHORTS_OUT, `${j.cell}-seg${j.seg}-${slug(j.hook)}.mp4`);
  const exists = fs.existsSync(mp4);
  blocks.push(`
---

## #${j.id} ${j.hook}（${j.cell}・${j.window?.dur ? Math.round(j.window.dur) + '秒' : ''}）${j.song ? `— **型B 曲予告**「${j.song}」` : j.walkingFlame ? '— **型C 走馬灯**（年ダイヤルのデモ）' : '— 型A 題材'} ／ 客層: ${j.audience ?? '—'}

**動画ファイル**
\`\`\`
${exists ? mp4 : '⚠️ mp4 が見つかりません（' + mp4 + '）'}
\`\`\`

**タイトル**（${j.title.length}字 / 上限100）
\`\`\`
${j.title}
\`\`\`

**説明**（そのまま全部貼る・末尾にプロフィールリンク導線とハッシュタグ入り）
\`\`\`
${buildDescription({ cell: j.cell, title: j.title, utm: j.utm, song: j.song, walkingFlame: j.walkingFlame })}
\`\`\`

**関連動画**（この動画にリンクする長尺）
\`\`\`
${ANCHOR_URL}
\`\`\`
`);
}

blocks.push(`
---

## アップロード後にやること

1. **全本の「関連動画」がアンカー（1990春）を指しているか**を1本ずつ確認（二段導線の要）
2. ショート用の再生リスト（任意）にまとめておくと後で導線を張り替えやすい
3. 数字を読む: 類型別に維持率 / プロフィールリンクのクリック / サイト側 UTM（\`utm_medium=short\`）/ 登録。
   **サイト側は \`/admin\` の「2. ファネル・会員KPI」の 訪問(landing) と「4. SNS反応」で見る**（Vercel Analytics でも見える）

## 字幕について

**焼き込み済みの字幕がすでに入っています**（各本、投稿前に固有名詞を校正済み）。
YouTube の自動字幕はオフでも構いません（二重字幕を避ける）。
`);

fs.writeFileSync(path.join(SHORTS_OUT, 'UPLOAD_KIT.md'), blocks.join('\n'));
console.log(`✅ output/shorts/UPLOAD_KIT.md を生成（${metas.length} 本・関連動画=${ANCHOR_URL}）`);

// hook → ファイル名スラグ（make-short.mjs / util.slugifyHook と同じ規則）
function slug(s) {
  return (s ?? 'clip').trim().replace(/[\/\\:*?"'’`<>|]+/g, '').replace(/\s+/g, '-').slice(0, 40);
}
