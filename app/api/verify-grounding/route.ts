import { NextResponse } from 'next/server';
import { loadKnowledgeBase, monthToSeason } from '@/lib/knowledge-loader';
import { verifyGrounding } from '@/lib/grounding-verifier';

/**
 * Layer 3 グラウンディング検証エンドポイント。
 *
 * 生成された台本（全文または1セグメント）を、その年×季節の知識ベースに照合し、
 * 素材に根拠を持たない主張（critical/minor）を返す。
 * 人手の WebSearch fact-check を、検証済みのローカル知識ベースに対して自動化したもの。
 *
 * バッチ生成フロー（scripts/batch-generate.mjs）から TTS の前段で呼ばれる。
 * 設計: redial/docs/PHASE2_ONDEMAND_DESIGN.md §4 Layer 3
 *
 * 入力:  { year, season } または { year, month }, scriptText
 * 出力:  GroundingReport（ungrounded[], criticalCount, minorCount, raw） + meta
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const yearNum = Number(body.year);
    const season: string = body.season ?? monthToSeason(Number(body.month));
    const scriptText: string = body.scriptText;
    const generationId: number | string | null = body.generationId != null ? body.generationId : null;

    if (typeof scriptText !== 'string' || scriptText.trim().length === 0) {
      return NextResponse.json({ error: 'scriptText が空です' }, { status: 400 });
    }

    const kb = loadKnowledgeBase(yearNum, season);
    const report = await verifyGrounding({ scriptText, knowledgeItems: kb.items, generationId });

    return NextResponse.json({
      ...report,
      meta: { year: yearNum, season, kbItemCount: kb.items.length },
    });
  } catch (error) {
    console.error('Grounding verification error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `グラウンディング検証に失敗しました: ${message}` },
      { status: 500 },
    );
  }
}
