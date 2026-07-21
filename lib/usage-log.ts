/**
 * API使用量ログ — Supabase `api_usage` テーブルへの実測記録ヘルパー（Phase 2a）。
 *
 * 目的: エピソード生成1本ごとに「どのAPIをどれだけ使い、いくらかかったか」を記録し、
 * ReDial 運用ダッシュボードのコストパネルで1本あたり実測原価を出せるようにする。
 *
 * 設計: redial/docs/OPS_DASHBOARD_REQUIREMENTS_2026-07.md §4 P2(a)
 * テーブル定義: redial/supabase/ops-dashboard.sql（source='measured' 固定）
 *
 * ⚠️ fail-open が絶対条件:
 *   - env 不足（SUPABASE_SERVICE_ROLE_KEY 等）は起動時ではなく初回呼び出し時に検知し、
 *     以降は静かにスキップする（ローカル単体実行・テストを壊さない）
 *   - Supabase への insert が失敗しても（ネットワーク断・テーブル未適用等）例外を投げない。
 *     console.warn するだけで、呼び出し元の生成パイプライン本体は絶対に止めない。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type UsageProvider = 'anthropic' | 'openai' | 'azure';

/** 'topic_select' は topic-selector.ts が API を呼ばない（純ローカルの重み付き抽選）ため未使用。 */
export type UsagePurpose = 'script' | 'grounding_verify' | 'tts' | 'whisper_verify';

export type UsageUnits = {
  input_tokens?: number;
  output_tokens?: number;
  tts_chars?: number;
  audio_seconds?: number;
};

export type LogApiUsageParams = {
  provider: UsageProvider;
  model: string;
  purpose: UsagePurpose;
  units: UsageUnits;
  /**
   * generation-worker.mjs 経由（オンデマンド生成）なら Supabase generations.id。
   * batch-generate.mjs の単体実行（事前プール制作）等、紐づく生成が無い場合は null/undefined。
   */
  generationId?: number | string | null;
};

/**
 * 単価表（モデルID → 単価）。
 *
 * 単価はすべて WebSearch で 2026-07-21 に公式ドキュメントから裏取り済み。出典は各エントリのコメント参照。
 * このテーブルに無い／計算方針が確立していないモデルは cost_usd=null で units だけ記録する
 * （後から単価が判明した時点で units から再計算できるようにする）。
 */
type PricingEntry =
  | { kind: 'tokens'; inputPerMTok: number; outputPerMTok: number }
  | { kind: 'chars'; perMChars: number }
  | { kind: 'minutes'; perMinute: number };

export const PRICING: Record<string, PricingEntry> = {
  // --- Claude（台本生成 app/api/generate-script、グラウンディング検証 lib/grounding-verifier） ---
  // 出典: https://platform.claude.com/docs/en/about-claude/pricing （WebSearch確認 2026-07-21）
  // $3.00 / 1M input tokens, $15.00 / 1M output tokens
  'claude-sonnet-4-6': { kind: 'tokens', inputPerMTok: 3.0, outputPerMTok: 15.0 },

  // --- OpenAI TTS（文字数課金の世代。tts-pipeline.ts の TTS_MODEL 既定フォールバック値） ---
  // 出典: https://developers.openai.com/api/docs/models/tts-1 （WebSearch確認 2026-07-21） $15.00 / 1M chars
  'tts-1': { kind: 'chars', perMChars: 15.0 },
  // 出典: https://developers.openai.com/api/docs/models/tts-1-hd （WebSearch確認 2026-07-21） $30.00 / 1M chars
  'tts-1-hd': { kind: 'chars', perMChars: 30.0 },

  // --- OpenAI Whisper（TTS検査） ---
  // 出典: https://developers.openai.com/api/docs/models/whisper-1 （WebSearch確認 2026-07-21） $0.006 / 分
  'whisper-1': { kind: 'minutes', perMinute: 0.006 },

  // --- OpenAI gpt-4o-mini-tts（実運用モデル。TTS_MODEL=gpt-4o-mini-tts-2025-12-15 をプレフィックス一致で拾う） ---
  // 正確な単価はトークン課金（入力テキスト $0.60 / 1M tokens、出力オーディオ $12.00 / 1M tokens）だが、
  // openai.audio.speech.create のレスポンスにトークン数が返らず、日本語の文字数→トークン変換は誤差が大きい。
  // そこで OpenAI 自身が公式に示している概算「約 $0.015 / 分」を採用し、audio_seconds（概算）から計算する。
  // 入力テキスト分（$0.60/1M tok）は含まれないが金額比で軽微。あくまで概算である旨は units 併記で担保。
  // 出典: https://developers.openai.com/api/docs/models/gpt-4o-mini-tts（"approximately $0.015 per minute"・WebSearch確認 2026-07-21）
  'gpt-4o-mini-tts': { kind: 'minutes', perMinute: 0.015 },
};

/** 完全一致優先、無ければ日付サフィックス付きモデル名（例: gpt-4o-mini-tts-2025-12-15）等をプレフィックス一致で拾う。 */
function lookupPricing(model: string): PricingEntry | undefined {
  if (PRICING[model]) return PRICING[model];
  const prefixMatch = Object.keys(PRICING)
    .sort((a, b) => b.length - a.length)
    .find((key) => model.startsWith(key));
  return prefixMatch ? PRICING[prefixMatch] : undefined;
}

function computeCostUsd(model: string, units: UsageUnits): number | null {
  const pricing = lookupPricing(model);
  if (!pricing) return null;
  switch (pricing.kind) {
    case 'tokens': {
      if (units.input_tokens == null && units.output_tokens == null) return null;
      const input = units.input_tokens ?? 0;
      const output = units.output_tokens ?? 0;
      return (input / 1_000_000) * pricing.inputPerMTok + (output / 1_000_000) * pricing.outputPerMTok;
    }
    case 'chars': {
      if (units.tts_chars == null) return null;
      return (units.tts_chars / 1_000_000) * pricing.perMChars;
    }
    case 'minutes': {
      if (units.audio_seconds == null) return null;
      return (units.audio_seconds / 60) * pricing.perMinute;
    }
    default:
      return null;
  }
}

let cachedClient: SupabaseClient | null | undefined;
let warnedMissingEnv = false;

/** timeslip-dj/.env.local の NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を使う（worker と同一）。 */
function getServiceClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!rawUrl || !key) {
    if (!warnedMissingEnv) {
      console.warn(
        '[usage-log] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定のため使用量記録をスキップします（生成自体は続行）',
      );
      warnedMissingEnv = true;
    }
    cachedClient = null;
    return null;
  }

  // "https://" 抜け等の記入ミスを吸収（redial/lib/supabase/env.ts と同じ対策）
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  try {
    cachedClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  } catch (e) {
    console.warn('[usage-log] Supabaseクライアント初期化失敗（使用量記録をスキップ）:', (e as Error).message);
    cachedClient = null;
  }
  return cachedClient;
}

/**
 * API使用量を Supabase api_usage に記録する。
 * fail-open: 記録の失敗は console.warn のみで、呼び出し元には一切伝播しない。
 */
export async function logApiUsage(params: LogApiUsageParams): Promise<void> {
  try {
    const client = getServiceClient();
    if (!client) return;

    let generationId: number | null = null;
    if (params.generationId !== undefined && params.generationId !== null) {
      const n = Number(params.generationId);
      generationId = Number.isFinite(n) ? n : null;
    }

    const costUsd = computeCostUsd(params.model, params.units);

    const { error } = await client.from('api_usage').insert({
      source: 'measured',
      provider: params.provider,
      model: params.model,
      purpose: params.purpose,
      units: params.units,
      cost_usd: costUsd,
      generation_id: generationId,
      day: null,
    });

    if (error) {
      console.warn(`[usage-log] insert失敗 (${params.purpose}/${params.provider}/${params.model}):`, error.message);
    }
  } catch (e) {
    // fail-open: ここで何が起きても生成パイプラインを止めない
    console.warn(`[usage-log] 予期しないエラー (${params.purpose}/${params.provider}):`, (e as Error)?.message ?? e);
  }
}
