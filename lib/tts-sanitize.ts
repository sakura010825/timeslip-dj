/**
 * TTS入力テキストの安全化（P1: sanitize強化）
 *
 * 既知のドロップアウト誘発パターン:
 *  - `……` (U+2026 × 2) の連続：段落境界やカタカナ移行と組み合わさると無音化しやすい
 *  - 段落先頭/末尾の不要な記号
 *  - ゼロ幅・制御文字
 */

import { applyPronunciationDict } from './tts-pronunciation-dict';

export type SanitizeResult = {
  clean: string;
  warnings: string[];
  dictApplied: { pattern: string; count: number }[];
};

const CONTROL_CHARS = new RegExp(
  '[' +
    '\\u0000-\\u0008' +
    '\\u000B-\\u001F' +
    '\\u007F' +
    '\\uFEFF' +
    '\\u200B-\\u200F' +
    '\\u2028-\\u202F' +
    ']',
  'g',
);

export function sanitizeForTTS(input: string): SanitizeResult {
  const warnings: string[] = [];
  let s = input;

  const beforeCtrl = s.length;
  s = s.replace(CONTROL_CHARS, '');
  if (beforeCtrl !== s.length) {
    warnings.push(`removed ${beforeCtrl - s.length} control/zero-width chars`);
  }

  const before26 = countOccurrences(s, '……');
  s = s.replace(/……+/g, '、');
  s = s.replace(/…/g, '、');
  if (before26 > 0) {
    warnings.push(`replaced ${before26} occurrences of "……" with "、"`);
  }

  // em-dash / horizontal bar / en-dash / figure-dash
  // U+2014 — / U+2015 ― / U+2013 – / U+2012 ‒
  const beforeDash = s;
  s = s.replace(/[—―–‒]+/g, '、');
  if (s !== beforeDash) {
    warnings.push('em-dash/horizontal-bar replaced with "、"');
  }

  s = s.replace(/、{2,}/g, '、');
  s = s.replace(/。{2,}/g, '。');

  // 半角スペース入りカタカナ語 → 中黒で接続（onyxの英語モード切替を防ぐ）
  // 例: 「マイ フレンド」→「マイ・フレンド」
  const beforeKataSpace = s;
  let prev: string;
  do {
    prev = s;
    s = s.replace(/([゠-ヿ])[ 　\t]+([゠-ヿ])/g, '$1・$2');
  } while (s !== prev);
  if (s !== beforeKataSpace) {
    warnings.push('katakana spaces replaced with ・');
  }

  s = s.replace(/[ \t]+/g, ' ');

  s = s
    .split(/\n/)
    .map((line) => line.trim())
    .join('\n');
  s = s.replace(/\n{3,}/g, '\n\n');

  s = s.replace(/^[、。\s]+/, '');
  s = s.replace(/[、\s]+$/, '');

  const ascii = s.match(/[A-Za-z]{2,}/g);
  if (ascii && ascii.length > 0) {
    warnings.push(`ASCII leaked: ${JSON.stringify(ascii.slice(0, 5))}`);
  }

  const { output: afterDict, applied } = applyPronunciationDict(s);
  s = afterDict;
  if (applied.length > 0) {
    warnings.push(
      `pronunciation dict applied: ${applied.map((a) => `${a.pattern}×${a.count}`).join(', ')}`,
    );
  }

  return { clean: s, warnings, dictApplied: applied };
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
