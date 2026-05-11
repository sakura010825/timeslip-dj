import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fewShotSamples from '@/data/few-shot-samples.json';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');

const CATEGORY_INFO: Record<string, string> = {
  'MUSIC':          '音楽（国内・海外のヒット曲・アルバム・アーティスト）',
  'TV-DRAMA':       'テレビドラマ（視聴率が高かったもの・話題になったもの）',
  'MOVIE-ANIME':    '映画・アニメ（劇場公開作品・テレビアニメ）',
  'GAME':           'ゲーム（コンシューマー・アーケード）',
  'DIGITAL-GADGET': 'デジタル・ガジェット（パソコン・携帯・エーブイ機器）',
  'TOY':            'おもちゃ・玩具（流行ったキャラクターグッズ・玩具）',
  'NEWS':           'ニュース・時事（社会的出来事・事件・政治）',
  'CM-ADS':         'コマーシャル・広告（話題になったコマーシャル・キャッチコピー）',
  'FOOD-DRINK':     '食べ物・飲み物（ヒットした食品・飲料・外食トレンド）',
  'SPORTS':         'スポーツ（話題の選手・試合・大会）',
  'FASHION':        'ファッション（流行したスタイル・ブランド・アイテム）',
  'CULTURE-SLANG':  'カルチャー・スラング（流行語・若者文化・社会現象）',
};

const SEASON_MONTHS: Record<string, string> = {
  spring: '3月・4月・5月',
  summer: '6月・7月・8月',
  autumn: '9月・10月・11月',
  winter: '12月・1月・2月',
};

const SEASON_JP: Record<string, string> = {
  spring: '春', summer: '夏', autumn: '秋', winter: '冬',
};

// few-shotサンプルをプロンプトに埋め込む
// 完全な1例（スキーマ確認用）＋ 3本のeditorsEye（多様な書き出しを示す）
function buildFewShotExample(): string {
  const fullSample = fewShotSamples[0]; // Windows95：完全な構造例
  const editorsEyeExamples = fewShotSamples.map(
    s => `【${s.title}】\n${s.editorsEye}`
  ).join('\n\n');

  return `
## 完全な出力例（JSONスキーマの確認用）

\`\`\`json
${JSON.stringify(fullSample, null, 2)}
\`\`\`

## editorsEyeの多様な書き出し例（書き出しパターンを毎回変えること）

${editorsEyeExamples}
`;
}

export async function POST(req: Request) {
  try {
    const { year, season, categories } = await req.json() as {
      year: string;
      season: string;
      categories: string[];
    };

    const months = SEASON_MONTHS[season] ?? '';
    const seasonJP = SEASON_JP[season] ?? season;
    const categoryDescriptions = categories
      .map(c => `- ${c}：${CATEGORY_INFO[c] ?? c}`)
      .join('\n');

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const prompt = `あなたは1980〜2000年代の日本の文化・エンタメに精通した文化批評家です。
${year}年${seasonJP}（${months}）に話題になったコンテンツを以下のカテゴリから各5つずつ選び、深く書いてください。

対象カテゴリ：
${categoryDescriptions}

ターゲット：現在40〜50代（1970〜1980年代生まれ）の日本人。
当時を「情報として知る」のではなく「体験として思い出す」コンテンツを選ぶこと。

## コンテンツ制作の哲学
「情報提供ではなく、体験の再構成」

各エントリーは以下の4セクション構造で書くこと：
1. **dataAndNumbers**：具体的な数字・データで当時の規模感・熱量を体感させる（100字程度）
2. **visualElements**：読者の視覚的記憶を呼び起こす情景描写（100字程度）。五感に訴えること
3. **editorsEye**：文化批評エッセイ。**必ず400字以上**書くこと。「何が起きたか」ではなく「それが何を意味したか」を書く。事実をメタファーに変換して時代を解剖すること。報告文ではなくエッセイのトーンで。**書き出しのパターンは毎回異なること**（「〜は単なる〇〇ではなかった」を繰り返さない）
4. **theLink2026**：現在との接続（100字程度）。読者への問いかけで終わること

${buildFewShotExample()}

以下のJSON形式で、各カテゴリ5エントリーを生成してください：

{
  "metadata": {
    "year": "${year}",
    "season": "${season.charAt(0).toUpperCase() + season.slice(1)}",
    "description": "${year}年${seasonJP}を象徴する一文（40字以内）"
  },
  "entries": [
    {
      "id": "カテゴリslugとアイテムの英語slugをハイフンでつなぐ（例: music-amuro、game-dq6）",
      "category": "カテゴリキー（例: MUSIC）",
      "title": "コンテンツタイトル（正式名称）",
      "focus": "テーマ・サブタイトル（20字以内）",
      "catchphrase": "40〜50代が当時を懐かしめる感情的なキャッチコピー（40字以内）",
      "djScript": "ラジオDJが紹介するような語り口（120〜180字）。具体的な記憶・情景を喚起すること。カタカナ・ひらがな中心で書き、英語略語はカタカナに変換すること。",
      "dataAndNumbers": "具体的な数字・データで当時の規模感・熱量を体感させる（100字程度）",
      "visualElements": "読者の視覚的記憶を呼び起こす情景描写（100字程度）。五感に訴えること",
      "editorsEye": "文化批評エッセイ（400字以上・厳守）。書き出しは毎回異なるアプローチで。事実をメタファーに変換して時代を解剖する。報告文ではなくエッセイのトーン",
      "theLink2026": "現在との接続（100字程度）。読者への問いかけで終わること",
      "designFile": {
        "color": "代表カラー（例: Cherry Red / Silver）",
        "form": "形状・フォーマット（例: Cartridge ROM）",
        "material": "素材・メディア（例: Plastic / CD-ROM）",
        "specs": ["特徴または仕様1", "特徴または仕様2", "特徴または仕様3"]
      }
    }
  ]
}

必ず各カテゴリ5エントリーずつ生成すること。JSONのみを出力してください。`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return NextResponse.json(JSON.parse(text));

  } catch (error) {
    console.error('Gemini API Error:', error);
    return NextResponse.json({ error: 'コンテンツの生成に失敗しました' }, { status: 500 });
  }
}
