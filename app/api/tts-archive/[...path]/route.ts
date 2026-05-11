/**
 * .tts-archive/ 配下のファイルを読み取り専用で配信する開発者向けエンドポイント。
 *
 * 編集ワークフローUIが、生成済みチャンクMP3 / 結合MP3 / meta.json を取り出すために使う。
 *
 * セキュリティ:
 *  - `..` を含むパスは拒否
 *  - 解決後の絶対パスが ARCHIVE_ROOT 配下にあることを確認
 *  - .env や .git など別のディレクトリには絶対に出ない
 */

import { NextResponse } from 'next/server';
import { promises as fsp } from 'fs';
import path from 'path';

const ARCHIVE_ROOT = path.resolve(process.cwd(), '.tts-archive');

export async function GET(
  _req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await context.params;
  if (!parts || parts.length === 0) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }

  if (parts.some((p) => p.includes('..') || p.includes('\0'))) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const resolved = path.resolve(ARCHIVE_ROOT, ...parts);
  if (!resolved.startsWith(ARCHIVE_ROOT + path.sep) && resolved !== ARCHIVE_ROOT) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  try {
    const buf = await fsp.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType =
      ext === '.mp3'
        ? 'audio/mpeg'
        : ext === '.json'
        ? 'application/json'
        : ext === '.txt'
        ? 'text/plain; charset=utf-8'
        : 'application/octet-stream';
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: 'not found', detail: msg }, { status: 404 });
  }
}
