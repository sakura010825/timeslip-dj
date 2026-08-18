/**
 * 投稿用メタ生成。title/description(UTM)/hashtags を mp4 と同名の .json に。設計 §11。
 * ⚠️ 説明欄URLはショートではクリック不能（MARKETING_FUNNEL §3.1）。コピペ用に残すのみ。
 */
import fs from 'node:fs';
import path from 'node:path';

// ⚠️ **「平成レトロ」を外した**（2026-07-30）。あれはZ世代の語彙で、当時を生きた40〜55代には
//    当たらない（`feedback_x_follow_vetting_playbook`: 鉱脈の選定で実地に確認済み）。
//    代わりに**その回の西暦そのもの**を先頭に置く。同世代は「1991年」で自分の年齢に換算するので、
//    美学ラベル（〜レトロ）より具体的な年のほうが届く。タイトルの原則と同じ思想
//    （`SHORTS_PLAYBOOK` §8.2-c: 当時しか通じない固有名詞・数字を先頭に置く）。
//    「昭和レトロ」は残してあるが、80年代回を出すときに数字を見て再検討する余地がある。
const DECADE_TAG = { 198: '80年代', 199: '90年代', 200: '2000年代' };
// 題材タグが無い本だけに足す一般語。**最後の手段**（下のコメント参照）
const GENERIC_TAG = { 198: '昭和レトロ', 199: '懐かしい', 200: '懐かしい' };

/**
 * 着地URL。`redial/docs/UTM_CONVENTION_2026-07.md` の標準形式に従う。
 * - medium は `short`（単数）。`shorts` は規約外＝/admin の集計で別枠になる
 * - パスは**セル直行 `/episodes/{cell}`**（2026-08-03〜）。トップ着地だと視聴者が
 *   目当ての回をもう一度探すことになり、おかえりバナーと campaign 別の試聴セグ
 *   出し分け（redial `lib/site.ts` TEASER_CAMPAIGN_SEGMENTS）の受け皿も
 *   エピソードページ側にある。LandingPing はレイアウトに引き上げ済みなので
 *   landing はどのパスでも立つ（2026-07-22の「トップにしか無い」問題は解消済み。
 *   セル直行は 2026-08-03 の実投稿で計測実証済み）。
 */
export function buildUrl({ cell, utm, song, walkingFlame, platform, campaign }) {
  // platform を渡すと source を差し替える（同じ縦動画を Instagram Reels にも出すため。
  // 2026-07-30: 40〜50代の利用率は Instagram 48.5%・TikTok は30代で26.8%と薄いので Instagram を選んだ）。
  const u = platform
    ? { source: platform, medium: 'short' }
    : utm ?? { source: 'youtube', medium: 'short' };
  // campaign にセルだけを入れると、同じセルの型A（題材）と型B（曲予告）が
  // landing 計測で見分けられない。Playbook §8.5 は「類型別に維持率・登録・流入を読む」
  // ことを判定基準にしているので、識別子に型を含める（-a=題材 / -b=曲予告 / -c=走馬灯）。
  // 同セルに同型の2本目が出るときは manifest の `campaign` で明示する（例 `2000-spring-b2`）。
  // ⚠️ -b2 系は redial 側 TEASER_CAMPAIGN_SEGMENTS との一致が唯一の配線
  //    （UTM_CONVENTION §追記 2026-08-03）。自動導出はできないので必ず突き合わせる。
  const c = campaign ?? `${cell}-${song ? 'b' : walkingFlame ? 'c' : 'a'}`;
  return `https://redial.jp/episodes/${cell}?utm_source=${u.source}&utm_medium=${u.medium}&utm_campaign=${c}`;
}

/**
 * ハッシュタグ。**西暦 → 年代 → 題材** の順。
 *
 * ⚠️ **一般語の大タグは効かない**（2026-07-30 Instagram初投稿で実地に確認）。
 *   `#懐かしい` は投稿184.7万件。フォロワー0の新規アカウントが入れても投稿した瞬間に
 *   埋もれ、しかも「懐かしい」の対象が無限にあるので探している人がいない。
 *   一方 `#ストリートファイター2` `#ゲーセン` は母数が小さくても**全員が当事者**。
 *   → タイトルの原則（SHORTS_PLAYBOOK §8.2-c: 当時しか通じない固有名詞を先頭に）と同じ。
 *   題材タグがある本には一般語を足さない。
 *
 * 題材タグはマニフェストの `tags` に本ごとに書く（音声に無くてもよいが、題材と一致させる）。
 */
// hashtagYear: 冬セルは「1999-winter＝2000年1〜3月」のように暦年とずれる（#37 ビューティフルライフ）。
// 題名が言う年と #タグの年が食い違うと検索で拾われないので、manifest の hashtagYear で上書きできる。
export function hashtagsFor(cell, topicTags, hashtagYear) {
  const year = hashtagYear ? String(hashtagYear) : cell.split('-')[0];
  const decadeKey = year.slice(0, 3);
  const base = [`${year}年`, DECADE_TAG[decadeKey]].filter(Boolean);
  const topics = (topicTags ?? []).filter(Boolean);
  return topics.length ? [...base, ...topics] : [...base, GENERIC_TAG[decadeKey] ?? '懐かしい'];
}

/**
 * 説明欄本文。**mp4 を焼き直さずに作り直せる**ように writeMeta から切り出してある
 * （URL規約が変わっても make-shorts-upload-kit.mjs の再実行だけで反映できる）。
 */
export function buildDescription({ cell, title, utm, song, walkingFlame, platform, tags: topicTags, campaign, hashtagYear }) {
  const year = cell.split('-')[0];
  const tags = hashtagsFor(cell, topicTags, hashtagYear);
  return [
    title || `${year}年の、あの季節。`,
    '',
    // ⚠️ Shorts では説明欄のURLが押せない（YouTube仕様）。Reelsのキャプションも同様。
    // 「◯◯から」と書いた直後に押せないURLを並べると、視聴者は目の前のURLを押そうとして
    // 押せず離脱する（hide試写 2026-07-24）。押せないことを先に織り込んで視線の順序を直す。
    //
    // 宛先の変遷: 「プロフィール欄」→「タイトル下の▶」(2026-07-27)→**平文ドメイン**(2026-07-30)。
    // ▶（関連動画リンク）経由は 2,329再生に対し2クリック＝0.09%しか出なかった。加えて
    // 「タイトル下の▶」はYouTube専用の指示で、同じ動画を Instagram Reels に出せない。
    // どの面でも成立する文言に戻す（▶ の帯自体はYouTube側に自動で出るので導線は残る）。
    //
    // 型B（曲予告）は「この続き」と曲名で誘う（POST_2026-07-31 の型B文面を正とする。
    // ショートが切ったクリフハンガー——次にかかる曲——をそのまま受ける文言）。
    //
    // 2026-08-12（チャンネル活性化）: 「音楽つき」の一語では体験が伝わっていなかった
    // （チャンネル訪問者にReDialの喜び＝トークが本物の曲に流れ込む瞬間、がどこにも
    // 見えていない問題・hide指摘）。**曲が「そのまま／まるごと流れる」ことを1行目で言う**。
    // サイト側は「最初のひと晩」（登録=その夜1本まるごと解放）が入ったので約束は果たせる。
    song
      ? `🎧 この続きは redial.jp で——このトークのあとに、『${song}』がまるごと流れます。`
      : `🎧 このトークの続きに、当時の名曲がそのまま流れます。フルエピソード（無料）は redial.jp から。`,
    // IG だけ「プロフィールのリンク」を添える（2026-08-13）。IG で唯一ワンタップで押せる導線が
    // bio リンクなのに、キャプションはコピペしか案内していなかった（8/13朝、説明文URLを
    // 手でコピペした実流入が初観測＝読まれてはいる）。YT は関連動画▶が自動で出るので現状のまま。
    platform === 'instagram'
      ? `※ ここではURLが押せません——プロフィールのリンクからどうぞ（下のURLはコピー用）`
      : `※ ここではURLが押せません（コピー用）`,
    buildUrl({ cell, utm, song, walkingFlame, platform, campaign }),
    '',
    tags.map((t) => `#${t}`).join(' '),
  ].join('\n');
}

export function writeMeta({ job, win, winClips, segmentName, mp3Path, outMp4 }) {
  const tags = hashtagsFor(job.cell, job.tags, job.hashtagYear);
  const utm = job.utm ?? { source: 'youtube', medium: 'short' };
  const description = buildDescription({ cell: job.cell, title: job.title, utm, song: job.song, walkingFlame: job.walkingFlame, tags: job.tags, campaign: job.campaign, hashtagYear: job.hashtagYear });

  const meta = {
    id: job.id,
    cell: job.cell,
    seg: job.seg,
    hook: job.hook,
    title: job.title,
    audience: job.audience,
    window: { start: win.t0, end: win.t1, dur: win.dur },
    // 断片ごとの窓（型A/型Bは1件・型Cは複数）。窓の端が語の途中で切れていないかの検査が読む
    winClips: winClips ?? null,
    source: { slug: job.cell, segmentName, audio: mp3Path.replace(/\\/g, '/') },
    description,
    utm,
    // campaign の明示指定（-b2 系）。null なら buildUrl が型から導出した値が使われている
    campaign: job.campaign ?? null,
    // 型B判定に使う（アップロード・キットが型の表示とUTMの識別子に使う）
    song: job.song ?? null,
    walkingFlame: !!job.walkingFlame,
    hashtags: tags,
    // 題材タグの原本。キット再生成（make-shorts-upload-kit.mjs）が mp4 を焼き直さずに
    // 説明文を作り直せるよう、組み立て済みの hashtags とは別に生の指定を残す
    topicTags: job.tags ?? null,
    hashtagYear: job.hashtagYear ?? null,
    note: '説明欄URLはショートではクリック不能。送客は関連動画→長尺アンカー＋プロフィールリンク（MARKETING_FUNNEL §3.1）',
  };

  const metaPath = outMp4.replace(/\.mp4$/, '.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return metaPath;
}
