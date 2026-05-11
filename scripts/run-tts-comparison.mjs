/**
 * 旧モデル（tts-1-hd）の入力テキストを新モデル（環境変数 TTS_MODEL）で再生成し、
 * .tts-archive/ 配下にアーカイブを作成する。
 *
 * 使い方:
 *   node scripts/run-tts-comparison.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ARCHIVE_ROOT = path.resolve(process.cwd(), '.tts-archive');
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3001';

const OLD_RUNS = {
  0: { dir: '2026-04-30_14-48-33_seg0', title: 'オープニング' },
  1: { dir: '2026-04-30_14-51-25_seg1', title: 'ミドルトーク1' },
  2: { dir: '2026-04-30_14-54-39_seg2', title: 'ミドルトーク2' },
  3: { dir: '2026-04-30_14-58-29_seg3', title: 'エンディング' },
};

const results = [];

for (const segIdx of [0, 1, 2, 3]) {
  const { dir, title } = OLD_RUNS[segIdx];
  const txt = fs.readFileSync(path.join(ARCHIVE_ROOT, dir, 'input.raw.txt'), 'utf8');
  console.log(`\n[seg${segIdx}] ${title}: ${txt.length} chars — posting...`);

  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: txt,
      metadata: {
        segmentIndex: segIdx,
        segmentTitle: title,
        year: '1995',
        month: '10',
        season: 'autumn',
      },
    }),
  });
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[seg${segIdx}] FAIL status=${res.status} body=${errBody.slice(0, 200)}`);
    results.push({ segIdx, ok: false, status: res.status, elapsedSec });
    continue;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`[seg${segIdx}] OK ${res.status}, ${buf.length} bytes, ${elapsedSec}s`);
  results.push({ segIdx, ok: true, bytes: buf.length, elapsedSec });
}

console.log('\n=== summary ===');
console.table(results);
console.log(`\nNew archive entries are under ${ARCHIVE_ROOT}/. Find the latest 4 directories.`);
