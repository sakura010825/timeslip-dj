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

export function writeMeta({ job, win, segmentName, mp3Path, outMp4 }) {
  const year = job.cell.split('-')[0];
  const decadeKey = year.slice(0, 3);
  const tags = HASHTAGS_BY_DECADE[decadeKey] ?? ['懐かしい'];
  const utm = job.utm ?? { source: 'youtube', medium: 'shorts' };
  const url = `https://redial.jp/episodes?utm_source=${utm.source}&utm_medium=${utm.medium}&utm_campaign=${job.cell}`;

  const description = [
    job.title || `${year}年の、あの季節。`,
    '',
    `🎧 音楽つきのフルエピソード（無料）は プロフィールのリンクから`,
    url,
    '',
    tags.map((t) => `#${t}`).join(' '),
  ].join('\n');

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
    hashtags: tags,
    note: '説明欄URLはショートではクリック不能。送客は関連動画→長尺アンカー＋プロフィールリンク（MARKETING_FUNNEL §3.1）',
  };

  const metaPath = outMp4.replace(/\.mp4$/, '.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return metaPath;
}
