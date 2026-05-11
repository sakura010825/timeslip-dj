/**
 * 編集ワークフローのエンドツーエンドテスト
 *
 * 1. 既存 archive の input.raw.txt を新 /api/tts に投入 → JSON response 確認
 * 2. chunks[] と outputUrl が含まれていることを確認
 * 3. /api/tts/chunk で1チャンク編集 → 再生成と output 再構築を確認
 * 4. アセットサーバ経由でMP3取得確認
 */

import fs from 'node:fs';
import path from 'node:path';

const ARCHIVE_ROOT = path.resolve(process.cwd(), '.tts-archive');
const BASE_URL = 'http://localhost:3001';

const SOURCE = '2026-04-30_14-48-33_seg0'; // オープニング、9チャンクあり

console.log('# 編集ワークフローE2Eテスト\n');

// ===== Step 1: 新規 /api/tts で archive 作成 =====
console.log('## Step 1: /api/tts でセグメント生成');
const inputText = fs.readFileSync(path.join(ARCHIVE_ROOT, SOURCE, 'input.raw.txt'), 'utf8');
console.log(`input: ${inputText.length} chars from ${SOURCE}`);

const t0 = Date.now();
const genRes = await fetch(`${BASE_URL}/api/tts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: inputText,
    metadata: { segmentIndex: 0, segmentTitle: 'E2Eテスト オープニング', year: '1995', month: '10', season: 'autumn' },
  }),
});
console.log(`response: status=${genRes.status} content-type=${genRes.headers.get('content-type')}`);
if (!genRes.ok) {
  console.error('FAIL:', await genRes.text());
  process.exit(1);
}
const genJson = await genRes.json();
const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`archiveId: ${genJson.archiveId}`);
console.log(`outputUrl: ${genJson.outputUrl}`);
console.log(`outputBytes: ${genJson.outputBytes}`);
console.log(`chunks: ${genJson.chunks.length}`);
console.log(`warnings: ${JSON.stringify(genJson.warnings)}`);
console.log(`elapsed: ${elapsedSec}s`);

// 必須フィールドの検証
const required = ['archiveId', 'outputUrl', 'outputBytes', 'chunks', 'pipelineMs'];
for (const f of required) {
  if (!(f in genJson)) {
    console.error(`FAIL: missing field "${f}" in response`);
    process.exit(1);
  }
}

console.log('\nfirst 3 chunks:');
for (const c of genJson.chunks.slice(0, 3)) {
  console.log(`  [${c.index}] "${c.text.slice(0, 30)}..." mp3Url=${c.mp3Url.slice(-40)} bytes=${c.mp3Bytes}`);
}

// ===== Step 2: chunks/ ディレクトリが実在するか =====
console.log('\n## Step 2: chunks/ ディレクトリの実在確認');
const chunksDir = path.join(ARCHIVE_ROOT, genJson.archiveId, 'chunks');
const chunkFiles = fs.readdirSync(chunksDir);
console.log(`  ${chunksDir}: ${chunkFiles.length} files`);
console.log(`  ${chunkFiles.slice(0, 3).join(', ')}, ...`);

if (chunkFiles.length !== genJson.chunks.length) {
  console.error(`FAIL: chunks count mismatch (meta=${genJson.chunks.length} files=${chunkFiles.length})`);
  process.exit(1);
}

// ===== Step 3: アセットサーバ経由でMP3取得 =====
console.log('\n## Step 3: アセットサーバ経由でチャンクMP3取得');
const firstChunkUrl = `${BASE_URL}${genJson.chunks[0].mp3Url}`;
const assetRes = await fetch(firstChunkUrl);
console.log(`  GET ${firstChunkUrl.slice(0, 100)}...`);
console.log(`  status=${assetRes.status} content-type=${assetRes.headers.get('content-type')} bytes=${assetRes.headers.get('content-length')}`);

if (!assetRes.ok || assetRes.headers.get('content-type') !== 'audio/mpeg') {
  console.error(`FAIL: asset fetch failed`);
  process.exit(1);
}

// ===== Step 4: 1チャンク編集 =====
console.log('\n## Step 4: /api/tts/chunk で1チャンク編集');
const targetChunk = genJson.chunks[0];
const newText = 'こんばんは。シンヤです。これは編集ワークフローの動作確認です。';
console.log(`  target: chunk[${targetChunk.index}]`);
console.log(`  before: "${targetChunk.text}"`);
console.log(`  after:  "${newText}"`);

const editRes = await fetch(`${BASE_URL}/api/tts/chunk`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    archiveId: genJson.archiveId,
    chunkIndex: targetChunk.index,
    newText,
  }),
});
console.log(`  response: status=${editRes.status}`);
if (!editRes.ok) {
  console.error('FAIL:', await editRes.text());
  process.exit(1);
}
const editJson = await editRes.json();
console.log(`  updatedChunkIndex: ${editJson.updatedChunkIndex}`);
console.log(`  ttsMs: ${editJson.ttsMs}`);
console.log(`  new outputBytes: ${editJson.outputBytes} (was ${genJson.outputBytes})`);
console.log(`  chunk[0].previousText preserved: ${editJson.chunks[0].previousText?.slice(0, 30)}...`);
console.log(`  chunk[0].editedAt: ${editJson.chunks[0].editedAt}`);

// ===== Step 5: 再生成後の output.mp3 を取得確認 =====
console.log('\n## Step 5: 編集後の output.mp3 取得');
const outRes = await fetch(`${BASE_URL}${editJson.outputUrl}`);
console.log(`  status=${outRes.status} bytes=${outRes.headers.get('content-length')}`);
if (!outRes.ok) {
  console.error('FAIL');
  process.exit(1);
}

// ===== 完了 =====
console.log('\n✓ All steps passed');
console.log(`\n  archive: ${genJson.archiveId}`);
console.log(`  edited chunk index: ${editJson.updatedChunkIndex}`);
console.log(`  to listen: open ${ARCHIVE_ROOT}\\${genJson.archiveId}\\output.mp3`);
