/**
 * 長尺アンカーの投稿用メタ生成: タイトル / 概要欄（UTM・チャプター・曲リスト）/ 字幕srt。
 * ⚠️ 長尺の概要欄URLは **クリック可能**（ショートとの決定的な違い＝二段導線の二段目・MARKETING_FUNNEL §3.1）。
 * 設計: redial/docs/ANCHOR_VIDEO_DESIGN_2026-07.md §6
 */
import fs from 'node:fs';

const HASHTAGS_BY_DECADE = {
  198: ['80年代', '昭和レトロ'],
  199: ['1990年代', '平成レトロ'],
  200: ['2000年代', 'ゼロ年代'],
};

/** 秒 → `M:SS` / `H:MM:SS`（YouTubeチャプター表記） */
export function ytTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 秒 → srtタイム `HH:MM:SS,mmm` */
function srtTime(sec) {
  const s = Math.max(0, sec);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  const ms = String(Math.round((s - Math.floor(s)) * 1000)).padStart(3, '0');
  return `${h}:${m}:${ss},${ms}`;
}

/**
 * YouTubeのチャプター要件に合わせて整える:
 * 先頭は必ず 0:00 ／ 昇順 ／ 各10秒以上 ／ 3つ以上。満たせない行は落とす。
 */
export function normalizeChapters(raw, total) {
  const sorted = [...raw].filter((c) => c.time != null).sort((a, b) => a.time - b.time);
  const out = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ ...c, time: 0 }); // 先頭は0:00に丸める（YouTube要件）
      continue;
    }
    if (c.time - prev.time < 10) continue; // 10秒未満の刻みは捨てる
    if (total - c.time < 10) continue; // 末尾10秒未満も捨てる
    out.push(c);
  }
  return out;
}

/** Whisper segments（talk item ごと）→ srt。offset = その item のタイムライン上の開始秒 */
export function writeSrt({ srtPath, talkSubs }) {
  const lines = [];
  let n = 1;
  for (const { offset, segments } of talkSubs) {
    for (const s of segments ?? []) {
      const text = (s.text ?? '').trim();
      if (!text) continue;
      lines.push(String(n++));
      lines.push(`${srtTime(s.start + offset)} --> ${srtTime(s.end + offset)}`);
      lines.push(text);
      lines.push('');
    }
  }
  fs.writeFileSync(srtPath, lines.join('\n'), 'utf8');
  return { srtPath, cues: n - 1 };
}

export function buildDescription({ job, url, chapters, songs, total, cellRanges }) {
  const year = job.cells[0].split('-')[0];
  const tags = [...(HASHTAGS_BY_DECADE[year.slice(0, 3)] ?? []), '懐かしい', '作業用BGM', '睡眠用'];

  const lead = job.lead
    ? job.lead
    : `深夜のタイムスリップDJ・シンヤが、${cellRanges.map((r) => r.label).join('／')}を通しで語ります。`;

  // 「音楽なし」を弱点ではなく約束として書く（出し惜しみが演出として成立する・MARKETING_FUNNEL §3.1）
  const fullLine = job.free
    ? 'この動画は、シンヤの声だけの通し版です。曲がまるごと流れる音楽つきのフル版は、登録なしで聴けます。'
    : 'この動画は、シンヤの声だけの通し版です。曲がまるごと流れる音楽つきのフル版は、ReDialで。';

  const parts = [
    lead,
    '作業のおともに、眠る前の聴き流しに。',
    '',
    fullLine,
    `🎧 ${url}`,
    '',
    '▼ チャプター',
    ...chapters.map((c) => `${ytTime(c.time)} ${c.label}`),
    '',
    '▼ この回でかかる曲（音楽つきフル版で流れます）',
    ...songs.map((s) => `・${s.title}${s.artist ? `／${s.artist}` : ''}`),
    '',
    'ReDial ——あなたの季節に、もう一度。',
    '1985年から2000年まで、あなたの年と季節を選ぶと、シンヤがその夜の回を編みます。',
    url,
    '',
    tags.map((t) => `#${t}`).join(' '),
  ];

  return parts.join('\n');
}

export function writeAnchorMeta({ job, outMp4, items, cellRanges, chapters, total, url, description }) {
  const songs = items.filter((i) => i.type === 'song').map((i) => ({
    time: i.start, title: i.title, artist: i.artist, cell: i.cell,
  }));
  const meta = {
    id: job.id,
    kind: job.cells.length > 1 ? 'compile' : 'single',
    cells: job.cells,
    title: job.title,
    durationSec: total,
    durationLabel: ytTime(total),
    free: !!job.free,
    url,
    chapters: chapters.map((c) => ({ time: c.time, at: ytTime(c.time), label: c.label })),
    songs,
    talk: items.filter((i) => i.type === 'talk').map((i) => ({
      cell: i.cell, seg: i.seg, segmentName: i.segmentName,
      start: +i.start.toFixed(2), dur: i.dur,
      estimatedDurationSec: i.estimatedDurationSec,
    })),
    description,
    note: '長尺の概要欄URLはクリック可能。ショート全本の関連動画リンクをこの動画へ向ける（MARKETING_FUNNEL §3.1）',
  };
  const metaPath = outMp4.replace(/\.mp4$/, '.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return metaPath;
}
