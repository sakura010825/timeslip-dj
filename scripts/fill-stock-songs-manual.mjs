/**
 * 既存 stock/{slug}/stock.json の segments[].songAfter を、
 * memory・KB・scripts/seg{N}-*.txt から手動でキュレートした楽曲データで埋める。
 *
 * v1.json がない 8 本 + 1995-autumn-09 (legacy-v1) 用。
 * v1.json がある 4 本（1990-winter, 1995-spring, 1995-winter, 2000-winter）は
 * 既に migrate-stock-songs.mjs で対応済み。
 *
 * 使い方:
 *   node scripts/fill-stock-songs-manual.mjs
 *   node scripts/fill-stock-songs-manual.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';

const STOCK_ROOT = path.resolve(process.cwd(), '..', 'redial', 'data', 'stock');
const YT_CANDIDATES_ROOT = path.resolve(process.cwd(), '..', 'redial', 'data', 'youtube-candidates');

const DRY_RUN = process.argv.includes('--dry-run');

// memory / KB / scripts の各テキストから抽出した楽曲リスト
// 各エピソードの seg0..3 が紹介する楽曲（走馬灯型 v1 形式は 4曲、legacy v1 は3曲+ending）
const SONGS_BY_SLUG = {
  '1990-spring': [
    { title: '笑顔の行方', artist: 'DREAMS COME TRUE' },
    { title: '今すぐKiss Me', artist: 'LINDBERG' },
    { title: 'OH YEAH!', artist: 'プリンセス・プリンセス' },
    { title: 'おどるポンポコリン', artist: 'B.B.クィーンズ' },
  ],
  '1990-summer': [
    { title: "U Can't Touch This", artist: 'MC Hammer' },
    { title: 'P.S. I LOVE YOU', artist: 'PINK SAPPHIRE' },
    { title: '太陽のKomachi Angel', artist: "B'z" },
    { title: '真夏の果実', artist: 'サザンオールスターズ' },
  ],
  '1990-autumn': [
    { title: 'Easy Come, Easy Go!', artist: "B'z" },
    { title: '愛は勝つ', artist: 'KAN' },
    { title: '浪漫飛行', artist: '米米CLUB' },
    { title: 'クリスマス・イブ', artist: '山下達郎' },
  ],
  '1995-summer': [
    { title: 'ロビンソン', artist: 'スピッツ' },
    { title: 'シーソーゲーム 〜勇敢な恋の歌〜', artist: 'Mr.Children' },
    { title: 'Hello, Again 〜昔からある場所〜', artist: 'MY LITTLE LOVER' },
    { title: 'LOVE LOVE LOVE', artist: 'DREAMS COME TRUE' },
  ],
  // 1995-autumn-09 は legacy-v1（4セグ）：seg0,1,2 に楽曲、seg3 はエンディングで曲なし
  '1995-autumn-09': [
    { title: 'LOVE LOVE LOVE', artist: 'DREAMS COME TRUE' },
    { title: '空も飛べるはず', artist: 'スピッツ' },
    { title: 'Over Drive', artist: 'JUDY AND MARY' },
    null, // seg3 = エンディング、曲なし
  ],
  '2000-spring': [
    { title: 'LOVE 2000', artist: 'hitomi' },
    { title: 'Wait & See 〜リスク〜', artist: '宇多田ヒカル' },
    { title: '桜坂', artist: '福山雅治' },
    { title: 'TSUNAMI', artist: 'サザンオールスターズ' },
  ],
  '2000-summer': [
    { title: 'TSUNAMI', artist: 'サザンオールスターズ' },
    { title: '桜坂', artist: '福山雅治' },
    { title: 'OK!', artist: '松本梨香' },
    { title: '慎吾ママのおはロック', artist: '慎吾ママ' },
  ],
  '2000-autumn': [
    { title: 'NOT FOUND', artist: 'Mr.Children' },
    { title: 'サウダージ', artist: 'ポルノグラフィティ' },
    { title: '月光', artist: '鬼束ちひろ' },
    { title: 'Independent Women Part I', artist: "Destiny's Child" },
  ],
};

// YouTube candidates キャッシュ
const ytByYear = {};
function loadYT(year) {
  if (year in ytByYear) return ytByYear[year];
  const p = path.join(YT_CANDIDATES_ROOT, `${year}.json`);
  if (!fs.existsSync(p)) {
    ytByYear[year] = [];
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(data) ? data : data.candidates ?? [];
    ytByYear[year] = arr;
    return arr;
  } catch {
    ytByYear[year] = [];
    return [];
  }
}

function norm(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[／/].*$/, '')
    .replace(/[「」『』〜～\s'"・]/g, '')
    .trim();
}

function resolveVideoId(title, artist, year) {
  const cands = loadYT(year);
  if (cands.length === 0) return null;
  const found = cands.find((c) => {
    const ct = norm(c.title ?? c.songTitle ?? '');
    const ca = norm(c.artist ?? c.artistName ?? '');
    return ct === norm(title) && ca === norm(artist);
  });
  return found?.videoId ?? null;
}

function processSlug(slug) {
  const songsList = SONGS_BY_SLUG[slug];
  if (!songsList) {
    console.log(`[${slug}] no manual data, skip`);
    return;
  }
  const stockPath = path.join(STOCK_ROOT, slug, 'stock.json');
  if (!fs.existsSync(stockPath)) {
    console.warn(`[${slug}] stock.json not found, skip`);
    return;
  }
  const stock = JSON.parse(fs.readFileSync(stockPath, 'utf8'));
  const year = slug.match(/^(\d{4})/)?.[1];

  let changed = false;
  for (const seg of stock.segments) {
    const segIdx = seg.segmentIndex;
    // 最後のセグメント (走馬灯v1=seg4, legacy=seg3) は曲なし
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
    // 既に title/artist が入っているならスキップ（v1.jsonで既に補完済み）
    if (seg.songAfter?.title && seg.songAfter?.artist) {
      console.log(`  [seg${segIdx}] already filled: ${seg.songAfter.artist} - ${seg.songAfter.title}`);
      continue;
    }
    const songData = songsList[segIdx];
    if (!songData) {
      console.warn(`  [seg${segIdx}] no song data in manual list`);
      continue;
    }
    const videoId = resolveVideoId(songData.title, songData.artist, year);
    seg.songAfter = {
      title: songData.title,
      artist: songData.artist,
      videoId,
      curatedAt: videoId ? new Date().toISOString().slice(0, 10) : null,
    };
    changed = true;
    console.log(`  [seg${segIdx}] ${songData.artist} - ${songData.title}${videoId ? ' ['+videoId+']' : ' (videoId未取得)'}`);
  }

  if (changed && !DRY_RUN) {
    fs.writeFileSync(stockPath, JSON.stringify(stock, null, 2), 'utf8');
    console.log(`[${slug}] ✓ saved`);
  } else if (DRY_RUN) {
    console.log(`[${slug}] (dry-run, not saved)`);
  } else {
    console.log(`[${slug}] no changes`);
  }
}

console.log('Filling stock songs from manual curation data...');
if (DRY_RUN) console.log('(dry-run mode)');
console.log('');

for (const slug of Object.keys(SONGS_BY_SLUG)) {
  console.log(`=== ${slug} ===`);
  processSlug(slug);
  console.log('');
}

console.log('Done.');
