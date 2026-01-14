import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { q } = await req.json(); // "Mr.Children Tomorrow never knows" など
  const apiKey = process.env.YOUTUBE_API_KEY;

  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=1&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    const videoId = data.items?.[0]?.id?.videoId;

    return NextResponse.json({ videoId });
  } catch (error) {
    return NextResponse.json({ error: "YouTube検索に失敗しました" }, { status: 500 });
  }
}