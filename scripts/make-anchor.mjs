/**
 * ReDial 長尺アンカー動画 生成CLI（T2-6 / 設計: redial/docs/ANCHOR_VIDEO_DESIGN_2026-07.md）
 *
 * 公開エピソードの「トークのみ通し版」を 16:9 mp4 にする。音はシンヤの声だけ・楽曲0秒。
 * 曲が流れるはずだった場所には「♪ ここで『◯◯』が流れます」の予告カードを差し、
 * 出し惜しみをそのままサイトへのCTAに変える（MARKETING_FUNNEL §3.1）。
 *
 * usage（manifest・推奨）:
 *   node --env-file=.env.local scripts/make-anchor.mjs --manifest data/anchors.manifest.json --only 1 [--dry-run]
 *
 * usage（単発）:
 *   node --env-file=.env.local scripts/make-anchor.mjs --cells 1995-autumn-09 --title "…" [--bg x.png] [--dry-run]
 *
 * 主要オプション:
 *   --dry-run           タイムライン・チャプター・尺を表示して終了（mp4を作らない）
 *   --print-transcript  dry-run時に各segの転写を時刻つきで表示（チャプター句の選定用）
 *   --no-transcribe     Whisperを叩かない（srt・アンカー句チャプターは作らず、seg見出しのみ）
 *   --meta-only         mp4を作り直さず、概要欄・チャプター・メタだけ再生成（URL変更時など）
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, ensureDir, readJson, OUT_ROOT } from './shorts/util.mjs';
import { getWords, findAnchorTime } from './shorts/resolve.mjs';
import { buildTimeline, parseCell } from './anchor/timeline.mjs';
import { normalizeChapters, buildDescription, writeAnchorMeta, writeSrt, ytTime } from './anchor/meta.mjs';

const args = parseArgs(process.argv.slice(2));
const DRY = !!args['dry-run'];
const TRANSCRIBE = !args['no-transcribe'];
const PRINT_TRANSCRIPT = !!args['print-transcript'];
const WANT_SRT = !!args['srt'];
const META_ONLY = !!args['meta-only'];

const SONG_CARD_SEC = args['song-card'] != null ? Number(args['song-card']) : 3.2;
const SEASON_CARD_SEC = args['season-card'] != null ? Number(args['season-card']) : 4.0;
const ENDCARD_SEC = args['endcard'] != null ? Number(args['endcard']) : 6.0;
const DEFAULT_DJ = '深夜のタイムスリップDJ・シンヤ';

const ANCHOR_OUT = path.resolve(OUT_ROOT, '..', 'anchors');

function buildJobs() {
  if (args.manifest) {
    const m = readJson(String(args.manifest));
    const only = args.only ? String(args.only).split(',').map((s) => Number(s.trim())) : null;
    const jobs = (m.anchors ?? [])
      .filter((a) => !only || only.includes(a.id))
      .map((a) => ({ ...a, utm: a.utm ?? m.utm, dj: a.dj ?? m.dj ?? DEFAULT_DJ }));
    if (!jobs.length) fail('manifest に対象がありません（--only の指定を確認）');
    return jobs;
  }
  if (!args.cells) fail('--cells（例: 1995-autumn-09 / 1995-spring,1995-summer）か --manifest が必要です');
  return [{
    id: 0,
    cells: String(args.cells).split(',').map((s) => s.trim()).filter(Boolean),
    title: args.title ? String(args.title) : '',
    lead: args.lead ? String(args.lead) : '',
    bg: args.bg ? String(args.bg) : null,
    free: !!args.free,
    slug: args.slug ? String(args.slug) : null,
    chapters: [],
    dj: args['no-dj'] ? null : DEFAULT_DJ,
  }];
}

/** manifest のチャプター定義（アンカー句）→ タイムライン上の絶対秒 */
function resolveChapters(job, items, cellRanges, wordsByKey) {
  const chapters = [];
  const talk = items.filter((i) => i.type === 'talk');

  // 合本は各セルの季節カードが章扉＝そのままチャプター
  if (cellRanges.length > 1) {
    for (const r of cellRanges) chapters.push({ time: r.start, label: r.label, kind: 'season' });
  }

  const defs = job.chapters ?? [];
  for (const d of defs) {
    const cell = d.cell ?? job.cells[0];
    const item = talk.find((i) => i.cell === cell && i.seg === d.seg);
    if (!item) {
      console.warn(`   ⚠ チャプター定義に該当segがありません: ${cell} seg${d.seg}（"${d.label}"）`);
      continue;
    }
    if (!d.anchor) {
      chapters.push({ time: item.start, label: d.label, kind: 'seg' });
      continue;
    }
    const data = wordsByKey.get(`${cell}#${d.seg}`);
    if (!data) {
      console.warn(`   ⚠ 転写が無いためアンカー句を解決できません: "${d.anchor}"（--no-transcribe中?）`);
      continue;
    }
    const hit = findAnchorTime(data, d.anchor);
    if (hit.time == null || hit.score < 0.6) {
      console.warn(`   ⚠ チャプター句が一致しません（score=${hit.score}）: "${d.anchor}" → 落とします`);
      continue;
    }
    if (hit.score < 0.8) console.warn(`   ⚠ 一致が弱い（score=${hit.score}）: "${d.anchor}" ≈ "${hit.matchedText}"`);
    chapters.push({ time: item.start + hit.time, label: d.label, kind: 'anchor', score: hit.score });
  }

  // 定義が薄いときはseg見出しで埋める（YouTubeは3つ以上・0:00始まりが要件）
  if (chapters.filter((c) => c.kind !== 'season').length < 3) {
    for (const i of talk) {
      const label = cellRanges.length > 1 ? `${parseCell(i.cell).label} ${i.segmentLabel}` : i.segmentLabel;
      if (!chapters.some((c) => Math.abs(c.time - i.start) < 5)) {
        chapters.push({ time: i.start, label, kind: 'seg' });
      }
    }
  }

  chapters.push({ time: 0, label: job.openingLabel ?? 'オープニング', kind: 'head' });
  return chapters;
}

async function processJob(job) {
  const tag = `#${job.id} ${job.cells.join('+')}`;
  const { items, cellRanges, talkTotal } = await buildTimeline({
    cells: job.cells, songCardSec: SONG_CARD_SEC, seasonCardSec: SEASON_CARD_SEC,
  });
  const total = +(talkTotal + ENDCARD_SEC).toFixed(3);

  // 転写（チャプターのアンカー句解決＋srt用）。キャッシュがあれば無課金で再利用される。
  const wordsByKey = new Map();
  const talkSubs = [];
  if (TRANSCRIBE) {
    for (const i of items.filter((x) => x.type === 'talk')) {
      const data = await getWords(i.cell, i.seg, i.mp3Path);
      wordsByKey.set(`${i.cell}#${i.seg}`, data);
      talkSubs.push({ offset: i.start, segments: data.segments });
      const whisperEnd = Math.max(0, ...(data.segments ?? []).map((s) => s.end));
      if (i.dur - whisperEnd > 2.5) {
        console.warn(`   ⚠ ${i.cell} seg${i.seg}: 実尺${i.dur.toFixed(1)}s に対し転写は${whisperEnd.toFixed(1)}sで終わる（末尾に無音?）`);
      }
    }
  }

  const chapters = normalizeChapters(resolveChapters(job, items, cellRanges, wordsByKey), total);
  const songs = items.filter((i) => i.type === 'song');
  const utm = job.utm ?? { source: 'youtube', medium: 'anchor' };
  const campaign = job.slug ?? job.cells.join('_');
  const target = job.free ? `/episodes/${job.cells[0]}` : '/episodes';
  const url = `https://redial.jp${target}?utm_source=${utm.source}&utm_medium=${utm.medium}&utm_campaign=${campaign}`;

  console.log(`[${tag}] トーク${(talkTotal / 60).toFixed(1)}分＋エンドカード → 全体 ${ytTime(total)}`);
  console.log(`   talk ${items.filter((i) => i.type === 'talk').length}本 / 曲カード ${songs.length}枚 / チャプター ${chapters.length}個`);
  for (const i of items) {
    const label = i.type === 'talk' ? `talk  ${i.cell} seg${i.seg} ${i.segmentLabel}`
      : i.type === 'song' ? `card  ♪ ${i.title}／${i.artist}`
        : `card  ${i.label}`;
    const est = i.type === 'talk' && i.estimatedDurationSec ? `  (stock概算 ${i.estimatedDurationSec}s)` : '';
    console.log(`   ${ytTime(i.start).padStart(6)}  ${label}  [${i.dur.toFixed(1)}s]${est}`);
  }
  console.log('   --- チャプター（概要欄に入る形） ---');
  for (const c of chapters) console.log(`   ${ytTime(c.time)} ${c.label}`);

  if (PRINT_TRANSCRIPT) {
    for (const [key, data] of wordsByKey) {
      console.log(`\n   === transcript ${key} ===`);
      for (const s of data.segments ?? []) console.log(`   [${s.start.toFixed(1)}] ${s.text.trim()}`);
    }
  }

  if (DRY) return { ok: true, job, dry: true };

  ensureDir(ANCHOR_OUT);
  const base = job.slug ?? job.cells.join('_');
  const outMp4 = path.resolve(ANCHOR_OUT, `${base}.mp4`);
  const assPath = path.resolve(ANCHOR_OUT, `.${base}.ass`);
  const thumbAss = path.resolve(ANCHOR_OUT, `.${base}-thumb.ass`);

  // --meta-only: mp4を作り直さず、概要欄・チャプター・メタだけ再生成する。
  // 動画にURLは焼き込んでいない（カードは「概要欄から」としか言わない）ので、
  // URL変更（例: redial.vercel.app → redial.jp）は再レンダ不要＝36分の合本を焼き直さずに済む。
  if (!META_ONLY) {
    const { buildAnchorAss, buildThumbAss } = await import('./anchor/ass.mjs');
    const { renderAnchor, renderThumbnail } = await import('./anchor/render.mjs');

    // 画面のタイトル板は cardTitle（短い題）。job.title はYouTube用のSEOタイトルで、
    // 60字超なので画面に出すとはみ出す＝別物として扱う。
    // cardTitle は配列（1要素=1行）でも文字列でも可
    const cardTitle = job.cardTitle
      ?? (job.cells.length > 1
        ? [`${parseCell(job.cells[0]).year}年、ぜんぶ`, 'あの年の走馬灯']
        : [parseCell(job.cells[0]).label, 'あの季節の走馬灯']);
    buildAnchorAss({
      assPath, items, cellRanges, total,
      title: cardTitle, djName: job.dj, endcardSec: ENDCARD_SEC,
      siteLabel: '概要欄から',
    });

    let lastPct = -1;
    await renderAnchor({
      items, bg: job.bg, assPath, outMp4, talkTotal, endcardSec: ENDCARD_SEC,
      onProgress: (t, tot) => {
        const pct = Math.floor((t / tot) * 100 / 10) * 10;
        if (pct > lastPct) { lastPct = pct; process.stdout.write(`   render ${pct}%\r`); }
      },
    });
    console.log(`   render 100%   `);

    const first = parseCell(job.cells[0]);
    buildThumbAss({
      assPath: thumbAss,
      year: first.year,
      seasonJP: job.cells.length > 1 ? 'ぜんぶ' : first.seasonJP,
      hook: job.thumbHook ?? '',
    });
    await renderThumbnail({ bg: job.bg, assPath: thumbAss, outPng: outMp4.replace(/\.mp4$/, '-thumb.png') });
  }

  // srtは既定OFF。Whisperは固有名詞に弱く（「ポール」→「コール・マッカートニー」等）、
  // そのまま字幕として上げるとブランドを毀損する。出すなら人手校正が前提（--srt）。
  if (WANT_SRT && talkSubs.length) {
    const { cues } = writeSrt({ srtPath: outMp4.replace(/\.mp4$/, '.srt'), talkSubs });
    console.log(`   ⚠ srt(${cues}行)を出力。Whisperの固有名詞誤りを含むため、YouTubeへ上げる前に必ず校正すること`);
  }

  const description = buildDescription({ job, url, chapters, songs, total, cellRanges });
  writeAnchorMeta({ job, outMp4, items, cellRanges, chapters, total, url, description });

  const mb = fs.existsSync(outMp4)
    ? `${(fs.statSync(outMp4).size / 1024 / 1024).toFixed(1)}MB`
    : 'mp4なし';
  console.log(`   ✓ ${path.relative(process.cwd(), outMp4)}  (${mb} / ${ytTime(total)})${META_ONLY ? ' [meta-only]' : ''}`);
  return { ok: true, job };
}

async function main() {
  const jobs = buildJobs();
  console.log(`${DRY ? '[DRY-RUN] ' : ''}${jobs.length}本を処理します\n`);
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await processJob(job));
    } catch (e) {
      console.error(`[#${job.id} ${job.cells.join('+')}] ✗ ${e.message}`);
      results.push({ ok: false, job });
    }
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n完了: ${ok}/${results.length}${DRY ? '（dry-run・動画は未生成）' : ''}`);
  if (ok < results.length) process.exitCode = 1;
}

function fail(msg) {
  console.error(`エラー: ${msg}`);
  process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
