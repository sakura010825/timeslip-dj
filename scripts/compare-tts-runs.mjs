/**
 * 旧モデル（tts-1-hd）と新モデル（gpt-4o-mini-tts）の meta.json を横並び比較。
 *
 * 使い方:
 *   node scripts/compare-tts-runs.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ARCHIVE_ROOT = path.resolve(process.cwd(), '.tts-archive');

const OLD = {
  0: '2026-04-30_14-48-33_seg0',
  1: '2026-04-30_14-51-25_seg1',
  2: '2026-04-30_14-54-39_seg2',
  3: '2026-04-30_14-58-29_seg3',
};

// 新エントリは「最新の seg0..seg3」を自動検出
function findLatestForSeg(segIdx) {
  const dirs = fs
    .readdirSync(ARCHIVE_ROOT)
    .filter((d) => d.endsWith(`_seg${segIdx}`) && !Object.values(OLD).includes(d))
    .sort();
  return dirs[dirs.length - 1];
}

function loadMeta(dir) {
  const p = path.join(ARCHIVE_ROOT, dir, 'meta.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

console.log('# TTS Run Comparison: tts-1-hd → gpt-4o-mini-tts\n');

const summaryRows = [];

for (const segIdx of [0, 1, 2, 3]) {
  const oldDir = OLD[segIdx];
  const newDir = findLatestForSeg(segIdx);
  if (!newDir) {
    console.log(`seg${segIdx}: NEW run not found, skipping`);
    continue;
  }
  const oldMeta = loadMeta(oldDir);
  const newMeta = loadMeta(newDir);

  const okCount = (chunks) => chunks.filter((c) => c.verification?.ok).length;
  const oldOk = okCount(oldMeta.chunks);
  const newOk = okCount(newMeta.chunks);
  const total = oldMeta.chunks.length;

  console.log(`\n## seg${segIdx} (${oldMeta.segmentTitle ?? '?'})`);
  console.log(`  old: ${oldDir}`);
  console.log(`  new: ${newDir}`);
  console.log(
    `  TTS model: ${oldMeta.tts?.model ?? 'tts-1-hd (old, unrecorded)'} → ${
      newMeta.tts?.model ?? '?'
    }`,
  );
  console.log(`  chunks ok: ${oldOk}/${total} → ${newOk}/${total}`);
  console.log(
    `  total attempts: ${oldMeta.totalChunkAttempts} → ${newMeta.totalChunkAttempts} ` +
      `(${newMeta.totalChunkAttempts - oldMeta.totalChunkAttempts > 0 ? '+' : ''}${
        newMeta.totalChunkAttempts - oldMeta.totalChunkAttempts
      })`,
  );
  console.log(
    `  pipeline time: ${(oldMeta.pipelineMs / 1000).toFixed(1)}s → ${(
      newMeta.pipelineMs / 1000
    ).toFixed(1)}s`,
  );
  console.log(
    `  estimated audio: ${oldMeta.estimatedDurationSec}s → ${newMeta.estimatedDurationSec}s`,
  );
  console.log(`  warnings (old): ${(oldMeta.warnings ?? []).join(' / ') || '-'}`);
  console.log(`  warnings (new): ${(newMeta.warnings ?? []).join(' / ') || '-'}`);

  // チャンク別の最終 verification 比較
  console.log(`\n  chunk-level diff (showing chunks where status changed):`);
  for (let i = 0; i < Math.min(oldMeta.chunks.length, newMeta.chunks.length); i++) {
    const o = oldMeta.chunks[i];
    const n = newMeta.chunks[i];
    const oOk = o.verification?.ok ? '✓' : '✗';
    const nOk = n.verification?.ok ? '✓' : '✗';
    if (oOk !== nOk || (n.attempts ?? 0) !== (o.attempts ?? 0)) {
      const oneLine = (o.text ?? '').slice(0, 40).replace(/\n/g, ' ');
      console.log(
        `    [${i}] ${oOk}(${o.attempts}att) → ${nOk}(${n.attempts}att)  「${oneLine}…」`,
      );
      if (!n.verification?.ok) {
        console.log(
          `        new failure: ${n.verification?.reason ?? '?'} sim=${
            n.verification?.similarity
          }`,
        );
        console.log(`        transcript: ${(n.verification?.transcript ?? '').slice(0, 100)}`);
      }
    }
  }

  summaryRows.push({
    seg: segIdx,
    title: oldMeta.segmentTitle,
    'old ok': `${oldOk}/${total}`,
    'new ok': `${newOk}/${total}`,
    'old attempts': oldMeta.totalChunkAttempts,
    'new attempts': newMeta.totalChunkAttempts,
    'old sec': (oldMeta.pipelineMs / 1000).toFixed(1),
    'new sec': (newMeta.pipelineMs / 1000).toFixed(1),
  });
}

console.log('\n\n=== Summary ===');
console.table(summaryRows);
