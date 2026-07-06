import type { KnowledgeItem } from './knowledge-loader';

const IMPORTANCE_WEIGHT = {
  high: 3,
  medium: 2,
  low: 1,
} as const;

/** 走馬灯ルール5「毎日の生活の手触りを必ず一つ以上混ぜる」を抽選側で保証するカテゴリ群 */
const LIFE_CATEGORIES = new Set(['food', 'cm-ads', 'tech-gadget']);

type WeightedItem = { item: KnowledgeItem; weight: number };

function weightedPick(candidates: WeightedItem[]): WeightedItem {
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let r = Math.random() * totalWeight;
  let chosen = candidates[0];
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) {
      chosen = c;
      break;
    }
  }
  return chosen;
}

/**
 * 知識ベースから1エピソード分のトピックを選出する。
 * - デフォルト8項目（走馬灯型: 1セグメント3〜4テーマ×3トーク枠＋振り返り）
 * - 生活系カテゴリ（food/cm-ads/tech-gadget）が素材に存在すれば必ず1つ含める
 *   （素材に生活系が無いと、プロンプトの「生活の手触り」ルールが事実ルールと矛盾して発火しないため）
 * - カテゴリの重複を避ける（同カテゴリを2つ選ぶのは他に候補が尽きたときのみ）
 * - importance による重み付きランダム
 */
export function selectTopics(items: KnowledgeItem[], count: number = 8): KnowledgeItem[] {
  const pool: WeightedItem[] = items.map((item) => ({
    item,
    weight: IMPORTANCE_WEIGHT[item.importance] ?? 1,
  }));

  const picked: KnowledgeItem[] = [];
  const usedCategories = new Set<string>();

  const lifeCandidates = pool.filter((p) => LIFE_CATEGORIES.has(p.item.category));
  if (lifeCandidates.length > 0 && count > 0) {
    const chosen = weightedPick(lifeCandidates);
    picked.push(chosen.item);
    usedCategories.add(chosen.item.category);
    pool.splice(pool.indexOf(chosen), 1);
  }

  while (picked.length < count && pool.length > 0) {
    const unusedCatCandidates = pool.filter((p) => !usedCategories.has(p.item.category));
    const candidates = unusedCatCandidates.length > 0 ? unusedCatCandidates : pool;
    const chosen = weightedPick(candidates);

    picked.push(chosen.item);
    usedCategories.add(chosen.item.category);
    pool.splice(pool.indexOf(chosen), 1);
  }

  return picked;
}
