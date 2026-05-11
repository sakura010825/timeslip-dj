import type { KnowledgeItem } from './knowledge-loader';

const IMPORTANCE_WEIGHT = {
  high: 3,
  medium: 2,
  low: 1,
} as const;

/**
 * 知識ベースから1エピソード分のトピックを選出する。
 * - デフォルト5項目
 * - カテゴリの重複を避ける（同カテゴリを2つ選ぶのは他に候補が尽きたときのみ）
 * - importance による重み付きランダム
 */
export function selectTopics(items: KnowledgeItem[], count: number = 5): KnowledgeItem[] {
  const pool = items.map((item) => ({
    item,
    weight: IMPORTANCE_WEIGHT[item.importance] ?? 1,
  }));

  const picked: KnowledgeItem[] = [];
  const usedCategories = new Set<string>();

  while (picked.length < count && pool.length > 0) {
    const unusedCatCandidates = pool.filter((p) => !usedCategories.has(p.item.category));
    const candidates = unusedCatCandidates.length > 0 ? unusedCatCandidates : pool;

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

    picked.push(chosen.item);
    usedCategories.add(chosen.item.category);
    pool.splice(pool.indexOf(chosen), 1);
  }

  return picked;
}
