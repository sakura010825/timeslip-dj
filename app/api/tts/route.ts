import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// OpenAIの初期化（.env.localのキーを自動使用）
const openai = new OpenAI();

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    // 1. OpenAI TTS APIを呼び出して音声を生成
    const mp3 = await openai.audio.speech.create({
      model: "tts-1-hd", // 高音質モデル
      voice: "onyx",     // 深夜ラジオに最適な、渋くて低い男性の声
      input: text,
    });

    // 2. 音声データをバッファに変換
    const buffer = Buffer.from(await mp3.arrayBuffer());
    
    // 3. ブラウザが「これは音声ファイルだよ」と認識できる形式で返す
    return new NextResponse(buffer, {
      headers: { 
        'Content-Type': 'audio/mpeg',
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("TTS Error:", error);
    return NextResponse.json({ error: '音声の生成に失敗しました' }, { status: 500 });
  }
}