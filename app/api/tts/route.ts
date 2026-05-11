import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { sanitizeForTTS } from '@/lib/tts-sanitize';
import {
  runTTSPipeline,
  TTS_MODEL,
  TTS_VOICE,
  TTS_INSTRUCTIONS,
} from '@/lib/tts-pipeline';

const ARCHIVE_ROOT = path.resolve(process.cwd(), '.tts-archive');

type TtsMetadata = {
  segmentIndex?: number;
  segmentTitle?: string;
  year?: number | string;
  season?: string;
  month?: number | string;
};

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    '-',
    pad(d.getMonth() + 1),
    '-',
    pad(d.getDate()),
    '_',
    pad(d.getHours()),
    '-',
    pad(d.getMinutes()),
    '-',
    pad(d.getSeconds()),
  ].join('');
}

type ArchiveInput = {
  base: string;
  rawText: string;
  cleanText: string;
  finalMp3: Buffer;
  warnings: string[];
  metadata: TtsMetadata;
  chunks: {
    index: number;
    text: string;
    mp3: Buffer;
    mp3Bytes: number;
    attempts: number;
    paragraphBoundaryAfter?: boolean;
    verification?: { ok: boolean; similarity: number; maxGap: number; transcript: string; reason?: string };
    history?: { ok: boolean; similarity: number; maxGap: number; reason?: string }[];
  }[];
  pipelineMs: number;
};

function saveArchive(a: ArchiveInput) {
  try {
    const dir = path.join(ARCHIVE_ROOT, a.base);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(path.join(dir, 'input.raw.txt'), a.rawText, 'utf8');
    fs.writeFileSync(path.join(dir, 'input.clean.txt'), a.cleanText, 'utf8');
    fs.writeFileSync(path.join(dir, 'output.mp3'), a.finalMp3);

    // チャンク個別MP3を chunks/ 配下に保存（編集ワークフローでの差し替え用）
    const chunksDir = path.join(dir, 'chunks');
    fs.mkdirSync(chunksDir, { recursive: true });
    for (const c of a.chunks) {
      const fname = `chunk-${String(c.index).padStart(3, '0')}.mp3`;
      fs.writeFileSync(path.join(chunksDir, fname), c.mp3);
    }

    // meta.json には mp3 Buffer 自体は含めない（chunks/ 配下にファイルとして保存済み）
    const chunksForMeta = a.chunks.map((c) => ({
      index: c.index,
      text: c.text,
      mp3Bytes: c.mp3Bytes,
      mp3File: `chunks/chunk-${String(c.index).padStart(3, '0')}.mp3`,
      attempts: c.attempts,
      paragraphBoundaryAfter: c.paragraphBoundaryAfter ?? false,
      verification: c.verification,
      history: c.history,
    }));

    const meta = {
      timestamp: new Date().toISOString(),
      tts: {
        model: TTS_MODEL,
        voice: TTS_VOICE,
        instructions: TTS_INSTRUCTIONS ?? null,
      },
      rawLength: a.rawText.length,
      cleanLength: a.cleanText.length,
      outputBytes: a.finalMp3.length,
      bytesPerChar: +(a.finalMp3.length / Math.max(1, a.cleanText.length)).toFixed(1),
      estimatedDurationSec: +(a.finalMp3.length / 16384).toFixed(1),
      pipelineMs: a.pipelineMs,
      chunkCount: a.chunks.length,
      totalChunkAttempts: a.chunks.reduce((s, c) => s + c.attempts, 0),
      warnings: a.warnings,
      chunks: chunksForMeta,
      ...a.metadata,
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

    console.log(`[TTS archive] saved: ${a.base}/`);
  } catch (e) {
    console.error('[TTS archive] save failed:', e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text } = body;
    const metadata: TtsMetadata = body.metadata ?? {};

    if (typeof text !== 'string' || text.length === 0) {
      return NextResponse.json({ error: 'text が空です' }, { status: 400 });
    }
    if (text.length > 4000) {
      return NextResponse.json(
        { error: `text が長すぎます (${text.length} chars, 4000未満にしてください)` },
        { status: 400 },
      );
    }

    const segLabel = `seg=${metadata.segmentIndex ?? '?'}`;
    const { clean, warnings } = sanitizeForTTS(text);
    if (warnings.length > 0) {
      console.warn(`[TTS sanitize ${segLabel}]`, warnings.join(' / '));
    }
    console.log(`[TTS ${segLabel}] start: ${text.length} → ${clean.length} chars`);

    const t0 = Date.now();
    const result = await runTTSPipeline(clean);
    const pipelineMs = Date.now() - t0;
    console.log(
      `[TTS ${segLabel}] done: ${result.totalChunks} chunks, ${result.totalAttempts} attempts, ` +
        `${result.mp3.length} bytes, ${pipelineMs}ms`,
    );

    const ts = formatTimestamp(new Date());
    const segSuffix =
      typeof metadata.segmentIndex === 'number' ? `_seg${metadata.segmentIndex}` : '';
    const archiveId = `${ts}${segSuffix}`;
    saveArchive({
      base: archiveId,
      rawText: text,
      cleanText: clean,
      finalMp3: result.mp3,
      warnings,
      metadata,
      chunks: result.chunks.map((c) => ({
        index: c.index,
        text: c.text,
        mp3: c.mp3,
        mp3Bytes: c.mp3.length,
        attempts: c.attempts,
        paragraphBoundaryAfter: c.paragraphBoundaryAfter,
        verification: c.verification,
        history: c.history?.map((h) => ({
          ok: h.ok,
          similarity: h.similarity,
          maxGap: h.maxGap,
          reason: h.reason,
        })),
      })),
      pipelineMs,
    });

    const stamp = Date.now();
    return NextResponse.json({
      archiveId,
      outputUrl: `/api/tts-archive/${archiveId}/output.mp3?t=${stamp}`,
      outputBytes: result.mp3.length,
      pipelineMs,
      warnings,
      chunks: result.chunks.map((c) => ({
        index: c.index,
        text: c.text,
        mp3Bytes: c.mp3.length,
        mp3Url: `/api/tts-archive/${archiveId}/chunks/chunk-${String(c.index).padStart(3, '0')}.mp3?t=${stamp}`,
        attempts: c.attempts,
        paragraphBoundaryAfter: c.paragraphBoundaryAfter ?? false,
        verification: c.verification ?? null,
      })),
    });
  } catch (error) {
    console.error('TTS Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `音声生成エラー: ${message}` }, { status: 500 });
  }
}
