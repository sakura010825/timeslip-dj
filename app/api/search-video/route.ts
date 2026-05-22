import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

type Candidate = { videoId: string; embeddable: boolean };
type Song = { artistName: string; songTitle: string; candidates: Candidate[] };
type Curated = { songs: Song[] };

/**
 * 楽曲タイトル・アーティスト名の照合用正規化。
 * - 空白除去
 * - 〜/～ を ~ に統一
 * - スラッシュ（／・/）で区切られた A面/B面表記の前半のみを採用
 *   例: "LOVE LOVE LOVE／嵐が来る" → "lovelovelove"
 * - 小文字化
 */
const normalize = (s: string): string =>
  s.split(/[／/]/)[0]
    .replace(/\s+/g, '')
    .replace(/[〜～]/g, '~')
    .toLowerCase();

function findCurated(year: string, artistName: string, songTitle: string): string | null {
  if (!year || !artistName || !songTitle) return null;
  // redial リポジトリの curation を直読み（timeslip-dj は redial の隣にある前提）
  const file = path.resolve(process.cwd(), '..', 'redial', 'data', 'youtube-candidates', `${year}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as Curated;
    const targetA = normalize(artistName);
    const targetS = normalize(songTitle);
    const match = data.songs.find((s) =>
      normalize(s.artistName) === targetA && normalize(s.songTitle) === targetS
    );
    if (!match) return null;
    const top = match.candidates.find((c) => c.embeddable) ?? match.candidates[0];
    return top?.videoId ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const { q, year, artistName, songTitle } = await req.json();
  const apiKey = process.env.YOUTUBE_API_KEY;

  // 1. curation 優先（楽曲名・アーティスト名・年が揃っていれば）
  const curatedId = findCurated(String(year ?? ''), String(artistName ?? ''), String(songTitle ?? ''));
  if (curatedId) {
    return NextResponse.json({ videoId: curatedId, source: 'curated' });
  }

  // 2. YouTube API フォールバック（videoEmbeddable=true 必須・CLAUDE.md準拠）
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&videoEmbeddable=true&maxResults=1&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    const videoId = data.items?.[0]?.id?.videoId;
    return NextResponse.json({ videoId, source: 'youtube-api' });
  } catch (error) {
    return NextResponse.json({ error: 'YouTube検索に失敗しました' }, { status: 500 });
  }
}
