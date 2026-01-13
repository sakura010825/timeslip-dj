import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || "");

export async function POST(req: Request) {
  try {
    const { year, month } = await req.json();
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3-flash-preview",
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
      あなたは1980年代から2020年代の音楽に精通したラジオディレクター兼DJです。
      【${year}年${month}月】に放送された「30分番組」の完全な構成案と台本を作成してください。

      【構成ルール】
      セグメントを計4つ作成してください。
      1. オープニング（挨拶、当時の${month}月の空気感、ニュース、曲1の紹介）
      2. ミドル・トーク1（当時の流行やサブカルチャーの深掘り、曲2の紹介）
      3. ミドル・トーク2（シュールなリスナーお便りコーナー、曲3の紹介）
      4. エンディング（番組の締め、当時の夜の風景、曲4の紹介）

      【重要：出力形式】
      必ず以下のJSON形式のみで出力してください。
      {
        "segments": [
          {
            "segmentTitle": "オープニング",
            "script": "台本内容...",
            "songTitle": "曲名",
            "artistName": "アーティスト名"
          },
          ...残り3つ分
        ]
      }

      ※各セグメントのトークは、OpenAI TTSで約3〜4分程度（約800〜1200文字）になるよう濃密に書いてください。
      ※ターゲットは40-50代。1995年ならPHS、アムラー、Windows95等のネタを必ず含めること。
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    return NextResponse.json(JSON.parse(text));

  } catch (error) {
    console.error("Gemini API Error:", error);
    return NextResponse.json({ error: "番組構成の作成に失敗しました。" }, { status: 500 });
  }
}