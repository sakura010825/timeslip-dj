import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { loadKnowledgeBase, monthToSeason } from '@/lib/knowledge-loader';
import { selectTopics } from '@/lib/topic-selector';
import { SHINYA_SYSTEM_PROMPT, buildScriptPrompt } from '@/lib/shinya-prompt';

const MODEL_ID = 'claude-sonnet-4-6';

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const related = Object.keys(process.env).filter((k) => /ANT|CLAUDE|OPENAI|GEMINI|GOOGLE/i.test(k));
  console.log('[Anthropic env] ANTHROPIC_API_KEY length:', apiKey?.length ?? 0);
  console.log('[Anthropic env] related keys in process.env:', related);
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set in server process env. Other keys visible: ' + related.join(',')
    );
  }
  return new Anthropic({ apiKey });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const yearNum = Number(body.year);
    const season: string = body.season ?? monthToSeason(Number(body.month));

    const kb = loadKnowledgeBase(yearNum, season);
    // music はトピック抽選から除外する。楽曲は下の musicPool（楽曲候補リスト）として別枠で渡すため、
    // music がトピック枠を占めると 8枠を浪費する上、「流さない曲を主役級に語る」一貫性事故の種になる。
    const topics = selectTopics(kb.items.filter((i) => i.category !== 'music'), 8);
    // 楽曲は知識ベース全体のmusicカテゴリから選ばせる
    const allMusic = kb.items.filter((i) => i.category === 'music');

    // 曲選択カスタマイズ: body.songIds があれば、その曲だけにプールを絞る（= must-use）。
    // 無ければ従来のお任せ（全 music から Claude が選ぶ）。songIds の順を保って解決する。
    const songIds: string[] = Array.isArray(body.songIds)
      ? body.songIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    const mustUseSongs = songIds.length > 0;
    const musicPool = mustUseSongs
      ? songIds
          .map((id) => allMusic.find((m) => m.id === id))
          .filter((m): m is (typeof allMusic)[number] => Boolean(m))
      : allMusic;

    if (mustUseSongs && musicPool.length === 0) {
      return NextResponse.json(
        { error: `選択された曲が ${yearNum}-${season} のプールに見つかりません: ${songIds.join(', ')}` },
        { status: 400 },
      );
    }

    const userPrompt = buildScriptPrompt({
      year: yearNum,
      season,
      topics,
      musicPool,
      mustUseSongs,
    });

    const client = getClient();
    const response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 8192,
      system: [
        {
          type: 'text',
          text: SHINYA_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const rawText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n');

    const parsed = extractJson(rawText) as Record<string, unknown>;

    return NextResponse.json({
      ...parsed,
      metadata: {
        year: yearNum,
        season,
        character: 'shinya',
        model: MODEL_ID,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
        },
        selectedTopics: topics.map((t) => ({
          id: t.id,
          title: t.title,
          category: t.category,
          month: t.month,
          importance: t.importance,
        })),
      },
    });
  } catch (error) {
    console.error('Script generation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `番組構成の作成に失敗しました: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * Claudeの出力テキストからJSONを抽出する。
 * 素のJSON、```json ... ```、```...```のいずれも受け付ける。
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // コードフェンス付き
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1]);
  }

  // 素のJSON: 最初の { から最後の } までを取り出す
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
  }

  // そのままパース試行
  return JSON.parse(trimmed);
}
