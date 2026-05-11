/**
 * チャンク単位の部分再生成API（編集ワークフローの核）。
 *
 * 既存アーカイブの特定チャンクのテキストを書き換えて、
 * そのチャンクだけ再TTS → 既存の他チャンクと再結合して出力MP3を更新する。
 *
 * - Whisper検証・リトライはスキップ（編集者の手で品質担保前提）
 * - 編集前のテキストは meta.json の chunks[N].previousText に保持
 */

import { NextResponse } from 'next/server';
import { promises as fsp } from 'fs';
import path from 'path';
import { sanitizeForTTS } from '@/lib/tts-sanitize';
import {
  generateSingleChunkMp3,
  concatChunksToMp3,
  TTS_MODEL,
  TTS_VOICE,
} from '@/lib/tts-pipeline';

const ARCHIVE_ROOT = path.resolve(process.cwd(), '.tts-archive');

type ChunkMeta = {
  index: number;
  text: string;
  mp3Bytes: number;
  mp3File: string;
  attempts: number;
  paragraphBoundaryAfter?: boolean;
  verification?: unknown;
  history?: unknown[];
  previousText?: string;
  editedAt?: string;
};

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { archiveId, chunkIndex, newText } = body as {
      archiveId?: string;
      chunkIndex?: number;
      newText?: string;
    };

    if (typeof archiveId !== 'string' || !archiveId) return badRequest('archiveId required');
    if (typeof chunkIndex !== 'number' || !Number.isInteger(chunkIndex))
      return badRequest('chunkIndex required (integer)');
    if (typeof newText !== 'string' || newText.trim().length === 0)
      return badRequest('newText required (non-empty)');
    if (newText.length > 4000) return badRequest('newText too long (>4000 chars)');

    // パストラバーサル防止
    if (archiveId.includes('/') || archiveId.includes('\\') || archiveId.includes('..')) {
      return badRequest('invalid archiveId');
    }

    const archiveDir = path.join(ARCHIVE_ROOT, archiveId);
    const metaPath = path.join(archiveDir, 'meta.json');

    let meta: { chunks: ChunkMeta[]; [k: string]: unknown };
    try {
      const raw = await fsp.readFile(metaPath, 'utf8');
      meta = JSON.parse(raw);
    } catch (e) {
      return NextResponse.json(
        { error: 'archive not found', detail: (e as Error).message },
        { status: 404 },
      );
    }

    if (!Array.isArray(meta.chunks)) return badRequest('meta.json has no chunks array');
    if (chunkIndex < 0 || chunkIndex >= meta.chunks.length)
      return badRequest(`chunkIndex out of range (0..${meta.chunks.length - 1})`);

    // sanitize（dict, ……→、 などを適用）
    const { clean: cleanedText, warnings: sanitizeWarnings } = sanitizeForTTS(newText);
    if (sanitizeWarnings.length > 0) {
      console.warn(`[TTS chunk ${chunkIndex}] sanitize warnings:`, sanitizeWarnings);
    }

    console.log(
      `[TTS chunk edit] ${archiveId} chunk[${chunkIndex}]: ` +
        `"${meta.chunks[chunkIndex].text.slice(0, 30)}…" → "${cleanedText.slice(0, 30)}…"`,
    );

    const t0 = Date.now();
    const newMp3 = await generateSingleChunkMp3(cleanedText);
    const ttsMs = Date.now() - t0;

    // 新チャンクMP3を上書き保存
    const chunkFileName = `chunk-${String(chunkIndex).padStart(3, '0')}.mp3`;
    await fsp.writeFile(path.join(archiveDir, 'chunks', chunkFileName), newMp3);

    // meta 更新（previousText を保持して再編集時のロールバック余地を残す）
    const old = meta.chunks[chunkIndex];
    meta.chunks[chunkIndex] = {
      ...old,
      text: cleanedText,
      mp3Bytes: newMp3.length,
      attempts: 1,
      previousText: old.previousText ?? old.text,
      editedAt: new Date().toISOString(),
      verification: { ok: true, similarity: 1, maxGap: 0, transcript: '[manual-edit]', reason: 'manual-edit' },
      history: old.history ?? [],
    };

    // 全チャンクを読み込んで再結合
    const chunkParts = await Promise.all(
      meta.chunks.map(async (c) => {
        const fname = c.mp3File ? path.basename(c.mp3File) : `chunk-${String(c.index).padStart(3, '0')}.mp3`;
        const buf = await fsp.readFile(path.join(archiveDir, 'chunks', fname));
        return { mp3: buf, paragraphBoundaryAfter: c.paragraphBoundaryAfter ?? false };
      }),
    );
    const newOutput = await concatChunksToMp3(chunkParts);
    await fsp.writeFile(path.join(archiveDir, 'output.mp3'), newOutput);

    // meta の集約値も更新
    meta.outputBytes = newOutput.length;
    meta.estimatedDurationSec = +(newOutput.length / 16384).toFixed(1);
    (meta as Record<string, unknown>).lastEditAt = new Date().toISOString();
    (meta as Record<string, unknown>).lastEdit = {
      chunkIndex,
      ttsMs,
      model: TTS_MODEL,
      voice: TTS_VOICE,
      sanitizeWarnings,
    };

    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    const stamp = Date.now();
    return NextResponse.json({
      archiveId,
      updatedChunkIndex: chunkIndex,
      outputUrl: `/api/tts-archive/${archiveId}/output.mp3?t=${stamp}`,
      outputBytes: newOutput.length,
      ttsMs,
      sanitizeWarnings,
      chunks: meta.chunks.map((c) => ({
        index: c.index,
        text: c.text,
        mp3Bytes: c.mp3Bytes,
        mp3Url: `/api/tts-archive/${archiveId}/chunks/chunk-${String(c.index).padStart(3, '0')}.mp3?t=${stamp}`,
        attempts: c.attempts,
        paragraphBoundaryAfter: c.paragraphBoundaryAfter ?? false,
        verification: c.verification ?? null,
        previousText: c.previousText ?? null,
        editedAt: c.editedAt ?? null,
      })),
    });
  } catch (e) {
    console.error('[TTS chunk edit] error:', e);
    return NextResponse.json(
      { error: 'chunk edit failed', detail: (e as Error).message },
      { status: 500 },
    );
  }
}
