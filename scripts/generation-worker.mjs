/**
 * オンデマンド生成ワーカー（Phase 1・ローカル常駐）。
 * Supabase `generations` の queued を拾い、既存パイプライン(batch-generate)で無人生成し、
 * 音声を Vercel Blob へ、再生用データを generations.episode へ格納して ready にする。
 *
 * 前提（hideさんのローカル）:
 *   - timeslip-dj の dev サーバー起動: env -u ANTHROPIC_API_KEY npm run dev   （localhost:3000）
 *   - timeslip-dj/.env.local に NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   - redial/.env.local に BLOB_READ_WRITE_TOKEN（upload-stock-to-blob 用）
 *   - Supabase に generations テーブル作成済み（redial/supabase/generations.sql）
 *
 * 起動: cd timeslip-dj && node scripts/generation-worker.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const CWD = process.cwd();
loadEnvLocal(path.resolve(CWD, '.env.local'));

const SUPABASE_URL = normalizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = (process.env.GEN_BASE ?? 'http://localhost:3000').replace(/\/$/, '');
const POLL_MS = Number(process.env.GEN_POLL_MS ?? 20000);
// 処理中スタックの回収しきい値。1生成は通常1〜2分。これを大きく超えて generating の
// ままの行は、ワーカーが処理中にPCスリープ/クラッシュ/端末クローズで死んだ孤児。
// 無言で永久 generating（UIは「生成中…」のまま）になるのを防ぎ、可視的な failed に倒す。
// 設計: docs/OPS_WORKER_RESILIENCE_2026-07.md（T0-4）
const STUCK_MS = Number(process.env.GEN_STUCK_MS ?? 15 * 60 * 1000);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を timeslip-dj/.env.local に設定してください。');
  process.exit(1);
}

const REDIAL = path.resolve(CWD, '..', 'redial');
const STOCK_ROOT = path.resolve(REDIAL, 'data', 'stock');
const SCRIPTS_ROOT = path.resolve(REDIAL, 'data', 'scripts');
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`generation-worker 起動 — base=${BASE}  poll=${POLL_MS}ms`);
await loop();

async function loop() {
  for (;;) {
    try {
      await beat();
    } catch (e) {
      console.error('heartbeatエラー:', e.message);
    }
    try {
      await reclaimStuck();
    } catch (e) {
      console.error('reclaimエラー:', e.message);
    }
    let job = null;
    try {
      job = await claimNext();
    } catch (e) {
      console.error('claimエラー:', e.message);
    }
    if (job) await processJob(job);
    else await sleep(POLL_MS);
  }
}

// 死活監視のハートビート（T0-4）。ループ毎に last_beat_at を更新する。
// redial の /api/health がこの鮮度を読み、5分途絶で 503（外部監視が通知）。
// worker_heartbeat テーブル未適用でも黙って握りつぶす（起動は妨げない）。
async function beat() {
  await supa
    .from('worker_heartbeat')
    .upsert({ id: 1, last_beat_at: new Date().toISOString(), note: 'generation-worker' });
}

// 孤児化した generating（STUCK_MS 超）を failed に倒す。ワーカーが処理中に死ぬと
// その行は誰にも触られず永久に generating のままになる（UIは「生成中…」で固まる）。
// これを可視的な失敗に変え、ユーザーが再生成できる状態に戻す（原子性は不要＝古い
// generating は定義上いま処理中でない）。
async function reclaimStuck() {
  const cutoff = new Date(Date.now() - STUCK_MS).toISOString();
  const { data } = await supa
    .from('generations')
    .update({
      status: 'failed',
      error: '生成が中断されました。お手数ですが、もう一度お試しください。',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'generating')
    .lt('updated_at', cutoff)
    .select('id');
  if (data && data.length > 0) {
    console.warn(`⚠ 孤児 generating を ${data.length} 件 failed に回収: [${data.map((r) => r.id).join(', ')}]`);
  }
}

// 最古の queued を1件、generating に原子的にclaim（他ワーカーとの二重処理を防ぐ）。
async function claimNext() {
  const { data: rows, error } = await supa
    .from('generations').select('*').eq('status', 'queued')
    .order('created_at', { ascending: true }).limit(1);
  if (error) throw new Error(error.message);
  const job = rows?.[0];
  if (!job) return null;
  const { data: claimed } = await supa
    .from('generations')
    .update({ status: 'generating', updated_at: new Date().toISOString() })
    .eq('id', job.id).eq('status', 'queued').select();
  return claimed?.[0] ?? null;
}

async function processJob(job) {
  // slug に推測困難なトークンを混ぜる（2026-07-07 セキュリティ監査・Blobパス列挙対策[中]）。
  // 旧 `${year}-${season}-gen${連番id}` は id が連番のため総当たりで他人の個別生成音声
  // （公開URL・署名なし）を列挙・聴取できた。ランダム token を足して推測不能にする。
  // suffix は batch-generate の --slug-suffix と worker 側 slug で必ず同一にする。
  const token = randomBytes(6).toString('hex'); // 12桁hex
  const suffix = `-gen${job.id}-${token}`;
  const slug = `${job.year}-${job.season}${suffix}`;
  console.log(`\n▶ job#${job.id}  ${job.year}-${job.season}  → ${slug}`);
  const t0 = Date.now();
  try {
    // 1) 無人生成（batch-generate: generate → 年号かな化 → Layer3 → TTS → stockize）
    //    曲選択カスタマイズ: job.songs（generations.songs jsonb・選択曲IDの配列）があれば
    //    その曲だけで生成（must-use）。null/空 = お任せ（従来）。
    const batchArgs = ['scripts/batch-generate.mjs', '--targets', `${job.year}-${job.season}`, '--slug-suffix', suffix, '--base', BASE, '--generation-id', String(job.id)];
    if (Array.isArray(job.songs) && job.songs.length > 0) {
      batchArgs.push('--song-ids', job.songs.join(','));
    }
    runInherit('node', batchArgs, CWD);
    // 2) 音声を Blob へ（redial の既存 upload スクリプトを再利用）
    const out = runCapture('node', ['scripts/upload-stock-to-blob.mjs', slug], REDIAL);
    const audioBase = (out.match(/AUDIO_BASE_URL=(\S+)/) || [])[1];
    if (!audioBase) throw new Error('Blobアップロードで AUDIO_BASE_URL を取得できませんでした');
    // 3) 再生用エピソードJSONを構築（ファイル非依存・DBに自己完結で持つ）
    const episode = buildEpisode(slug, job, audioBase);
    // 4) ready に更新
    const { error } = await supa.from('generations')
      .update({ status: 'ready', slug, episode, error: null, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    if (error) throw new Error(`ready更新失敗: ${error.message}`);
    console.log(`✓ job#${job.id} ready（${Math.round((Date.now() - t0) / 1000)}s, critical ${episode.grounding?.critical ?? '?'}）`);
  } catch (e) {
    console.error(`✗ job#${job.id} 失敗: ${e.message}`);
    await supa.from('generations')
      .update({ status: 'failed', error: String(e.message).slice(0, 1000), updated_at: new Date().toISOString() })
      .eq('id', job.id);
  } finally {
    cleanup(slug); // 音声はBlob・再生データはDBにあるのでローカル一時は掃除
  }
}

function buildEpisode(slug, job, audioBase) {
  const stock = JSON.parse(fs.readFileSync(path.join(STOCK_ROOT, slug, 'stock.json'), 'utf8'));
  const segments = (stock.segments ?? []).map((s) => ({
    segmentIndex: s.segmentIndex,
    segmentName: s.segmentName,
    segmentLabel: s.segmentLabel ?? null,
    audioSrc: `${audioBase}/stock/${slug}/segments/seg${s.segmentIndex}-${s.segmentName}.mp3`,
    songAfter: s.songAfter ? { title: s.songAfter.title, artist: s.songAfter.artist, videoId: s.songAfter.videoId ?? null } : null,
  }));
  let grounding = null;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(STOCK_ROOT, slug, 'grounding-report.json'), 'utf8'));
    grounding = { critical: r.criticalCount ?? 0, minor: r.minorCount ?? 0 };
  } catch { /* レポート無し */ }
  return {
    slug,
    year: job.year,
    season: job.season,
    durationMin: Math.round((stock.totalDurationSec ?? 0) / 60),
    segments,
    songs: segments.flatMap((s) => (s.songAfter ? [s.songAfter] : [])),
    grounding,
    generatedAt: new Date().toISOString(),
  };
}

function cleanup(slug) {
  try { fs.rmSync(path.join(STOCK_ROOT, slug), { recursive: true, force: true }); } catch { /* noop */ }
  try { fs.rmSync(path.join(SCRIPTS_ROOT, `${slug}-v1.json`), { force: true }); } catch { /* noop */ }
}

function runInherit(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}
function runCapture(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function normalizeUrl(u) { if (!u) return u; u = String(u).trim(); return /^https?:\/\//.test(u) ? u : `https://${u}`; }
function loadEnvLocal(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}
