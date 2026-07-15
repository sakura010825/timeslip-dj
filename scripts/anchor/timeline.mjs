/**
 * 長尺アンカーのタイムライン構築（T2-6 / 設計: redial/docs/ANCHOR_VIDEO_DESIGN_2026-07.md）
 *
 * stock.json の segments を順に並べ、各 segment の songAfter を「曲スロット予告カード」に変換する。
 * 尺は stock.json の estimatedDurationSec（概算）ではなく ffprobe の実測を使う
 * （概算は実mp3より短く、曲紹介の末尾を落とす。ショートCLIの f67ac76 と同じ教訓）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { STOCK_ROOT, readJson } from '../shorts/util.mjs';

const SEASON_JP = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

/** slug（1995-autumn-09 等）→ { year, season, seasonJP, label } */
export function parseCell(cell) {
  const [year, season] = cell.split('-');
  return {
    year,
    season,
    seasonJP: SEASON_JP[season] ?? '',
    label: `${year}年・${SEASON_JP[season] ?? season}`,
  };
}

/** ffprobe で mp3 の実尺（秒）を取る */
export function probeDuration(mp3Path) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      mp3Path,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      const n = Number.parseFloat(out.trim());
      if (code !== 0 || !Number.isFinite(n)) {
        reject(new Error(`ffprobe 失敗 (${code}): ${mp3Path}\n${err.slice(-400)}`));
        return;
      }
      resolve(+n.toFixed(3));
    });
  });
}

/**
 * cells（1つ=単セル / 複数=合本）→ 時間軸に並んだ items。
 * item: { type: 'talk'|'song'|'season', cell, start, dur, ... }
 */
export async function buildTimeline({ cells, songCardSec, seasonCardSec }) {
  const items = [];
  const cellRanges = [];
  let t = 0;

  for (let ci = 0; ci < cells.length; ci++) {
    const cell = cells[ci];
    const stockPath = path.join(STOCK_ROOT, cell, 'stock.json');
    if (!fs.existsSync(stockPath)) {
      throw new Error(`stock.json が見つかりません: ${stockPath}（--cell の値=slugを確認）`);
    }
    const stock = readJson(stockPath);
    const segs = [...(stock.segments ?? [])].sort((a, b) => a.segmentIndex - b.segmentIndex);
    if (!segs.length) throw new Error(`${cell}: segments が空です`);

    const cellStart = t;

    // 合本では各セルの頭に「1995年・夏」の季節カードを差す（額縁＝走馬灯の型C思想／SHORTS_PLAYBOOK §8.3）
    if (cells.length > 1) {
      items.push({ type: 'season', cell, start: t, dur: seasonCardSec, ...parseCell(cell) });
      t += seasonCardSec;
    }

    for (const seg of segs) {
      const mp3Path = path.join(STOCK_ROOT, cell, 'segments', `seg${seg.segmentIndex}-${seg.segmentName}.mp3`);
      if (!fs.existsSync(mp3Path)) {
        throw new Error(`seg音声が見つかりません: ${mp3Path}`);
      }
      const dur = await probeDuration(mp3Path);
      items.push({
        type: 'talk',
        cell,
        seg: seg.segmentIndex,
        segmentName: seg.segmentName,
        segmentLabel: seg.segmentLabel ?? seg.segmentName,
        mp3Path,
        start: t,
        dur,
        estimatedDurationSec: seg.estimatedDurationSec ?? null,
      });
      t += dur;

      // 曲スロット＝トークのみ版では「流れない曲」。予告カードに変換してCTAにする（MARKETING_FUNNEL §3.1-3）
      const song = seg.songAfter;
      if (song?.title) {
        items.push({
          type: 'song',
          cell,
          seg: seg.segmentIndex,
          start: t,
          dur: songCardSec,
          title: song.title,
          artist: song.artist ?? '',
        });
        t += songCardSec;
      }
    }

    cellRanges.push({ cell, start: cellStart, end: t, ...parseCell(cell) });
  }

  return { items, cellRanges, talkTotal: +t.toFixed(3) };
}
