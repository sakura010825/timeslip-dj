/**
 * TTS出力のWhisper往復検証（P3）
 *
 * 各チャンクのMP3をWhisper APIで文字起こしし、元テキストとの差分を計測する。
 *
 * 判定指標:
 *  - 最大連続欠落長 (maxGap): 元テキストの中で連続して文字起こしから欠けている字数
 *  - 類似度 (similarity): LCSベースの一致率
 *
 * しきい値:
 *  - maxGap >= GAP_THRESHOLD なら「ドロップアウト」と判定 → リトライ
 *  - similarity < SIMILARITY_WARN は警告のみ
 */

import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

const openai = new OpenAI();

const GAP_THRESHOLD = 5;
const SIMILARITY_WARN = 0.8;
/** transcriptに含まれるASCII英文字の比率がこれを超えたら「英語化」と判定 */
const ENGLISH_RATIO_THRESHOLD = 0.25;

export type VerifyResult = {
  ok: boolean;
  similarity: number;
  maxGap: number;
  transcript: string;
  reason?: string;
};

export async function verifyChunkAudio(mp3: Buffer, expectedText: string): Promise<VerifyResult> {
  const transcript = await transcribeMp3(mp3);
  return compareTexts(expectedText, transcript);
}

async function transcribeMp3(mp3: Buffer): Promise<string> {
  const file = await toFile(mp3, 'chunk.mp3', { type: 'audio/mpeg' });
  const res = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'ja',
    response_format: 'text',
  });
  return typeof res === 'string' ? res : (res as { text?: string }).text ?? '';
}

export function compareTexts(expected: string, actual: string): VerifyResult {
  const normExpected = normalizeForCompare(expected);
  const normActual = normalizeForCompare(actual);

  if (normExpected.length === 0) {
    return { ok: true, similarity: 1, maxGap: 0, transcript: actual };
  }

  // 英語化検出: expected に英文字がほぼないのに transcript に英文字が多い場合
  const expectedAscii = (expected.match(/[A-Za-z]/g) ?? []).length;
  const actualAscii = (actual.match(/[A-Za-z]/g) ?? []).length;
  const actualNonSpace = actual.replace(/\s/g, '').length;
  const expectedNonSpace = expected.replace(/\s/g, '').length;
  const expectedAsciiRatio = expectedNonSpace > 0 ? expectedAscii / expectedNonSpace : 0;
  const actualAsciiRatio = actualNonSpace > 0 ? actualAscii / actualNonSpace : 0;
  if (
    actualNonSpace >= 8 &&
    actualAsciiRatio > ENGLISH_RATIO_THRESHOLD &&
    actualAsciiRatio > expectedAsciiRatio + 0.15
  ) {
    return {
      ok: false,
      similarity: 0,
      maxGap: normExpected.length,
      transcript: actual,
      reason: `english-leakage: asciiRatio=${actualAsciiRatio.toFixed(2)} (expected≈${expectedAsciiRatio.toFixed(2)})`,
    };
  }

  const mask = lcsMask(normExpected, normActual);
  let maxGap = 0;
  let curGap = 0;
  for (const m of mask) {
    if (!m) {
      curGap++;
      if (curGap > maxGap) maxGap = curGap;
    } else {
      curGap = 0;
    }
  }

  const matchCount = mask.filter(Boolean).length;
  const similarity = matchCount / normExpected.length;

  let reason: string | undefined;
  let ok = true;
  if (maxGap >= GAP_THRESHOLD) {
    ok = false;
    reason = `dropout: maxGap=${maxGap} (threshold=${GAP_THRESHOLD})`;
  } else if (similarity < SIMILARITY_WARN) {
    ok = false;
    reason = `low similarity: ${similarity.toFixed(2)} (warn<${SIMILARITY_WARN})`;
  }

  return { ok, similarity: +similarity.toFixed(3), maxGap, transcript: actual, reason };
}

/**
 * 比較用に正規化する。句読点・空白・引用符・カタカナ/ひらがなのスタイル差を吸収。
 */
export function normalizeForCompare(s: string): string {
  let t = s;
  t = t.replace(/[ぁ-ゖ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60),
  );
  t = t.replace(/[、。！？!?,.:：;；…・「」『』（）()\[\]【】〈〉《》\s　]/g, '');
  t = t.toLowerCase();
  return t;
}

/**
 * LCS（最長共通部分列）に基づき、a の各文字が b 内で一致したかを示すマスクを返す。
 */
function lcsMask(a: string, b: string): boolean[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const mask = new Array(m).fill(false);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      mask[i - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return mask;
}
