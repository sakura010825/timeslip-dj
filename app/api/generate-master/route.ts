import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

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

    const prompt = `あなたは1980〜2000年代の日本の文化・エンタメに精通したアーキビストです。
${year}年${seasonJP}（${months}）に話題になったコンテンツを以下のカテゴリから各5つずつ選んでください。

対象カテゴリ：
${categoryDescriptions}

ターゲット：現在40〜50代（1970〜1980年代生まれ）の日本人。当時を懐かしめる具体的なコンテンツを選ぶこと。

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
      "story": "【01 THE ARTIFACT】\\nコンテンツの詳細・特徴（100字程度）\\n\\n【02 THE CONTEXT】\\n当時の社会背景・流行との関係（100字程度）",
      "designFile": {
        "color": "代表カラー（例: Cherry Red / Silver）",
        "form": "形状・フォーマット（例: Cartridge ROM）",
        "material": "素材・メディア（例: Plastic / CD-ROM）",
        "specs": ["特徴または仕様1", "特徴または仕様2", "特徴または仕様3"]
      },
      "editorsEye": "編集者の視点からの短評（60字以内）",
      "theLink2026": "2026年現在との繋がり・現代的意義（60字以内）"
    }
  ]
}

JSONのみを出力してください。マークダウンのコードブロックは使わないこと。`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON not found in response');

    return NextResponse.json(JSON.parse(jsonMatch[0]));

  } catch (error) {
    console.error('Generate master error:', error);
    return NextResponse.json({ error: 'コンテンツの生成に失敗しました' }, { status: 500 });
  }
}
