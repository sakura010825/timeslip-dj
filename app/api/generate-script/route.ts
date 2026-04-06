import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || "");

function getYearContext(year: number): string {
  if (year >= 1980 && year <= 1984) return "ウォークマン全盛期、ファミコン登場、ニューミュージックブーム、バブル前夜の空気感などを盛り込むこと。";
  if (year >= 1985 && year <= 1989) return "バブル景気、ドラゴンボール・シティハンター、レンタルビデオ、ディスコブーム、国鉄民営化などを盛り込むこと。";
  if (year >= 1990 && year <= 1993) return "バブル崩壊、J-POP黎明期、カラオケボックス普及、トレンディドラマ、ゲームボーイなどを盛り込むこと。";
  if (year === 1994) return "イチロー旋風、ジュリアナ東京閉店、平成不況、ミスチル・スピッツ台頭、コギャルなどを盛り込むこと。";
  if (year === 1995) return "阪神・淡路大震災、地下鉄サリン事件、Windows95発売、PHS登場、アムラー、エヴァンゲリオン放映開始などを盛り込むこと。";
  if (year === 1996) return "たまごっち、ポケモン赤・緑、安室奈美恵絶頂期、globe、SPEEDデビュー、消費税5%議論などを盛り込むこと。";
  if (year === 1997) return "消費税5%引き上げ、山一證券破綻、もののけ姫、たまごっち2代目ブーム、ルーズソックス全盛期などを盛り込むこと。";
  if (year === 1998) return "長野冬季五輪、iMac発売、H.I.V.E.ブーム、宇多田ヒカルデビュー、ガングロ、ナゴヤドーム開幕などを盛り込むこと。";
  if (year === 1999) return "2000年問題、auブランド誕生、ノストラダムス、モーニング娘。台頭、着メロブームなどを盛り込むこと。";
  if (year >= 2000 && year <= 2004) return "ゼロ年代初頭、ケータイ小説、浜崎あゆみ・宇多田ヒカル二強時代、USJオープン、W杯日韓共催などを盛り込むこと。";
  if (year >= 2005 && year <= 2009) return "YouTube・mixi・ニコ動、iPod・iPhone登場、AKB48台頭、リーマンショック、初音ミクなどを盛り込むこと。";
  return `${year}年当時の世相、流行、社会的出来事を具体的に盛り込むこと。`;
}

export async function POST(req: Request) {
  try {
    const { year, month } = await req.json();
    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      generationConfig: { responseMimeType: "application/json" }
    });

    const yearContext = getYearContext(Number(year));

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
      ※ターゲットは40-50代。${yearContext}

      【TTSの読み上げ精度を上げるための書き方ルール（必ず守ること）】
      - 英語・アルファベット略語は必ずカタカナで書く（例：PHS→ピーエイチエス、CD→シーディー、TV→テレビ、CM→コマーシャル、BGM→バックグラウンドミュージック）
      - バンド名・アーティスト名もカタカナ表記を優先（例：SMAP→スマップ、B'z→ビーズ、Mr.Children→ミスターチルドレン）
      - 読みにくい漢字や熟語はひらがなに開く（例：所謂→いわゆる、謂わば→いわば、溢れる→あふれる）
      - 数字は漢数字か読み仮名を使う（例：95年→1995年、3月→3月 ※そのままでよい、10代→10代）
      - 記号（※、→、…など）は使わない。代わりに読める言葉で表現する
      - 英単語はそのまま使わず、カタカナか日本語に置き換える
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