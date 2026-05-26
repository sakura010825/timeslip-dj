/**
 * 既存 stock/{slug}/stock.json に segments[].songAfter フィールドを追加する
 * マイグレーションスクリプト
 *
 * 取得元の優先順:
 *   1. data/scripts/{slug}-v1.json があれば、そこから segments[N].songTitle/artistName を取得
 *   2. なければ stock/{slug}/scripts/seg{N}-{name}.txt をパースして楽曲言及を抽出
 *
 * videoId 解決:
 *   - data/youtube-candidates/{year}.json でマッチング
 *   - なければ null（再生時に動的フォールバック）
 *
 * 出力:
 *   - stock/{slug}/stock.json を上書き
 *
 * 使い方:
 *   node scripts/migrate-stock-songs.mjs            # 全12本
 *   node scripts/migrate-stock-songs.mjs --slug 1990-spring  # 特定スロット
 *   node scripts/migrate-stock-songs.mjs --dry-run  # 上書きせずプレビュー
 */

import fs from 'node:fs';
import path from 'node:path';

const STOCK_ROOT = path.resolve(process.cwd(), '..', 'redial', 'data', 'stock');
const SCRIPTS_ROOT = path.resolve(process.cwd(), '..', 'redial', 'data', 'scripts');
const YT_CANDIDATES_ROOT = path.resolve(process.cwd(), '..', 'redial', 'data', 'youtube-candidates');

const args = parseArgs(process.argv.slice(2));
const DRY_RUN = args['dry-run'] !== undefined;

// Phase 1 拡張版12本（1995年秋は旧形式 1995-autumn-09 で代用）
// TODO: 戦略書 Ver.1.6 TODO #17 で「1995秋を新基準 30項目・走馬灯型へ拡充」が残課題
const PHASE1_SLUGS = [
  '1990-spring', '1990-summer', '1990-autumn', '1990-winter',
  '1995-spring', '1995-summer', '1995-autumn-09', '1995-winter',
  '2000-spring', '2000-summer', '2000-autumn', '2000-winter',
];

const targetSlugs = args.slug ? [args.slug] : PHASE1_SLUGS;

// YouTube candidates をyear毎にロード
const ytCandidatesByYear = {};
function loadYTCandidates(year) {
  if (year in ytCandidatesByYear) return ytCandidatesByYear[year];
  const p = path.join(YT_CANDIDATES_ROOT, `${year}.json`);
  if (!fs.existsSync(p)) {
    ytCandidatesByYear[year] = [];
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(data) ? data : data.candidates ?? [];
    ytCandidatesByYear[year] = arr;
    return arr;
  } catch (e) {
    console.warn(`[yt-candidates] failed to parse ${p}: ${e.message}`);
    ytCandidatesByYear[year] = [];
    return [];
  }
}

function normStr(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[／/].*$/, '') // A面/B面の除去（LOVE LOVE LOVE／嵐が来る → LOVE LOVE LOVE）
    .replace(/[「」『』〜～\s'"・]/g, '')
    .trim();
}

function resolveVideoId(title, artist, year) {
  const cands = loadYTCandidates(year);
  if (cands.length === 0) return null;
  const nt = normStr(title);
  const na = normStr(artist);
  const found = cands.find((c) => {
    const ct = normStr(c.title ?? c.songTitle ?? '');
    const ca = normStr(c.artist ?? c.artistName ?? '');
    return ct === nt && ca === na;
  });
  return found?.videoId ?? null;
}

/**
 * scripts/seg{N}-{name}.txt の末尾から「次の一曲は」「最後の一曲は」パターンで楽曲を抽出
 * パターン例:
 *   - 「次の一曲は、スピッツです。「ロビンソン」」
 *   - 「最初の一曲は、ケイエイエヌ。」 + 別行で曲名
 *   - 「次の曲は、プリンセス・プリンセス。1990年十一月リリースの「ジュリアン」」
 */
function extractSongFromTxt(txtPath, segIdx) {
  if (!fs.existsSync(txtPath)) return null;
  const txt = fs.readFileSync(txtPath, 'utf8');

  // パターン1: 「Xです。「Y」」「Xの「Y」」「Y」/X」のような形
  // パターン2: 「一曲は、X、「Y」」「一曲は、X。「Y」」
  // パターン3: 「X、「Y」です」

  // 「一曲は」or「曲は」を起点に、それ以降の最初の「」or 『』 引用句をタイトルと推定
  const patterns = [
    // パターンA: アーティスト名「曲名」
    /(?:次の(?:一)?曲は|最後の(?:一)?曲は|最初の(?:一)?曲は|今夜最後の(?:一)?曲は|三曲目は|二曲目は)[、。\s]*([^\s「『]+?)(?:です)?[。、]?\s*[「『]([^」』]+?)[」』]/,
    // パターンB: 「曲名」アーティスト名（順番逆）
    /[「『]([^」』]+?)[」』]\s*(?:を|お送り)/,
  ];

  for (const re of patterns) {
    const m = txt.match(re);
    if (m) {
      if (m.length >= 3) {
        return { artist: m[1].trim(), title: m[2].trim() };
      }
    }
  }

  return null;
}

function processSlug(slug) {
  const stockDir = path.join(STOCK_ROOT, slug);
  const stockJsonPath = path.join(stockDir, 'stock.json');
  if (!fs.existsSync(stockJsonPath)) {
    console.warn(`[${slug}] stock.json not found, skip`);
    return;
  }
  const stock = JSON.parse(fs.readFileSync(stockJsonPath, 'utf8'));
  const yearMatch = slug.match(/^(\d{4})/);
  const year = yearMatch ? yearMatch[1] : null;

  // 1. v1.json があれば最優先
  const v1Path = path.join(SCRIPTS_ROOT, `${slug}-v1.json`);
  let v1Songs = null;
  if (fs.existsSync(v1Path)) {
    try {
      const v1 = JSON.parse(fs.readFileSync(v1Path, 'utf8'));
      v1Songs = (v1.segments || []).map((s) => ({
        title: s.songTitle ?? null,
        artist: s.artistName ?? null,
      }));
      console.log(`[${slug}] using v1.json (${v1Songs.length} segments)`);
    } catch (e) {
      console.warn(`[${slug}] v1.json parse failed: ${e.message}`);
    }
  }

  // 2. 各 segment に songAfter を補完
  let changed = false;
  for (const seg of stock.segments) {
    const segIdx = seg.segmentIndex;
    // seg4 (エンディング後半) or旧形式 seg3 (エンディング) は曲なし
    const isLastSeg =
      (stock.format === 'walking-flame-v1' && segIdx === 4) ||
      (stock.format === 'legacy-v1' && segIdx === 3);
    if (isLastSeg) {
      if (seg.songAfter !== null) {
        seg.songAfter = null;
        changed = true;
      }
      continue;
    }

    // 既に songAfter があるならスキップ
    if (seg.songAfter && seg.songAfter.title) continue;

    // v1.json から取得
    let title = null;
    let artist = null;
    if (v1Songs && v1Songs[segIdx]) {
      title = v1Songs[segIdx].title;
      artist = v1Songs[segIdx].artist;
    }

    // txt regex 抽出は精度が低いため無効化。v1.json がない場合は null のままにして
    // 手動補完を促す（hideさん or 次セッションでの対応）
    if (!title || !artist) {
      console.warn(`  [seg${segIdx}] ⚠ songInfo not found (manual補完 required)`);
      seg.songAfter = null;
      changed = true;
      continue;
    }

    const videoId = resolveVideoId(title, artist, year);
    seg.songAfter = {
      title,
      artist,
      videoId,
      curatedAt: videoId ? new Date().toISOString().slice(0, 10) : null,
    };
    changed = true;
    console.log(`  [seg${segIdx}] ${artist} - ${title}${videoId ? ' ['+videoId+']' : ' (videoId未取得)'}`);
  }

  if (changed && !DRY_RUN) {
    fs.writeFileSync(stockJsonPath, JSON.stringify(stock, null, 2), 'utf8');
    console.log(`[${slug}] ✓ saved`);
  } else if (DRY_RUN) {
    console.log(`[${slug}] (dry-run, not saved)`);
  } else {
    console.log(`[${slug}] no changes`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? '' : argv[i + 1];
      out[k] = v;
      if (v) i++;
    }
  }
  return out;
}

console.log(`Migration targets: ${targetSlugs.join(', ')}`);
if (DRY_RUN) console.log('(dry-run mode)');
console.log('');

for (const slug of targetSlugs) {
  console.log(`\n=== ${slug} ===`);
  processSlug(slug);
}

console.log('\nDone.');
