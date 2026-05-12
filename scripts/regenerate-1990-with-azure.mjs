/**
 * 1990秋の input.raw.txt を Azure で再生成。
 * hide-san が今朝編集した4セグメントと同じ入力で、Azure の素の品質を測る。
 */

import fs from 'node:fs';
import path from 'node:path';

const ARCHIVE_ROOT = path.resolve(process.cwd(), '.tts-archive');
const BASE = 'http://localhost:3001';

const SOURCE = {
  0: { dir: '2026-05-12_12-14-02_seg0', title: 'オープニング' },
  1: { dir: '2026-05-12_12-30-55_seg1', title: 'ミドルトーク1' },
  2: { dir: '2026-05-12_12-43-01_seg2', title: 'ミドルトーク2' },
  3: { dir: '2026-05-12_12-55-40_seg3', title: 'エンディング' },
};

const results = [];
for (const segIdx of [0, 1, 2, 3]) {
  const src = SOURCE[segIdx];
  const inputPath = path.join(ARCHIVE_ROOT, src.dir, 'input.raw.txt');
  const text = fs.readFileSync(inputPath, 'utf8');
  console.log(`\n[seg${segIdx}] ${src.title}: ${text.length} chars`);

  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      metadata: {
        segmentIndex: segIdx,
        segmentTitle: src.title,
        year: '1990',
        month: '10',
        season: 'autumn',
      },
    }),
  });
  const ms = Date.now() - t0;

  if (!res.ok) {
    const body = await res.text();
    console.error(`  FAIL ${res.status}: ${body.slice(0, 200)}`);
    continue;
  }
  const data = await res.json();
  console.log(`  archiveId: ${data.archiveId}`);
  console.log(`  ${data.chunks.length} chunks, ${data.outputBytes} bytes, ${ms}ms`);
  results.push({ segIdx, archiveId: data.archiveId, chunks: data.chunks.length, ms });
}

console.log('\n=== 完了 ===');
console.table(results);
console.log('\n編集UI で各 archiveId を確認して、素の品質を試聴してください。');
