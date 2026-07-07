/**
 * Supabase 論理バックアップ（T0-4d・redial docs/OPS_WORKER_RESILIENCE_2026-07.md §4）。
 *
 * 最も代替不能なのは Supabase DB のユーザー生成回（generations.episode jsonb）。
 * 台本本文は非永続設計なので、DBが消えると再生成不可＝全消失する。Supabase本体の
 * 自動バックアップ(PITR)有効化とは別に、この軽量スクリプトで週次の論理ダンプを取り、
 * 「DB丸ごと消失」の最悪を回避する。pg_dump バイナリに依存せず supabase-js で
 * 各テーブルを JSON エクスポートする（Windowsでそのまま動く）。
 *
 * 使い方（timeslip-dj で・.env.local に SUPABASE_SERVICE_ROLE_KEY 前提）:
 *   node scripts/backup-supabase.mjs
 *   node scripts/backup-supabase.mjs --out D:/redial-backups   （出力先を指定）
 *
 * 週次自動化は Windows タスクスケジューラで本スクリプトを週1実行（docs参照）。
 * 出力: <out>/redial-backup-YYYYMMDD-HHmmss/<table>.json ＋ manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const CWD = process.cwd();
loadEnvLocal(path.resolve(CWD, '.env.local'));

const SUPABASE_URL = normalizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を .env.local に設定してください。');
  process.exit(1);
}

// バックアップ対象。generations が最重要（再生成不可）。members は Stripe から
// 再構築可能だが課金状態のスナップショットとして保存。events/requests は指標データ。
const TABLES = ['generations', 'members', 'requests', 'events', 'worker_heartbeat'];

const outArg = argValue('--out') ?? path.resolve(CWD, 'backups');
const stamp = timestamp();
const outDir = path.join(outArg, `redial-backup-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`Supabaseバックアップ開始 → ${outDir}`);
const manifest = { startedAt: new Date().toISOString(), tables: {} };
let hadError = false;

for (const table of TABLES) {
  try {
    const rows = await fetchAll(table);
    fs.writeFileSync(
      path.join(outDir, `${table}.json`),
      JSON.stringify(rows, null, 2),
    );
    manifest.tables[table] = { rows: rows.length };
    console.log(`  ✓ ${table}: ${rows.length} 行`);
  } catch (e) {
    hadError = true;
    manifest.tables[table] = { error: String(e.message) };
    console.error(`  ✗ ${table}: ${e.message}`);
  }
}

manifest.finishedAt = new Date().toISOString();
manifest.ok = !hadError;
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 古い世代の掃除（既定: 直近8世代=約2ヶ月分を残す）。
pruneOld(outArg, Number(process.env.BACKUP_KEEP ?? 8));

console.log(hadError ? '⚠ 一部テーブルで失敗（manifest.json 参照）' : '✅ バックアップ完了');
process.exit(hadError ? 1 : 0);

// ─── ページングで全行取得（Supabaseの1000行上限を回避）───
async function fetchAll(table) {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from(table)
      .select('*')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

function pruneOld(root, keep) {
  try {
    const dirs = fs
      .readdirSync(root)
      .filter((d) => d.startsWith('redial-backup-'))
      .sort();
    for (const d of dirs.slice(0, Math.max(0, dirs.length - keep))) {
      fs.rmSync(path.join(root, d), { recursive: true, force: true });
      console.log(`  (古い世代を削除: ${d})`);
    }
  } catch { /* 掃除失敗は致命でない */ }
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function normalizeUrl(u) {
  if (!u) return u;
  u = String(u).trim();
  return /^https?:\/\//.test(u) ? u : `https://${u}`;
}

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
