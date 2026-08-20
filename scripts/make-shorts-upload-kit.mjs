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

/**
 * 型D（トーク→曲）専用: 「ボーカルの入り」秒数の目安（2026-08-20・SHORTS_RECIPE §2-k′）。
 * 曲の実音源はリポジトリに無いため、WebSearchで確認した一般に知られる曲構造（イントロ長・
 * 歌い出しの通称）から算出した目安。id をキーに手で管理（曲ごとに調査結果が違うため自動化しない）。
 * 「頭出し位置」= ボーカルの入り − トーク実測秒数（残りのイントロがトークの下で鳴り、
 * トーク終了と同時にボーカルが来る計算）。**必ずアプリで試聴して微調整**——各エントリに明記。
 */
const SONGTAIL_VOCAL_NOTES = {
  40: { // 真夏の果実（サザンオールスターズ）
    talkSec: 14.2,
    vocalStart: '約18秒目（Re:minder「イントロ秒数徹底調査」シリーズ・グロッケン3音のイントロという記述は複数ソースで裏取り。正確な秒数の一次資料は無いため目安）',
    cueOffset: '約4秒目（18−14.2）から頭出し。曲の頭のグロッケン最初の1音だけ聴かせてから残り約14秒のイントロをトークの下で鳴らすイメージ',
  },
  41: { // TSUNAMI（サザンオールスターズ）
    talkSec: 14.8,
    vocalStart: '曲の頭からごく数秒（桑田佳祐本人が「イントロを必要としない」設計と証言・正確な秒数の情報源なし）',
    cueOffset: '⚠️他の2曲と違い頭出しで調整できる余裕のイントロが無い。0秒（曲の先頭）から鳴らすと、トーク後半とTSUNAMIの歌声が重なる可能性が高い。'
      + '対処: (a)【既定案】サウンドの音量をかなり絞り「トークの下でかすかに歌が聞こえる」程度に留めて0秒から頭出し（オリジナル=トーク音声を優先） '
      + '(b)投稿時にトークをさらに切り詰める (c)この回だけサウンド追加を見送り曲名テロップのみにする。必ずアプリで試聴のうえ判断を——他2本より難度が高い回です',
  },
  42: { // 硝子の少年（KinKi Kids）
    talkSec: 14.4,
    vocalStart: '約25〜30秒目（ピアノ主体の前奏15秒＋サビメロディーを辿るメインイントロ・情感のある展開・短い静止を経て歌い出し「あっ、めっ、がぁ」に入る、との複数ソース記述。前奏が2段階あるため合計秒数は構造からの推定で一次資料なし）',
    cueOffset: '約11〜16秒目（25〜30−14.4）から頭出し。ピアノ前奏の途中〜メインイントロ開始あたり。他の2曲よりイントロの見立ての不確実性が高いため特に試聴確認を',
  },
};

/**
 * 型D固有の「投稿前に直さないと事故る」警告（campaignルーティング等・id keyed）。
 * 2026-08-20: #41 TSUNAMIは redial/lib/site.ts の TEASER_CAMPAIGN_SEGMENTS に
 * '2000-spring-d' の登録が無いため、着地後の試聴セグメントが桜坂（既定seg2）に
 * フォールバックしてしまう（本来はTSUNAMI=seg3）。redialリポジトリ側の1行追記が必須。
 */
const SONGTAIL_ROUTING_WARNINGS = {
  41: '⚠️⚠️ **投稿前に redial リポジトリで要修正**: `lib/site.ts` の `TEASER_CAMPAIGN_SEGMENTS` に '
    + '`"2000-spring-d": 3,` が未登録（2026-08-20時点）。このまま投稿すると着地ページの試聴セグメントが'
    + '既定の桜坂（seg2）にフォールバックし、動画が約束した「続きはTSUNAMI」と違う曲が流れます。'
    + 'timeslip-dj からは編集できない（別リポジトリ）ため、投稿前に redial 側セッションで1行追記してデプロイすること。'
    + '（ついでに一報: `-d` サフィックスは UTM_CONVENTION_2026-07.md が既に「型D＝体験デモ（make-demo-short.mjs・'
    + 'Shortsフィード非掲載）」の意味で定義済み。今回の型D「トーク→曲」＝Shortsフィードに投稿する別物と'
    + 'サフィックスが衝突している。実害は無いが集計時の可読性のため要確認。）',
};

/** 型D固有のキット文面（IG注意＋アプリでのサウンド追加手順・SHORTS_RECIPE §2-k/§2-k′） */
function songTailBlock(j) {
  if (!j.songTail) return '';
  const note = SONGTAIL_VOCAL_NOTES[j.id];
  const routingWarning = SONGTAIL_ROUTING_WARNINGS[j.id];
  return `
**⚠️ 型D「トーク→曲」— mp4に曲は入っていません（曲区間${j.songTail.seconds}秒は無音）**
${routingWarning ? `\n${routingWarning}\n` : ''}
この動画はYouTubeアプリの「サウンドを追加」機能で**投稿時に曲を重ねて初めて完成**します（SHORTS_RECIPE §2-k′）。

- ナウプレイング札（動画内に焼き込み済み・確認用）: \`${j.songTail.nowPlaying}\`
- ボーカルの入り（目安・実音源未確認のためアプリで要確認）: ${note?.vocalStart ?? '（要確認）'}
- トーク実測: ${note?.talkSec ?? '—'}秒
- 頭出し位置の目安: ${note?.cueOffset ?? '（要確認）'}

**YouTubeアプリでの手順（PCのStudioではできません）**:
1. 投稿済みの動画を開く（またはアップロード画面）→ ギャラリーから選択
2. 「サウンドを追加」→ 曲を検索（アプリ内で検索に出るか要確認。0本表示でもライブラリにはあることがある＝可否の最終判定はアプリ内検索）
3. 頭出し（上記の目安位置までスクラブ）→ 実際に耳で聴いて「トーク終了の直後にボーカルが来る」位置に微調整
4. 音量ミックス（オリジナル=トーク音声を優先／サウンド=曲は耳で判断し「イントロが聞こえる程度」に）
5. タイトル・説明・関連動画を設定 → 22:00に予約投稿

**⚠️ Instagram には出さない**（無音区間のあるmp4はIGに不向き・SHORTS_RECIPE §2-k′）。3晩とも**在庫の別弾（トーク版）**をIGへ。**X**: 通常どおり140字＋動画添付可。
`;
}
const anchorsM = readJson(path.resolve('data', 'anchors.manifest.json'));
const freeAnchor = (anchorsM.anchors ?? []).find((a) => a.free) ?? null;
// 関連動画の既定 = **その週の中尺**（SNS_NIGHT_RITUAL A-2・2026-08-17〜）。中尺は説明欄のURLが押せるので
// ショート→中尺→サイトが唯一「タップだけ」で繋がる。公開済み（videoId あり）の最新の中尺を選び、
// 無ければ従来どおり無料フル版アンカー（1990春）。
const midformM = fs.existsSync(path.resolve('data', 'midform.manifest.json'))
  ? readJson(path.resolve('data', 'midform.manifest.json')) : { items: [] };
const latestMidform = (midformM.items ?? []).filter((x) => x.videoId && x.url)
  .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')))[0] ?? null;
const ANCHOR_URL = latestMidform?.url
  ?? freeAnchor?.url
  ?? '（未設定：アンカー公開後に data/anchors.manifest.json の url を埋める）';
const ANCHOR_LABEL = latestMidform
  ? `今週の中尺「${String(latestMidform.title ?? '').slice(0, 24)}…」（説明欄URLが押せる）`
  : '無料回アンカー（1990春）';

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

全 ${metas.length} 本の「関連動画」を **${ANCHOR_LABEL}** に向けます:
\`\`\`
${ANCHOR_URL}
\`\`\`
- なぜ全部これ1本か: 中尺は**説明欄のURLが押せる**（ショート→中尺→サイトが唯一タップだけで繋がる・SNS_NIGHT_RITUAL A-2）。中尺が無い週は無料回アンカー（登録なしでフル版が聴ける唯一の回）。ショートとリンク先のセル一致は不要（MARKETING_FUNNEL §3.1 / SHORTS_PLAYBOOK §8）。
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
| 関連動画 | 上記リンク先を各本に設定 |

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
  // 複数断片（型C・2断片の型B）は make-short.mjs が `{cell}-walk-{hook}` で名付ける（#15/#37）
  const multi = Array.isArray(j.winClips) && j.winClips.length > 1;
  const mp4 = path.resolve(SHORTS_OUT, multi ? `${j.cell}-walk-${slug(j.hook)}.mp4` : `${j.cell}-seg${j.seg}-${slug(j.hook)}.mp4`);
  const exists = fs.existsSync(mp4);
  blocks.push(`
---

## #${j.id} ${j.hook}（${j.cell}・${j.window?.dur ? Math.round(j.window.dur) + '秒' : ''}）${j.songTail ? `— **型D トーク→曲**「${j.song}」` : j.song ? `— **型B 曲予告**「${j.song}」` : j.walkingFlame ? '— **型C 走馬灯**（年ダイヤルのデモ）' : '— 型A 題材'} ／ 客層: ${j.audience ?? '—'}
${songTailBlock(j)}
**動画ファイル**
\`\`\`
${exists ? mp4 : '⚠️ mp4 が見つかりません（' + mp4 + '）'}
\`\`\`

**タイトル**（${j.title.length}字 / 上限100）
\`\`\`
${j.title}
\`\`\`

**説明（YouTube）**（そのまま全部貼る）
\`\`\`
${buildDescription({ cell: j.cell, title: j.title, utm: j.utm, song: j.song, walkingFlame: j.walkingFlame, tags: j.topicTags, campaign: j.campaign, hashtagYear: j.hashtagYear })}
\`\`\`

${j.songTail
    ? `**キャプション（Instagram Reels）**: ⚠️ **この動画はIGに出さない**（無音区間のあるmp4はIG不向き・上記参照）。3晩とも在庫の別弾（トーク版）をIGへ。`
    : `**キャプション（Instagram Reels）**（同じmp4をそのまま使える。UTMだけ instagram に差し替わっている）
\`\`\`
${buildDescription({ cell: j.cell, title: j.title, song: j.song, walkingFlame: j.walkingFlame, platform: 'instagram', tags: j.topicTags, campaign: j.campaign, hashtagYear: j.hashtagYear })}
\`\`\``}

**関連動画**（YouTubeのみ・この動画にリンクする長尺）
\`\`\`
${ANCHOR_URL}
\`\`\`
`);
}

blocks.push(`
---

## アップロード後にやること

1. **全本の「関連動画」が上記リンク先を指しているか**を1本ずつ確認（二段導線の要）
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
