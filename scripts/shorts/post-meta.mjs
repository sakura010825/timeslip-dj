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
export function buildUrl({ cell, utm }) {
  const u = utm ?? { source: 'youtube', medium: 'short' };
  return `https://redial.jp/?utm_source=${u.source}&utm_medium=${u.medium}&utm_campaign=${cell}`;
}

export function hashtagsFor(cell) {
  const decadeKey = cell.split('-')[0].slice(0, 3);
  return HASHTAGS_BY_DECADE[decadeKey] ?? ['懐かしい'];
}

/**
 * 説明欄本文。**mp4 を焼き直さずに作り直せる**ように writeMeta から切り出してある
 * （URL規約が変わっても make-shorts-upload-kit.mjs の再実行だけで反映できる）。
 */
export function buildDescription({ cell, title, utm }) {
  const year = cell.split('-')[0];
  const tags = hashtagsFor(cell);
  return [
    title || `${year}年の、あの季節。`,
    '',
    `🎧 音楽つきのフルエピソード（無料）は プロフィールのリンクから`,
    buildUrl({ cell, utm }),
    '',
    tags.map((t) => `#${t}`).join(' '),
  ].join('\n');
}

export function writeMeta({ job, win, segmentName, mp3Path, outMp4 }) {
  const tags = hashtagsFor(job.cell);
  const utm = job.utm ?? { source: 'youtube', medium: 'short' };
  const description = buildDescription({ cell: job.cell, title: job.title, utm });

  const meta = {
    id: job.id,
    cell: job.cell,
    seg: job.seg,
    hook: job.hook,
    title: job.title,
    audience: job.audience,
    window: { start: win.t0, end: win.t1, dur: win.dur },
    source: { slug: job.cell, segmentName, audio: mp3Path.replace(/\\/g, '/') },
    description,
    utm,
    hashtags: tags,
    note: '説明欄URLはショートではクリック不能。送客は関連動画→長尺アンカー＋プロフィールリンク（MARKETING_FUNNEL §3.1）',
  };

  const metaPath = outMp4.replace(/\.mp4$/, '.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return metaPath;
}
