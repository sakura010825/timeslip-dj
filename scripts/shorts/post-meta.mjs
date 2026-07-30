/**
 * 投稿用メタ生成。title/description(UTM)/hashtags を mp4 と同名の .json に。設計 §11。
 * ⚠️ 説明欄URLはショートではクリック不能（MARKETING_FUNNEL §3.1）。コピペ用に残すのみ。
 */
import fs from 'node:fs';
import path from 'node:path';

const HASHTAGS_BY_DECADE = {
  198: ['80年代', '昭和レトロ', '懐かしい'],
  199: ['1990年代', '平成レトロ', '懐かしい'],
  200: ['2000年代', 'ゼロ年代', '懐かしい'],
};

/**
 * 着地URL。`redial/docs/UTM_CONVENTION_2026-07.md` の標準形式に従う。
 * - medium は `short`（単数）。`shorts` は規約外＝/admin の集計で別枠になる
 * - パスはトップ `/`。以前は `/episodes` に着地させていたが、当時 LandingPing が
 *   トップにしか無く landing イベントが一件も立たなかった（2026-07-22に発覚）。
 *   受け皿はレイアウトへ引き上げ済みだが、着地先は規約どおりトップに揃える
 */
export function buildUrl({ cell, utm, song, walkingFlame, platform }) {
  // platform を渡すと source を差し替える（同じ縦動画を Instagram Reels にも出すため。
  // 2026-07-30: 40〜50代の利用率は Instagram 48.5%・TikTok は30代で26.8%と薄いので Instagram を選んだ）。
  const u = platform
    ? { source: platform, medium: 'short' }
    : utm ?? { source: 'youtube', medium: 'short' };
  // campaign にセルだけを入れると、同じセルの型A（題材）と型B（曲予告）が
  // landing 計測で見分けられない。Playbook §8.5 は「類型別に維持率・登録・流入を読む」
  // ことを判定基準にしているので、識別子に型を含める（-a=題材 / -b=曲予告）。
  const campaign = `${cell}-${song ? 'b' : walkingFlame ? 'c' : 'a'}`;
  return `https://redial.jp/?utm_source=${u.source}&utm_medium=${u.medium}&utm_campaign=${campaign}`;
}

export function hashtagsFor(cell) {
  const decadeKey = cell.split('-')[0].slice(0, 3);
  return HASHTAGS_BY_DECADE[decadeKey] ?? ['懐かしい'];
}

/**
 * 説明欄本文。**mp4 を焼き直さずに作り直せる**ように writeMeta から切り出してある
 * （URL規約が変わっても make-shorts-upload-kit.mjs の再実行だけで反映できる）。
 */
export function buildDescription({ cell, title, utm, song, walkingFlame, platform }) {
  const year = cell.split('-')[0];
  const tags = hashtagsFor(cell);
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
    `🎧 音楽つきのフルエピソード（無料）は redial.jp から。`,
    `※ ここではURLが押せません（コピー用）`,
    buildUrl({ cell, utm, song, walkingFlame, platform }),
    '',
    tags.map((t) => `#${t}`).join(' '),
  ].join('\n');
}

export function writeMeta({ job, win, winClips, segmentName, mp3Path, outMp4 }) {
  const tags = hashtagsFor(job.cell);
  const utm = job.utm ?? { source: 'youtube', medium: 'short' };
  const description = buildDescription({ cell: job.cell, title: job.title, utm, song: job.song, walkingFlame: job.walkingFlame });

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
    // 型B判定に使う（アップロード・キットが型の表示とUTMの識別子に使う）
    song: job.song ?? null,
    walkingFlame: !!job.walkingFlame,
    hashtags: tags,
    note: '説明欄URLはショートではクリック不能。送客は関連動画→長尺アンカー＋プロフィールリンク（MARKETING_FUNNEL §3.1）',
  };

  const metaPath = outMp4.replace(/\.mp4$/, '.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return metaPath;
}
