/**
 * ReDial 縦型ショート自動生成CLI（T2-2 / 設計: redial/docs/SHORTS_CLI_DESIGN_2026-07.md）
 *
 * 公開エピソードのトークセグメントから 9:16 mp4 を作る。音はシンヤの声だけ・楽曲0秒。
 *
 * usage（単発）:
 *   node --env-file=.env.local scripts/make-short.mjs \
 *     --cell 1995-spring --seg 1 \
 *     --start "最後まで残っていた六甲道駅は" --end "関西の人は知っている。" \
 *     --hook "駅の段ボール" --title "…" [--bg night-station.png] \
 *     [--pad-start 0.25] [--pad-end 0.6] [--max 60] [--subs-file x.txt] [--dry-run]
 *
 * usage（バッチ）:
 *   node --env-file=.env.local scripts/make-short.mjs --manifest data/shorts.manifest.json [--only 1,2] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, slugifyHook, ensureDir, readJson, fmtSec, OUT_ROOT } from './shorts/util.mjs';
import { locateSegAudio, getWords, resolveWindow } from './shorts/resolve.mjs';

const args = parseArgs(process.argv.slice(2));
const DRY = !!args['dry-run'];
const PAD_START = args['pad-start'] != null ? Number(args['pad-start']) : 0.25;
const PAD_END = args['pad-end'] != null ? Number(args['pad-end']) : 0.6;
// 既定上限90s（CATALOG_AUDIT「ベスト90秒台帳」＝素材の狙い尺。Shortsは現在最大3分可）
const MAX_SEC = args['max'] != null ? Number(args['max']) : 90;

function buildJobsFromArgs() {
  const need = ['cell', 'seg', 'start', 'end'];
  for (const k of need) if (args[k] == null) fail(`--${k} が必要です`);
  return [{
    id: 0,
    cell: String(args.cell),
    seg: Number(args.seg),
    start: String(args.start),
    end: String(args.end),
    hook: args.hook ? String(args.hook) : 'clip',
    title: args.title ? String(args.title) : '',
    bg: args.bg ? String(args.bg) : null,
    subsFile: args['subs-file'] ? String(args['subs-file']) : null,
    audience: '',
  }];
}

function buildJobsFromManifest(manifestPath) {
  const m = readJson(manifestPath);
  const only = args.only ? String(args.only).split(',').map((s) => Number(s.trim())) : null;
  return (m.shorts ?? [])
    .filter((s) => !only || only.includes(s.id))
    .map((s) => ({
      id: s.id, cell: s.cell, seg: s.seg, start: s.start, end: s.end,
      hook: s.hook ?? 'clip', title: s.title ?? '', bg: s.bg ?? null,
      subsFile: s.subsFile ?? null, audience: s.audience ?? '',
      utm: m.utm,
    }));
}

async function processJob(job) {
  const tag = `#${job.id} ${job.cell} seg${job.seg}`;
  const { segmentName, mp3Path, durationSec } = locateSegAudio(job.cell, job.seg);
  const data = await getWords(job.cell, job.seg, mp3Path);
  const win = resolveWindow({
    data,
    startAnchor: job.start,
    endAnchor: job.end,
    padStart: PAD_START,
    padEnd: PAD_END,
    segDurationSec: durationSec,
  });

  if (!win.ok) {
    console.error(`[${tag}] ✗ 窓解決に失敗（start=${win.startScore} end=${win.endScore}）`);
    console.error(`   start一致: "${win.startText}"  end一致: "${win.endText}"`);
    console.error(`   → --start/--end の句を transcript に現れる一意な表現に調整してください`);
    console.error(`   transcript冒頭: ${data.text.slice(0, 120)}…`);
    return { ok: false, job };
  }

  const lowConf = win.startScore < 0.8 || win.endScore < 0.8;
  const flag = win.fallback ? ' [segments fallback]' : lowConf ? ' [low-conf]' : '';
  console.log(`[${tag}] window ${fmtSec(win.t0)}–${fmtSec(win.t1)} (${fmtSec(win.dur)})  match start=${win.startScore} end=${win.endScore}${flag}`);
  console.log(`   start≈"${win.startText}"  end≈"${win.endText}"`);

  if (win.dur > MAX_SEC) {
    console.error(`   ✗ 尺 ${fmtSec(win.dur)} が上限 ${MAX_SEC}s を超過。切り出し句を見直してください`);
    return { ok: false, job };
  }
  if (win.dur < 8) {
    console.warn(`   ⚠ 尺 ${fmtSec(win.dur)} が短い（8s未満）。意図通りか確認を`);
  }

  if (DRY) return { ok: true, job, win, dry: true };

  // 実レンダ（subtitles/render は遅延import）
  const { buildAss } = await import('./shorts/subtitles.mjs');
  const { renderShort } = await import('./shorts/render.mjs');
  const { writeMeta } = await import('./shorts/post-meta.mjs');

  const hookSlug = slugifyHook(job.hook);
  ensureDir(OUT_ROOT);
  const outMp4 = path.resolve(OUT_ROOT, `${job.cell}-seg${job.seg}-${hookSlug}.mp4`);
  const assPath = path.resolve(OUT_ROOT, `.${job.cell}-seg${job.seg}-${hookSlug}.ass`);

  const subsOverride = job.subsFile && fs.existsSync(job.subsFile)
    ? fs.readFileSync(job.subsFile, 'utf8')
    : null;

  const endcardSec = 1.5;
  buildAss({
    assPath,
    words: data.words,
    win,
    year: job.cell.split('-')[0],
    season: job.cell.split('-')[1],
    title: job.title,
    subsOverride,
    endcardSec,
  });

  await renderShort({
    mp3Path, win, bg: job.bg, assPath, outMp4, endcardSec,
  });

  writeMeta({ job, win, segmentName, mp3Path, outMp4 });
  console.log(`   ✓ ${path.relative(process.cwd(), outMp4)}`);
  return { ok: true, job, win };
}

async function main() {
  let jobs;
  if (args.manifest) {
    jobs = buildJobsFromManifest(String(args.manifest));
    if (!jobs.length) fail('manifest に対象がありません（--only の指定を確認）');
  } else {
    jobs = buildJobsFromArgs();
  }

  console.log(`${DRY ? '[DRY-RUN] ' : ''}${jobs.length}本を処理します\n`);
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await processJob(job));
    } catch (e) {
      console.error(`[#${job.id} ${job.cell} seg${job.seg}] ✗ ${e.message}`);
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
