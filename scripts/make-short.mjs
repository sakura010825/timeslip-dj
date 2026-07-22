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
import { parseArgs, slugifyHook, ensureDir, readJson, fmtSec, normalizeForCompare, OUT_ROOT } from './shorts/util.mjs';
import { locateSegAudio, getWords, resolveWindow } from './shorts/resolve.mjs';

const args = parseArgs(process.argv.slice(2));
const DRY = !!args['dry-run'];
const PAD_START = args['pad-start'] != null ? Number(args['pad-start']) : 0.25;
const PAD_END = args['pad-end'] != null ? Number(args['pad-end']) : 0.6;
// 既定上限90s（CATALOG_AUDIT「ベスト90秒台帳」＝素材の狙い尺。Shortsは現在最大3分可）
const MAX_SEC = args['max'] != null ? Number(args['max']) : 90;

// シンヤ名乗り（既定ON・--no-dj で消す・--dj で差替）＝毎回「これは深夜DJラジオ」の正体を運ぶ
const DEFAULT_DJ = '深夜のタイムスリップDJ・シンヤ';
const DJ_NAME = args['no-dj'] ? null : (args.dj ? String(args.dj) : DEFAULT_DJ);

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
    song: args.song ? String(args.song) : null,   // 型B: 曲予告クリフハンガー
    fixes: null,
    djName: DJ_NAME,
  }];
}

function buildJobsFromManifest(manifestPath) {
  const m = readJson(manifestPath);
  const only = args.only ? String(args.only).split(',').map((s) => Number(s.trim())) : null;
  const manifestDj = m.dj !== undefined ? m.dj : DEFAULT_DJ;
  return (m.shorts ?? [])
    .filter((s) => !only || only.includes(s.id))
    .map((s) => ({
      id: s.id, cell: s.cell, seg: s.seg, start: s.start, end: s.end,
      hook: s.hook ?? 'clip', title: s.title ?? '', bg: s.bg ?? null,
      subsFile: s.subsFile ?? null, audience: s.audience ?? '',
      song: s.song ?? null, fixes: s.fixes ?? null,
      // 型Bは曲名の直前で切るため、本ごとに余白の微調整が要る（既定は song 指定時 0）
      padStart: s.padStart ?? null, padEnd: s.padEnd ?? null,
      djName: args['no-dj'] ? null : (args.dj ? String(args.dj) : manifestDj),
      utm: m.utm,
    }));
}

async function processJob(job) {
  const tag = `#${job.id} ${job.cell} seg${job.seg}`;
  const { segmentName, mp3Path, durationSec } = locateSegAudio(job.cell, job.seg);
  const data = await getWords(job.cell, job.seg, mp3Path);
  // 窓のクランプは stock.json の estimatedDurationSec ではなく実音声の長さ（Whisper転写の最大end）を使う。
  // estimatedDurationSec は生成時の概算で実mp3より短いことがあり、末尾（曲紹介等）を切ってしまう（hide 2026-07-13）。
  const whisperEnd = Math.max(
    0,
    ...(data.words ?? []).map((w) => w.end),
    ...(data.segments ?? []).map((s) => s.end),
  );
  const audioDur = Math.max(durationSec ?? 0, whisperEnd);
  // 型B（曲予告クリフハンガー）は既定の余白 0.6s が命取りになる。
  // 曲紹介の直前で切るので、0.6s 余分に鳴らすと**次の一言＝曲名そのもの**が
  // 音にも字幕にも漏れ、「流れないこと」というフック自体が消える（2026-07-22 実測で
  // #13 が「グレーでハウエバーです」を巻き込んでいた）。よって song 指定時の既定は 0。
  // マニフェスト側の padStart/padEnd で個別上書きもできる。
  const padStart = job.padStart != null ? Number(job.padStart) : PAD_START;
  const padEnd = job.padEnd != null ? Number(job.padEnd) : (job.song ? 0 : PAD_END);
  const win = resolveWindow({
    data,
    startAnchor: job.start,
    endAnchor: job.end,
    padStart,
    padEnd,
    segDurationSec: audioDur,
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

  // 型Bのクリフハンガー検査。曲名が漏れると広告として死ぬのに、映像は正常に焼き上がる＝
  // **静かに壊れる**種類の事故なので機械で止める（背景が見つからない警告を読み飛ばした
  // 2026-07-17 の教訓と同じ型）。窓に入る最後の転写セグメントが end 句で終わっていなければ、
  // その先（＝曲名）を巻き込んでいる。
  if (job.song) {
    const shown = (data.segments ?? []).filter((s) => s.end > win.t0 && s.start < win.t1);
    const last = shown[shown.length - 1];
    if (last) {
      const nLast = normalizeForCompare(last.text);
      // 比べる相手は指定句ではなく **実際に一致した転写テキスト**（win.endText）。
      // 指定句は原稿の綴りで書くので、Whisperが別表記に転写していると（例: ユーミン→雄鳴）
      // 正しい窓でも一致せず誤検知になる。
      const nAnchor = normalizeForCompare(win.endText || job.end);
      const probe = nAnchor.slice(-8);
      const at = probe ? nLast.lastIndexOf(probe) : -1;
      const trailing = at >= 0 ? nLast.length - (at + probe.length) : Infinity;
      if (trailing > 6) {
        console.error(`   ✗ 型B: 窓が end 句の先まで含んでいる＝曲名が漏れる恐れ`);
        console.error(`      最後の字幕: "${last.text.trim()}"`);
        console.error(`      → end 句を曲名の直前の表現にするか、padEnd をマイナスにしてください`);
        return { ok: false, job };
      }
    }
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

  // 型B（曲予告）はカードが主役なので少し長めに見せる
  const endcardSec = job.song ? 2.4 : 1.8;
  buildAss({
    assPath,
    segments: data.segments,
    win,
    year: job.cell.split('-')[0],
    season: job.cell.split('-')[1],
    title: job.title,
    subsOverride,
    endcardSec,
    djName: job.djName,
    songCard: job.song,
    fixes: job.fixes,
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
