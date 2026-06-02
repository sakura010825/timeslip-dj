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
  /** Phase 2「データの再設計」: WebSearch検証済みか（false/未設定は生成に使わせない運用） */
  verified?: boolean;
  /** 検証の出典（再検証コスト削減・信頼性の記録） */
  sources?: string[];
  /** DJがほぼそのまま喋れる検証済みの言い回し（生成時の発明の余地を減らす） */
  speakableContext?: string;
  /** 既知の罠ガード（例:「出演者は松嶋菜々子・堤真一のみ」「歌詞は引用しない」） */
  doNotSay?: string[];
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
