import Anthropic from '@anthropic-ai/sdk';
import type { KnowledgeItem } from './knowledge-loader';
import { logApiUsage } from './usage-log';

/**
 * Layer 3: 自動グラウンディング検証
 *
 * 生成された台本中の固有名詞・人物・配役・日付・出来事・歌詞のうち、
 * 知識ベース（その年×季節の全項目）に根拠を持たない主張を検出する。
 * 人手の WebSearch fact-check を、検証済みのローカル知識ベースに対して
 * 自動化したもの。照合先がローカルかつ有界なので高精度・低コスト。
 *
 * 設計: redial/docs/PHASE2_ONDEMAND_DESIGN.md §4 Layer 3
 */

const VERIFIER_MODEL = 'claude-sonnet-4-6';

export type Severity = 'critical' | 'minor';

export type UngroundedClaim = {
  /** 台本から抜き出した、素材に根拠のない主張 */
  claim: string;
  /** critical=固有名詞の事実/配役/日付/歌詞/数値, minor=一般背景の補足 */
  severity: Severity;
  /** なぜ ungrounded か（素材に無い／素材と矛盾 等） */
  reason: string;
};

export type GroundingReport = {
  ungrounded: UngroundedClaim[];
  criticalCount: number;
  minorCount: number;
  /** デバッグ用：検証LLMの生応答 */
  raw?: string;
};

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in process env');
  }
  return new Anthropic({ apiKey });
}

function buildMaterialsBlock(items: KnowledgeItem[]): string {
  return items
    .map(
      (it) =>
        `- [${it.category}/${it.month}月] ${it.title}\n  事実: ${it.oneLiner}\n  文脈: ${it.context}\n  キーワード: ${it.keywords.join('、')}`,
    )
    .join('\n');
}

const VERIFIER_SYSTEM = `あなたは厳密な事実検証官です。与えられた【素材】だけを唯一の真実源とみなします。素材の外にあるあなた自身の知識を、真実の根拠として使ってはいけません。素材に書かれていないことは「根拠なし」として扱います。`;

function buildVerifierPrompt(scriptText: string, items: KnowledgeItem[]): string {
  return `次の【台本】を検査し、【素材】に根拠を持たない主張をすべて挙げてください。

【判定基準】
- 台本中の固有名詞・人物名・配役・日付・出来事・数値・歌詞のうち、
  素材に書かれていない、または素材と矛盾するもの → ungrounded として挙げる
- severity の付け方:
  - critical: 人物・配役・固有名詞の事実主張／日付・数値／楽曲の歌詞の引用。
    （例: 素材にない人物を登場させる、配役を取り違える、歌詞を引用する、素材と違う日付を言う）
  - minor: 素材にない一般的な時代背景の補足説明（特定の固有事実は断定していないもの）
- 次のものは ungrounded として挙げない（対象外）:
  - 情緒・季節・天候・街の空気・身体感覚など、特定の事実を主張しない描写
  - 「〜だった気がする」「覚えていますか」等の主観・回想の枠付け
  - 素材に明記された事実の言い換え・要約
  - TTS（音声読み上げ）対応のための「表記の開き」。固有名詞・楽曲名・アーティスト名・地名を
    カタカナや読み仮名に開いたもので、素材と「読み（音）」が一致しているものは、
    同一の固有名詞とみなす（ungrounded として挙げない）。
    例:「B'z」→「ビーズ」、「米米CLUB」→「こめこめクラブ」、「JAL」→「ジャル」、
    「Easy Come, Easy Go!」→「イージー・カム、イージー・ゴー」、「麻布」→「あざぶ」、「109」→「イチマルキュウ」
    ※ ただし「読み（音）」が異なる別の固有名詞への置き換えは「取り違え」なので、引き続き critical として挙げる。
    例: 素材が「MISIA」なのに台本が「宇多田ヒカル」、素材が「堤真一」なのに「所ジョージ」（音が全く違う＝別人・別物）。

【素材】（この年×季節の知識ベース・唯一の真実源）
${buildMaterialsBlock(items)}

【台本】
${scriptText}

【出力（このJSONのみ・前後に説明文を付けない）】
{
  "ungrounded": [
    { "claim": "<台本中の根拠なき主張>", "severity": "critical", "reason": "<素材に無い/矛盾 等の理由>" }
  ]
}
根拠なき主張が一つも無ければ {"ungrounded": []} を返してください。
出力するJSONは最終結果の1つだけにしてください。考え直しの過程・訂正前のJSON・複数のコードブロックを出力しないこと。挙げるか迷った主張は、最終のJSONに含めるか含めないかを自分で決め、その1つのJSONだけを返してください。`;
}

/** Claudeの出力テキストからJSONを抽出（route.ts と同じ作法）。 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // 検証官が「考え直し」で複数のJSONフェンスを出すことがあるため、最後のフェンス（＝最終結果）を採用する
  const fences = [...trimmed.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g)];
  if (fences.length > 0) {
    return JSON.parse(fences[fences.length - 1][1]);
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
  }
  return JSON.parse(trimmed);
}

/**
 * 台本（全文または1セグメント）を知識ベースに対して検証する。
 * @param scriptText 検証対象の台本テキスト
 * @param knowledgeItems その年×季節の知識ベース全項目（真実源）
 */
export async function verifyGrounding(params: {
  scriptText: string;
  knowledgeItems: KnowledgeItem[];
  generationId?: number | string | null;
}): Promise<GroundingReport> {
  const { scriptText, knowledgeItems, generationId } = params;
  const client = getClient();

  const response = await client.messages.create({
    model: VERIFIER_MODEL,
    max_tokens: 2048,
    system: [{ type: 'text', text: VERIFIER_SYSTEM }],
    messages: [{ role: 'user', content: buildVerifierPrompt(scriptText, knowledgeItems) }],
  });

  void logApiUsage({
    provider: 'anthropic',
    model: VERIFIER_MODEL,
    purpose: 'grounding_verify',
    units: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
    generationId,
  });

  const rawText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('\n');

  let ungrounded: UngroundedClaim[] = [];
  try {
    const parsed = extractJson(rawText) as { ungrounded?: UngroundedClaim[] };
    if (Array.isArray(parsed.ungrounded)) {
      ungrounded = parsed.ungrounded.filter(
        (u) => u && typeof u.claim === 'string' && (u.severity === 'critical' || u.severity === 'minor'),
      );
    }
  } catch {
    // パース失敗時は空の検出として返し、raw を残す（運用で目視）
    return { ungrounded: [], criticalCount: 0, minorCount: 0, raw: rawText };
  }

  return {
    ungrounded,
    criticalCount: ungrounded.filter((u) => u.severity === 'critical').length,
    minorCount: ungrounded.filter((u) => u.severity === 'minor').length,
    raw: rawText,
  };
}
