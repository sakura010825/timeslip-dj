/**
 * TTS誤読対策辞書
 *
 * OpenAI tts-1-hd (onyx) の既知の誤読を、送信前にカタカナ/ひらがな表記へ置換する。
 * Whisper検証も置換後テキストに対して行うため、ここを通したテキストが「正解」として扱われる。
 *
 * 追加方針:
 *  - .tts-archive/ の入出力ペアを聴いて誤読が確認できたものを追加
 *  - 一般的な単語は追加しない（過剰置換で別の誤読を生む）
 *  - 固有名詞・難読語に絞る
 */

export type PronunciationEntry = {
  /** マッチさせる元表記 */
  pattern: string;
  /** 置換後の読み（カタカナまたはひらがな） */
  replacement: string;
  /** メモ（誤読の確認元など） */
  note?: string;
};

export const PRONUNCIATION_DICT: PronunciationEntry[] = [
  // 2026-04-24 セッションで確認された誤読
  { pattern: '押井守', replacement: 'おしいまもる', note: '「おじまもる」と誤読' },
  { pattern: '密か', replacement: 'ひそか', note: '「みつか」と誤読' },
  // 2026-04-30 セッションで確認された誤読
  { pattern: '競馬', replacement: 'けいば', note: '「きょうば」と誤読' },
  { pattern: '仰木彬', replacement: 'おおぎあきら', note: '読めず破綻' },
  { pattern: '仰木', replacement: 'おおぎ', note: '単独使用時のフォールバック' },
];

/**
 * テキストに誤読辞書を適用する。
 * 単純な文字列置換（正規表現エスケープ不要なリテラルマッチ）。
 */
export function applyPronunciationDict(input: string): {
  output: string;
  applied: { pattern: string; count: number }[];
} {
  let output = input;
  const applied: { pattern: string; count: number }[] = [];

  for (const entry of PRONUNCIATION_DICT) {
    const occurrences = countOccurrences(output, entry.pattern);
    if (occurrences > 0) {
      output = output.split(entry.pattern).join(entry.replacement);
      applied.push({ pattern: entry.pattern, count: occurrences });
    }
  }

  return { output, applied };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}
