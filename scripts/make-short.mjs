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
      // 型C（走馬灯）: 複数断片の宣言と、問いで閉じるエンドカードの切替
      clips: s.clips ?? null, walkingFlame: !!s.walkingFlame,
      // バッジ2行目（常設の題材表示）。hook は型Bだと「愛は勝つ予告」のように**曲名を含む**ので、
      // そのまま出すとクリフハンガーが冒頭から割れる（2026-07-22 フレーム確認で捕捉）。
      // 型Bは topic を明示した本だけ2行目を出す。
      topic: s.topic ?? (s.song ? null : s.hook),
      // 型Bは曲名の直前で切るため、本ごとに余白の微調整が要る（既定は song 指定時 0）
      padStart: s.padStart ?? null, padEnd: s.padEnd ?? null,
      djName: args['no-dj'] ? null : (args.dj ? String(args.dj) : manifestDj),
      utm: m.utm,
    }));
}

async function processJob(job) {
  // 型C（走馬灯）はエピソード各所の断片を並べるので窓が複数になる。型A/型Bは1つ。
  const parts = (job.clips && job.clips.length) ? job.clips : [{ seg: job.seg, start: job.start, end: job.end }];
  const tag = `#${job.id} ${job.cell} ${parts.length > 1 ? parts.length + '断片' : 'seg' + parts[0].seg}`;

  const clips = [];
  for (const part of parts) {
    const { mp3Path, durationSec } = locateSegAudio(job.cell, part.seg);
    const data = await getWords(job.cell, part.seg, mp3Path);
    // 窓のクランプは stock.json の estimatedDurationSec ではなく実音声の長さ（Whisper転写の最大end）を使う。
    // estimatedDurationSec は生成時の概算で実mp3より短いことがあり、末尾（曲紹介等）を切ってしまう（hide 2026-07-13）。
    const whisperEnd = Math.max(
      0,
      ...(data.words ?? []).map((w) => w.end),
      ...(data.segments ?? []).map((s) => s.end),
    );
    const audioDur = Math.max(durationSec ?? 0, whisperEnd);
    // 型B（曲予告クリフハンガー）は既定の余白 0.6s が命取りになる。曲紹介の直前で切るので、
    // 0.6s 余分に鳴らすと**次の一言＝曲名そのもの**が音にも字幕にも漏れ、「流れないこと」という
    // フック自体が消える（2026-07-22 実測で #13 が「グレーでハウエバーです」を巻き込んでいた）。
    // よって song 指定時の既定は 0。padStart/padEnd はジョブ単位でも断片単位でも上書きできる。
    const padStart = part.padStart != null ? Number(part.padStart)
      : job.padStart != null ? Number(job.padStart) : PAD_START;
    const padEnd = part.padEnd != null ? Number(part.padEnd)
      : job.padEnd != null ? Number(job.padEnd) : (job.song ? 0 : PAD_END);

    const win = resolveWindow({
      data, startAnchor: part.start, endAnchor: part.end, padStart, padEnd, segDurationSec: audioDur,
    });

    if (!win.ok) {
      console.error(`[${tag}] ✗ seg${part.seg} の窓解決に失敗（start=${win.startScore} end=${win.endScore}）`);
      console.error(`   start一致: "${win.startText}"  end一致: "${win.endText}"`);
      console.error(`   → start/end の句を transcript に現れる一意な表現に調整してください`);
      console.error(`   transcript冒頭: ${data.text.slice(0, 120)}…`);
      return { ok: false, job };
    }

    const lowConf = win.startScore < 0.8 || win.endScore < 0.8;
    const flag = win.fallback ? ' [segments fallback]' : lowConf ? ' [low-conf]' : '';
    console.log(`[${tag}] seg${part.seg} ${fmtSec(win.t0)}–${fmtSec(win.t1)} (${fmtSec(win.dur)})  match start=${win.startScore} end=${win.endScore}${flag}`);
    console.log(`   start≈"${win.startText}"  end≈"${win.endText}"`);

    clips.push({ seg: part.seg, mp3Path, data, win });
  }

  const totalDur = clips.reduce((n, c) => n + c.win.dur, 0);
  if (parts.length > 1) console.log(`   合計 ${fmtSec(totalDur)}（${parts.length}断片）`);

  if (totalDur > MAX_SEC) {
    console.error(`   ✗ 尺 ${fmtSec(totalDur)} が上限 ${MAX_SEC}s を超過。切り出し句を見直してください`);
    return { ok: false, job };
  }
  if (totalDur < 8) {
    console.warn(`   ⚠ 尺 ${fmtSec(totalDur)} が短い（8s未満）。意図通りか確認を`);
  }

  // 型Bのクリフハンガー検査。曲名が漏れると広告として死ぬのに、映像は正常に焼き上がる＝
  // **静かに壊れる**種類の事故なので機械で止める（背景が見つからない警告を読み飛ばした
  // 2026-07-17 の教訓と同じ型）。**最後の断片**の末尾が end 句で終わっていなければ、
  // その先（＝曲名）を巻き込んでいる。
  if (job.song) {
    // バッジの題材表示にも曲名を出さない。hook は「愛は勝つ予告」のように曲名を含むので、
    // 型Bでこれを常設表示すると**冒頭からオチが割れる**（画面は正常に焼き上がるので気づけない）。
    const norm = (s) => normalizeForCompare(String(s ?? ''));
    if (job.topic && norm(job.topic).includes(norm(job.song))) {
      console.error(`   ✗ 型B: バッジの題材「${job.topic}」に曲名「${job.song}」が入っている＝冒頭でネタバレ`);
      console.error(`      → マニフェストの topic を曲名を含まない表現にしてください`);
      return { ok: false, job };
    }
    const tail = clips[clips.length - 1];
    const shown = (tail.data.segments ?? []).filter((s) => s.end > tail.win.t0 && s.start < tail.win.t1);
    const last = shown[shown.length - 1];
    if (last) {
      const nLast = normalizeForCompare(last.text);
      // 比べる相手は指定句ではなく **実際に一致した転写テキスト**（win.endText）。
      // 指定句は原稿の綴りで書くので、Whisperが別表記に転写していると（例: ユーミン→雄鳴）
      // 正しい窓でも一致せず誤検知になる。
      const nAnchor = normalizeForCompare(tail.win.endText || parts[parts.length - 1].end);
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

  if (DRY) return { ok: true, job, clips, dry: true };

  // 実レンダ（subtitles/render は遅延import）
  const { buildAss } = await import('./shorts/subtitles.mjs');
  const { renderShort } = await import('./shorts/render.mjs');
  const { writeMeta } = await import('./shorts/post-meta.mjs');

  const hookSlug = slugifyHook(job.hook);
  ensureDir(OUT_ROOT);
  // 型C（複数断片）はセグメント番号で名乗れないので walk- を付ける
  const stem = parts.length > 1
    ? `${job.cell}-walk-${hookSlug}`
    : `${job.cell}-seg${parts[0].seg}-${hookSlug}`;
  const outMp4 = path.resolve(OUT_ROOT, `${stem}.mp4`);
  const assPath = path.resolve(OUT_ROOT, `.${stem}.ass`);

  const subsOverride = job.subsFile && fs.existsSync(job.subsFile)
    ? fs.readFileSync(job.subsFile, 'utf8')
    : null;

  // 型B（曲予告）はカードが主役なので少し長めに見せる。
  // 型C（走馬灯）は最後が**問い**なので、読み切って考える間を置く。
  // URLを読み切る時間が要る（hide試写: 行き先を持ち帰れないと導線が成立しない）
  const endcardSec = job.song ? 2.8 : job.walkingFlame ? 3.2 : 2.4;
  buildAss({
    assPath,
    clips: clips.map((c) => ({ segments: c.data.segments, win: c.win })),
    year: job.cell.split('-')[0],
    season: job.cell.split('-')[1],
    title: job.title,
    topic: job.topic,
    subsOverride,
    endcardSec,
    djName: job.djName,
    songCard: job.song,
    walkingFlame: !!job.walkingFlame,
    fixes: job.fixes,
  });

  await renderShort({
    clips: clips.map((c) => ({ mp3Path: c.mp3Path, win: c.win })),
    bg: job.bg, assPath, outMp4, endcardSec,
  });

  writeMeta({ job, win: { t0: clips[0].win.t0, t1: clips[clips.length - 1].win.t1, dur: totalDur },
    segmentName: parts.map((p) => 'seg' + p.seg).join('+'), mp3Path: clips[0].mp3Path, outMp4 });
  console.log(`   ✓ ${path.relative(process.cwd(), outMp4)}`);
  return { ok: true, job, clips };
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
      console.error(`[#${job.id} ${job.cell}] ✗ ${e.message}`);
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
