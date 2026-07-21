/**
 * プール生成バッチCLI — generate → Layer3検証 → TTS → stockize を一括で回す。
 *
 * ReDial Phase 2「オンデマンド生成（事前生成プール）」の制作ループを仕組み化したもの。
 * KBのある年×季節を hideさんが事前にバッチ生成・検証・目視確認して「プール」化する。
 * 設計: redial/docs/PHASE2_ONDEMAND_DESIGN.md §3.4 / §4 / §9
 *
 * 前提:
 *   - timeslip-dj の dev サーバーが起動していること（localhost:3000）
 *     起動: env -u ANTHROPIC_API_KEY npm run dev   ← .env.local の API キーを使わせる
 *   - 母体 redial の data/knowledge/{year}-{season}.json が存在すること
 *
 * 使い方:
 *   # 1本（既存を壊さないテスト: slug を 1990-autumn-pooltest にする）
 *   node scripts/batch-generate.mjs --targets 1990-autumn --slug-suffix -pooltest
 *
 *   # 複数本まとめて（本番プール化）
 *   node scripts/batch-generate.mjs --targets 1990-autumn,1995-summer,2000-spring
 *
 * オプション:
 *   --targets <list>            "1990-autumn,1995-summer" カンマ区切りの year-season（必須）
 *   --slug-suffix <str>         出力 slug の接尾辞（例 -pooltest）。既存ストック保護用。既定なし
 *   --base <url>                dev サーバーURL。既定 http://localhost:3000
 *   --critical-threshold <n>    Layer3 critical がこの数を超えたら TTS をスキップ。既定 Infinity（=常に進む・1パス方針）
 *
 * 1パス方針（PHASE2_ONDEMAND_DESIGN §7）:
 *   Layer3 は検証してレポートを残すのみ。自動再生成はしない。
 *   critical が出た本は grounding-report.json を見て、hideさんが編集UI/再生成で対処する。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import http from 'node:http';

const CWD = process.cwd();
const SCRIPTS_ROOT = path.resolve(CWD, '..', 'redial', 'data', 'scripts');
const STOCK_ROOT = path.resolve(CWD, '..', 'redial', 'data', 'stock');
const STOCKIZE = path.resolve(CWD, 'scripts', 'stockize-episode.mjs');

// fetch の最大待ち時間（TTSは1セグメント1〜2分かかる）。
const FETCH_TIMEOUT_MS = 10 * 60 * 1000;

const args = parseArgs(process.argv.slice(2));
const opts = {
  base: (args.base ?? 'http://localhost:3000').replace(/\/$/, ''),
  slugSuffix: args['slug-suffix'] ?? '',
  criticalThreshold:
    args['critical-threshold'] != null ? Number(args['critical-threshold']) : Infinity,
  // 曲選択カスタマイズ: 指定があれば generate-script に songIds を渡し、その曲だけで生成（must-use）。
  // 単一ターゲット前提（ワーカーは1ジョブ=1セル）。null = お任せ（従来）。
  songIds: args['song-ids']
    ? String(args['song-ids']).split(',').map((s) => s.trim()).filter(Boolean)
    : null,
  // API使用量記録（Supabase api_usage）の紐付け用。generation-worker.mjs がジョブID(generations.id)を
  // 渡す。batch-generate.mjs 単体実行（事前プール制作）では未指定 = null で記録される。
  generationId: args['generation-id'] ?? null,
};
const targets = parseTargets(args);

if (targets.length === 0) {
  console.error(
    'usage: node scripts/batch-generate.mjs --targets 1990-autumn,1995-summer [--slug-suffix -pooltest] [--base http://localhost:3000] [--critical-threshold N] [--generation-id N]',
  );
  process.exit(1);
}

console.log(
  `\nプール生成バッチ: ${targets.length}本  base=${opts.base}` +
    `${opts.slugSuffix ? `  suffix=${opts.slugSuffix}` : ''}` +
    `${Number.isFinite(opts.criticalThreshold) ? `  critical閾値=${opts.criticalThreshold}` : ''}`,
);

const results = [];
for (let i = 0; i < targets.length; i++) {
  console.log(`\n========== [${i + 1}/${targets.length}] ${targets[i].year}-${targets[i].season} ==========`);
  try {
    const r = await processOne(targets[i], opts);
    results.push(r);
  } catch (e) {
    console.error(`✗ 失敗: ${e.message}`);
    results.push({ slug: `${targets[i].year}-${targets[i].season}`, error: e.message });
  }
}

// ─── 完了サマリ ────────────────────────────────────────
console.log(`\n\n━━━━━━ 完了サマリ ━━━━━━`);
for (const r of results) {
  if (r.error) console.log(`  ✗ ${r.slug}: ${r.error}`);
  else if (r.skipped) console.log(`  ⏭ ${r.slug}: TTSスキップ（critical ${r.report?.criticalCount}件・要再生成）`);
  else console.log(`  ✓ ${r.slug}: critical ${r.report?.criticalCount ?? '?'}件 / minor ${r.report?.minorCount ?? '?'}件 → ${r.stockDir}`);
}
const okCount = results.filter((r) => !r.error && !r.skipped).length;
console.log(`\n完了: ${okCount}/${targets.length} 本ストック化`);

// ════════════════════════════════════════════════════════
async function processOne(t, opts) {
  const slug = `${t.year}-${t.season}${opts.slugSuffix}`;

  // 1) 台本生成（既存 /api/generate-script・無改修）
  console.log('[1/5] 台本生成中（generate-script）...');
  if (opts.songIds) console.log(`      曲選択モード: ${opts.songIds.length}曲指定 (${opts.songIds.join(', ')})`);
  const script = await postJson(`${opts.base}/api/generate-script`, {
    year: t.year,
    season: t.season,
    ...(opts.songIds ? { songIds: opts.songIds } : {}),
    ...(opts.generationId != null ? { generationId: opts.generationId } : {}),
  });
  const segments = script.segments;
  if (!Array.isArray(segments) || segments.length !== 5) {
    throw new Error(`走馬灯型は5セグメント必須。受信: ${segments?.length ?? 'なし'}`);
  }
  const songs = segments.filter((s) => s.songTitle).map((s) => `${s.songTitle}`);
  console.log(`      ✓ 5セグメント（曲 ${songs.length}本: ${songs.join(' / ')}）`);

  // 無人化: 年号を日本語読みに自動かな化（TTSの年号誤読「にせん/桁読み」を防ぐ）。
  // これまで手作業で v1.json を直していた工程の自動化。Layer3 は元の数字表記で検証するため、
  // かな化前のテキストを保持しておく。
  const scriptTextOriginal = segments.map((s) => `【${s.segmentTitle}】\n${s.script}`).join('\n\n');
  let kanaCount = 0;
  for (const s of segments) {
    const before = s.script;
    s.script = kanaizeYears(s.script);
    if (s.script !== before) kanaCount++;
  }
  console.log(`      ✓ 年号かな化: ${kanaCount}/${segments.length} セグメント`);

  // 2) v1.json 保存（stockize が楽曲メタ＋videoId を解決するために参照）
  fs.mkdirSync(SCRIPTS_ROOT, { recursive: true });
  const v1Path = path.join(SCRIPTS_ROOT, `${slug}-v1.json`);
  fs.writeFileSync(v1Path, JSON.stringify(script, null, 2), 'utf8');
  console.log(`      ✓ 台本を ${path.relative(CWD, v1Path)} に保存`);

  // 3) Layer3 グラウンディング検証（TTSの前段で1パス）
  console.log('[2/5] Layer3 グラウンディング検証中...');
  const scriptText = scriptTextOriginal; // かな化前の数字表記で検証（KBとの突合精度のため）
  let report = null;
  try {
    report = await postJson(`${opts.base}/api/verify-grounding`, {
      year: t.year,
      season: t.season,
      scriptText,
      ...(opts.generationId != null ? { generationId: opts.generationId } : {}),
    });
    const cc = report.criticalCount ?? 0;
    const mc = report.minorCount ?? 0;
    if (cc > 0) {
      console.log(`      ⚠️  critical ${cc}件 / minor ${mc}件 — 要確認`);
      for (const u of (report.ungrounded ?? []).filter((u) => u.severity === 'critical')) {
        console.log(`         ✗ [critical] ${u.claim}  ── ${u.reason}`);
      }
    } else {
      console.log(`      ✓ critical 0件 / minor ${mc}件`);
    }
  } catch (e) {
    console.log(`      ⚠️ Layer3検証スキップ（${e.message}）— TTSは続行`);
  }

  // 閾値判定（1パス既定では Infinity = 常に進む）
  if (report && (report.criticalCount ?? 0) > opts.criticalThreshold) {
    console.log(
      `      ⏭ critical が閾値(${opts.criticalThreshold})超 → TTSスキップ。` +
        `${path.relative(CWD, v1Path)} を確認して再生成してください。`,
    );
    return { slug, skipped: true, report };
  }

  // 4) 各セグメント TTS（既存 /api/tts・無改修。.tts-archive に保存され archiveId が返る）
  console.log('[3/5] TTS生成中（5セグメント・逐次）...');
  const archiveIds = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    process.stdout.write(`      seg${i} ${seg.segmentTitle} ... `);
    const tts = await postJson(`${opts.base}/api/tts`, {
      text: seg.script,
      metadata: {
        segmentIndex: i,
        segmentTitle: seg.segmentTitle,
        year: t.year,
        season: t.season,
      },
      ...(opts.generationId != null ? { generationId: opts.generationId } : {}),
    });
    archiveIds.push(tts.archiveId);
    console.log(`✓ ${tts.archiveId} (${tts.chunks?.length ?? '?'} chunks)`);
  }

  // 5) stockize（既存 scripts/stockize-episode.mjs・無改修。redial/data/stock へ統合）
  console.log('[4/5] stockize中...');
  const stockizeArgs = [STOCKIZE, '--slug', slug];
  for (let i = 0; i < archiveIds.length; i++) {
    stockizeArgs.push(`--seg${i}`, archiveIds[i]);
  }
  stockizeArgs.push('--script', v1Path);
  execFileSync('node', stockizeArgs, { stdio: 'inherit', cwd: CWD });

  // 6) grounding-report.json をストックに同梱（後の精査・報告ボタンの裏取り用）
  const stockDir = path.join(STOCK_ROOT, slug);
  if (report) {
    fs.writeFileSync(
      path.join(stockDir, 'grounding-report.json'),
      JSON.stringify(report, null, 2),
      'utf8',
    );
    console.log(`[5/5] grounding-report.json を同梱`);
  }

  return { slug, skipped: false, report, archiveIds, stockDir: path.relative(CWD, stockDir) };
}

// ─── HTTP ヘルパ ─────────────────────────────────────
// node:http で実装（fetch/undici の headersTimeout=約5分 を回避）。
// TTSのセグメントは dropoutリトライ中の Whisper verify が5分ハングすることがあり、
// fetch だと UND_ERR_HEADERS_TIMEOUT で socket が切れる。http はヘッダ待ちで切らない。
function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(text); } catch { /* JSONでない */ }
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            reject(new Error(`${url} → ${res.statusCode}: ${json?.error ?? text.slice(0, 300)}`));
          } else {
            resolve(json);
          }
        });
      },
    );
    // socketアイドル（無受信）タイムアウト。レスポンス全体ではなくデータ無受信が続いた時間。
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error(`タイムアウト (${url})`)));
    req.on('error', (e) =>
      reject(new Error(`接続失敗 (${url}) — dev サーバー起動を確認 (env -u ANTHROPIC_API_KEY npm run dev): ${e.message}`)),
    );
    req.write(body);
    req.end();
  });
}

// ─── 引数パース ───────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1];
      out[k] = v;
      i++;
    }
  }
  return out;
}

function parseTargets(args) {
  const targets = [];
  if (args.targets) {
    for (const raw of args.targets.split(',')) {
      const t = raw.trim();
      if (!t) continue;
      const m = t.match(/^(\d{4})-([a-z]+)$/i);
      if (!m) {
        console.error(`  ⚠️ 不正なターゲットを無視: "${t}"（形式: 1990-autumn）`);
        continue;
      }
      targets.push({ year: Number(m[1]), season: m[2].toLowerCase() });
    }
  } else if (args.year && args.season) {
    targets.push({ year: Number(args.year), season: String(args.season).toLowerCase() });
  }
  return targets;
}

// ─── 年号かな化（無人TTS用） ───────────────────────────
// 「1990年」→「せんきゅうひゃくきゅうじゅうねん」のように西暦+年を日本語読みへ。
// 「年」も仮名にする（漢字を残すと TTS が「とし」と読む誤読が出るため）。
// 19xx/20xx + 年 のみを対象にし、非年号の4桁数字（293万・3200人等）は変えない。
function kanaYear4(n) {
  const ones = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
  const sen = Math.floor(n / 1000);
  const hyaku = Math.floor((n % 1000) / 100);
  const juu = Math.floor((n % 100) / 10);
  const ichi = n % 10;
  let s = '';
  if (sen) s += sen === 1 ? 'せん' : ones[sen] + 'せん';
  if (hyaku) s += hyaku === 3 ? 'さんびゃく' : hyaku === 6 ? 'ろっぴゃく' : hyaku === 8 ? 'はっぴゃく' : ones[hyaku] + 'ひゃく';
  if (juu) s += juu === 1 ? 'じゅう' : ones[juu] + 'じゅう';
  if (ichi) s += ones[ichi];
  return s;
}
function kanaizeYears(text) {
  return text.replace(/((?:19|20)\d{2})年(代)?/g, (_, y, dai) => kanaYear4(Number(y)) + 'ねん' + (dai ? 'だい' : ''));
}
