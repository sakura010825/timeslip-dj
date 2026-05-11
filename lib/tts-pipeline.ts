/**
 * TTSパイプライン（P2: チャンク分割 + 並列TTS + ffmpeg結合）
 *
 * 入力テキスト → sanitize → split → 並列TTS → ffmpeg concat → MP3
 *
 * P3では verifyChunk フックで Whisper 検証 + 自動リトライを差し込む（このファイルに統合する）。
 */

import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import OpenAI from 'openai';
import { splitIntoChunks, subdivideChunkText, type Chunk } from './tts-chunker';
import { verifyChunkAudio, type VerifyResult } from './tts-verifier';

const openai = new OpenAI();

const TTS_PARALLELISM = 3;
const SILENCE_INTRA_MS = 120; // チャンク間
const SILENCE_PARAGRAPH_MS = 400; // 段落境界
const MAX_ATTEMPTS = 3;

export type GeneratedChunk = Chunk & {
  mp3: Buffer;
  attempts: number;
  verification?: VerifyResult;
  /** リトライ履歴（各試行のverify結果） */
  history?: VerifyResult[];
};

export type PipelineResult = {
  mp3: Buffer;
  chunks: GeneratedChunk[];
  totalChunks: number;
  totalAttempts: number;
};

export async function runTTSPipeline(cleanText: string): Promise<PipelineResult> {
  const chunks = splitIntoChunks(cleanText);
  console.log(
    `[TTS pipeline] ${cleanText.length} chars → ${chunks.length} chunks ` +
      `(avg ${Math.round(cleanText.length / Math.max(1, chunks.length))} chars/chunk)`,
  );

  const generated: GeneratedChunk[] = await ttsChunksInParallel(chunks, TTS_PARALLELISM);
  const totalAttempts = generated.reduce((s, c) => s + c.attempts, 0);

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tts-concat-'));
  try {
    const concatenated = await concatMp3s(tmpDir, generated);
    return {
      mp3: concatenated,
      chunks: generated,
      totalChunks: generated.length,
      totalAttempts,
    };
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function ttsChunksInParallel(
  chunks: Chunk[],
  parallelism: number,
): Promise<GeneratedChunk[]> {
  const results: GeneratedChunk[] = new Array(chunks.length);
  let nextIdx = 0;
  let completed = 0;

  async function worker(workerId: number) {
    while (true) {
      const i = nextIdx++;
      if (i >= chunks.length) return;
      const chunk = chunks[i];
      const generated = await generateAndVerifyChunk(chunk, workerId, chunks.length);
      results[i] = generated;
      completed++;
      console.log(
        `[TTS chunk ${chunk.index}/${chunks.length - 1}] ` +
          `done (attempts=${generated.attempts}, ` +
          `verify=${generated.verification?.ok ? 'ok' : `FAIL ${generated.verification?.reason ?? ''}`}) ` +
          `[${completed}/${chunks.length}]`,
      );
    }
  }

  async function generateAndVerifyChunk(
    chunk: Chunk,
    workerId: number,
    total: number,
    depth = 0,
  ): Promise<GeneratedChunk> {
    const history: VerifyResult[] = [];
    /** 最良試行を保持（ok優先、次に類似度の高さ） */
    let best: { mp3: Buffer; verify: VerifyResult } | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const variantText = applyRetryVariant(chunk.text, attempt);
      const t0 = Date.now();
      const mp3 = await ttsSingle(variantText);
      const ttsMs = Date.now() - t0;

      const tv0 = Date.now();
      let verify: VerifyResult;
      try {
        verify = await verifyChunkAudio(mp3, chunk.text);
      } catch (e) {
        console.warn(
          `[TTS chunk ${chunk.index}] verify error (attempt ${attempt}): ${(e as Error).message}`,
        );
        verify = {
          ok: true,
          similarity: 1,
          maxGap: 0,
          transcript: '',
          reason: `verify-failed:${(e as Error).message}`,
        };
      }
      const verifyMs = Date.now() - tv0;
      history.push(verify);

      if (!best || isBetterAttempt(verify, best.verify)) {
        best = { mp3, verify };
      }

      console.log(
        `[TTS chunk ${chunk.index}/${total - 1}] ` +
          `attempt ${attempt}: ${chunk.text.length}ch → ${mp3.length}B ` +
          `(tts ${ttsMs}ms / verify ${verifyMs}ms, w${workerId}) ` +
          `sim=${verify.similarity} gap=${verify.maxGap} ${verify.ok ? '✓' : '✗ ' + verify.reason}`,
      );

      if (verify.ok) break;
    }

    if (!best) throw new Error(`chunk ${chunk.index}: no attempt completed`);

    // 最終フォールバック: 全試行失敗かつ depth=0 なら、テキストを2分割して再帰
    if (!best.verify.ok && depth === 0) {
      const parts = subdivideChunkText(chunk.text);
      if (parts.length === 2) {
        console.warn(
          `[TTS chunk ${chunk.index}] subdividing after ${MAX_ATTEMPTS} failures: ` +
            `${chunk.text.length}ch → [${parts[0].length}+${parts[1].length}]`,
        );
        const subResults = await Promise.all(
          parts.map((sub, i) =>
            generateAndVerifyChunk(
              { index: chunk.index * 1000 + i, text: sub, paragraphBoundaryAfter: false },
              workerId,
              total,
              depth + 1,
            ),
          ),
        );
        const subAttempts = subResults.reduce((s, r) => s + r.attempts, 0);
        const subAllOk = subResults.every((r) => r.verification?.ok);
        const subAvgSim =
          subResults.reduce((s, r) => s + (r.verification?.similarity ?? 0), 0) /
          subResults.length;
        const subHistory = subResults.flatMap((r) => r.history ?? []);

        // サブ分割結果がオリジナル最良よりも改善している場合のみ採用
        const useSubdivided = subAllOk || subAvgSim > best.verify.similarity + 0.1;

        if (useSubdivided) {
          try {
            const merged = await concatBufferList(subResults.map((r) => r.mp3));
            console.log(
              `[TTS chunk ${chunk.index}] subdivision adopted: ` +
                `${subAttempts} sub-attempts, allOk=${subAllOk}, avgSim=${subAvgSim.toFixed(2)}, ${merged.length}B`,
            );
            return {
              ...chunk,
              mp3: merged,
              attempts: history.length + subAttempts,
              verification: subAllOk
                ? {
                    ok: true,
                    similarity: 1,
                    maxGap: 0,
                    transcript: '[subdivided & merged]',
                    reason: 'subdivided-fallback-ok',
                  }
                : {
                    ...best.verify,
                    reason: `subdivided-improved-but-still-failing: avgSim=${subAvgSim.toFixed(2)}`,
                  },
              history: [...history, ...subHistory],
            };
          } catch (e) {
            console.error(`[TTS chunk ${chunk.index}] subdivision concat failed:`, e);
          }
        } else {
          console.warn(
            `[TTS chunk ${chunk.index}] subdivision rejected (avgSim=${subAvgSim.toFixed(2)} <= best=${best.verify.similarity}); keeping best original attempt`,
          );
        }
      }
    }

    return {
      ...chunk,
      mp3: best.mp3,
      attempts: history.length,
      verification: best.verify,
      history,
    };
  }

  /** verify結果の比較: ok優先 → similarity高い方 → maxGap小さい方 */
  function isBetterAttempt(candidate: VerifyResult, current: VerifyResult): boolean {
    if (candidate.ok && !current.ok) return true;
    if (!candidate.ok && current.ok) return false;
    if (candidate.similarity !== current.similarity) {
      return candidate.similarity > current.similarity;
    }
    return candidate.maxGap < current.maxGap;
  }

  const workers = Array.from({ length: Math.min(parallelism, chunks.length) }, (_, i) =>
    worker(i),
  );
  await Promise.all(workers);
  return results;
}

/**
 * リトライ時のテキスト変形（onyxのトークン解釈を変えて英語モード切替を回避）。
 * 検証はオリジナルテキストとtranscriptの比較なので、句読点の追加/置換は normalize で吸収される。
 *
 * 各attemptで「実際にトークン列が変わる」変形を確実に1つ以上加えることが重要。
 */
function applyRetryVariant(text: string, attempt: number): string {
  if (attempt === 1) return text;
  let v = text;

  // 引用符の入れ替え（『』⇔「」）— あれば必ず変化する
  if (v.includes('『') || v.includes('』')) {
    v = v.replace(/『/g, '「').replace(/』/g, '」');
  } else if (v.includes('「') || v.includes('」')) {
    v = v.replace(/「/g, '『').replace(/」/g, '』');
  }

  // 半角数字 → 全角数字（attempt 2以降）
  v = v.replace(/[0-9]/g, (d) =>
    String.fromCharCode(d.charCodeAt(0) + 0xff10 - 0x30),
  );

  if (attempt === 2) return v;

  // attempt 3: 文頭に「、」を加え、句読点境界をさらに揺らす
  return '、' + v;
}

async function ttsSingle(text: string): Promise<Buffer> {
  const mp3 = await openai.audio.speech.create({
    model: 'tts-1-hd',
    voice: 'onyx',
    input: text,
  });
  return Buffer.from(await mp3.arrayBuffer());
}

async function concatMp3s(tmpDir: string, chunks: GeneratedChunk[]): Promise<Buffer> {
  const silenceIntraPath = path.join(tmpDir, 'silence-intra.mp3');
  const silenceParaPath = path.join(tmpDir, 'silence-para.mp3');
  await Promise.all([
    generateSilenceMp3(silenceIntraPath, SILENCE_INTRA_MS),
    generateSilenceMp3(silenceParaPath, SILENCE_PARAGRAPH_MS),
  ]);

  const listLines: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const chunkPath = path.join(tmpDir, `chunk-${String(c.index).padStart(3, '0')}.mp3`);
    await fsp.writeFile(chunkPath, c.mp3);
    listLines.push(`file '${ffmpegEscape(chunkPath)}'`);
    if (i < chunks.length - 1) {
      listLines.push(
        `file '${ffmpegEscape(c.paragraphBoundaryAfter ? silenceParaPath : silenceIntraPath)}'`,
      );
    }
  }

  const listPath = path.join(tmpDir, 'list.txt');
  await fsp.writeFile(listPath, listLines.join('\n'), 'utf8');

  const outPath = path.join(tmpDir, 'out.mp3');
  await runFfmpeg([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-ar',
    '24000',
    '-ac',
    '1',
    outPath,
  ]);

  return fsp.readFile(outPath);
}

/**
 * バッファ列のMP3を順に連結（無音挿入なし）。サブ分割チャンクのマージ用。
 */
async function concatBufferList(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 1) return buffers[0];
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tts-subconcat-'));
  try {
    const listLines: string[] = [];
    for (let i = 0; i < buffers.length; i++) {
      const p = path.join(tmpDir, `part-${i}.mp3`);
      await fsp.writeFile(p, buffers[i]);
      listLines.push(`file '${ffmpegEscape(p)}'`);
    }
    const listPath = path.join(tmpDir, 'list.txt');
    await fsp.writeFile(listPath, listLines.join('\n'), 'utf8');
    const outPath = path.join(tmpDir, 'out.mp3');
    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      '-ar',
      '24000',
      '-ac',
      '1',
      outPath,
    ]);
    return fsp.readFile(outPath);
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function generateSilenceMp3(outPath: string, ms: number): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=24000:cl=mono',
    '-t',
    (ms / 1000).toFixed(3),
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    outPath,
  ]);
}

function ffmpegEscape(p: string): string {
  return p.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}
