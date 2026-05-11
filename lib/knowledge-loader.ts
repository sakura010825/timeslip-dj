import fs from 'fs';
import path from 'path';

export type KnowledgeImportance = 'high' | 'medium' | 'low';

export type KnowledgeItem = {
  id: string;
  category: string;
  year: number;
  season: string;
  month: number;
  title: string;
  oneLiner: string;
  context: string;
  keywords: string[];
  importance: KnowledgeImportance;
  usedInEpisodes: string[];
};

export type KnowledgeBase = {
  year: number;
  season: string;
  months: number[];
  description: string;
  items: KnowledgeItem[];
};

const KB_ROOT = path.resolve(process.cwd(), '..', 'redial', 'data', 'knowledge');

export function loadKnowledgeBase(year: number, season: string): KnowledgeBase {
  const filePath = path.join(KB_ROOT, `${year}-${season}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `知識ベースが見つかりません: ${year}-${season}.json (expected at ${filePath})`
    );
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as KnowledgeBase;
}

export function monthToSeason(month: number): string {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}
