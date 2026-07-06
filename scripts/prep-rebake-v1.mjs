/**
 * onyx焼き直し前処理: Azure製11本の v1.json を整える。
 *
 * やること:
 *   1. data/scripts/{slug}-v1.json が無い episode は stock/{slug}/scripts/seg*.txt
 *      （= stockize が書き出した最終・編集後台本）から v1.json を再構築する。
 *      楽曲メタ（songTitle/artistName）は stock.json の songAfter から補完。
 *   2. 全 episode の各セグメント script に kanaizeYears を適用（19xx/20xx年 → かな）。
 *      onyx の年号誤読（にせん/桁読み）を防ぐ。retts は台本をそのまま読むため前処理が必須。
 *   3. 既存 v1.json がある episode は、台本が seg*.txt（公開された音声の実体）と
 *      乖離していないか類似度を報告（pre-edit台本の取り違え検出）。
 *
 * 出力先: ../redial/data/scripts/{slug}-v1.json （master redial）
 * usage: node scripts/prep-rebake-v1.mjs [--write] [--slugs a,b,c] [--from-txt]
 *   --write 無しは dry-run（差分レポートのみ）。--write で実際に書き込む。
 *   --slugs   対象slugをカンマ区切りで指定（省略時はAzure製11本の既定リスト）
 *   --from-txt 既存v1.jsonがあっても seg*.txt から強制的に再構築する
 *             （台本を直接修正した後の焼き直し＝S3リベイク等はこちらを使う。
 *              既存v1は修正前台本のことがあるため）
 */
import fs from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
const STOCK_ROOT = path.resolve(CWD, '..', 'redial', 'data', 'stock');
const SCRIPTS_ROOT = path.resolve(CWD, '..', 'redial', 'data', 'scripts');
const WRITE = process.argv.includes('--write');
const FROM_TXT = process.argv.includes('--from-txt');
const slugsIdx = process.argv.indexOf('--slugs');

const DEFAULT_SLUGS = [
  '1990-spring', '1990-summer', '1990-autumn', '1990-winter',
  '1995-spring', '1995-summer', '1995-winter',
  '2000-spring', '2000-summer', '2000-autumn', '2000-winter',
];
const SLUGS = slugsIdx >= 0
  ? String(process.argv[slugsIdx + 1]).split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_SLUGS;

// ─── 年号かな化（batch-generate.mjs と同一ロジック）───────────
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

// 空白除去して比較用に正規化
const norm = (s) => (s ?? '').replace(/\s+/g, '');
function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  // 文字単位の素朴な一致率（lengthベース＋共通プレフィックス/サフィックス目安）でも十分。
  // ここでは長さ差比率で乖離を検出（編集差し替えは局所的なので長さは近い）。
  return 1 - Math.abs(a.length - b.length) / max;
}

let totalKana = 0;
for (const slug of SLUGS) {
  const stockPath = path.join(STOCK_ROOT, slug, 'stock.json');
  if (!fs.existsSync(stockPath)) { console.error(`✗ stock.json なし: ${slug}`); continue; }
  const stock = JSON.parse(fs.readFileSync(stockPath, 'utf8'));
  const segs = stock.segments.slice().sort((a, b) => a.segmentIndex - b.segmentIndex);
  const v1Path = path.join(SCRIPTS_ROOT, `${slug}-v1.json`);
  const hasV1 = fs.existsSync(v1Path);

  // seg*.txt（公開音声の実体台本）を読む
  const txtScripts = segs.map((s) => {
    const txtPath = path.join(STOCK_ROOT, slug, 'scripts', `seg${s.segmentIndex}-${s.segmentName}.txt`);
    if (!fs.existsSync(txtPath)) return null;
    // 各非空行を段落として扱う（\n\n 結合）。元の段落phrasing/ポーズを近似復元。
    return fs.readFileSync(txtPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).join('\n\n');
  });

  let v1;
  let source;
  if (hasV1 && !FROM_TXT) {
    v1 = JSON.parse(fs.readFileSync(v1Path, 'utf8'));
    source = 'existing-v1';
    // 乖離チェック: 既存v1の各segが seg*.txt と近いか
    const sims = v1.segments.map((s, i) => txtScripts[i] != null ? similarity(s.script, txtScripts[i]) : null);
    const minSim = Math.min(...sims.filter((x) => x != null));
    if (minSim < 0.9) {
      console.warn(`  ⚠️ ${slug}: 既存v1とseg*.txtが乖離 (minSim=${minSim.toFixed(2)}) sims=[${sims.map((x) => x == null ? '-' : x.toFixed(2)).join(',')}] → seg*.txt採用を検討`);
    }
  } else {
    // seg*.txt から再構築
    const segments = segs.map((s, i) => ({
      segmentTitle: s.segmentLabel,
      script: txtScripts[i] ?? '',
      songTitle: s.songAfter?.title ?? null,
      artistName: s.songAfter?.artist ?? null,
    }));
    v1 = { segments, metadata: { reconstructedFrom: 'stock seg*.txt', slug, reconstructedFor: 'onyx-rebake' } };
    source = 'rebuilt-from-txt';
  }

  // かな化
  let kanaCount = 0;
  for (const s of v1.segments) {
    const before = s.script;
    s.script = kanaizeYears(s.script);
    if (s.script !== before) kanaCount++;
  }
  totalKana += kanaCount;

  if (WRITE) fs.writeFileSync(v1Path, JSON.stringify(v1, null, 2), 'utf8');
  console.log(`${WRITE ? '✓' : '·'} ${slug.padEnd(13)} [${source.padEnd(16)}] segs=${v1.segments.length} 年号かな化=${kanaCount}/${v1.segments.length}`);
}
console.log(`\n${WRITE ? '書き込み完了' : 'dry-run（--write で書き込み）'} / 年号かな化セグメント合計=${totalKana}`);
