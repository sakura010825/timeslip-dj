/**
 * TTS出力のWhisper往復検証（P3）
 *
 * 各チャンクのMP3をWhisper APIで文字起こしし、元テキストとの差分を計測する。
 *
 * 判定指標:
 *  - 最大連続欠落長 (maxGap): 元テキストの中で連続して文字起こしから欠けている字数
 *  - 類似度 (similarity): LCSベースの一致率
 *  - 重複 (extra repeat): 原稿に無い長い繰り返しが転写に現れる ＝ 同じ箇所を二度読む「どもり」
 *
 * しきい値:
 *  - maxGap >= GAP_THRESHOLD なら「ドロップアウト」と判定 → リトライ
 *  - similarity < SIMILARITY_WARN は警告のみ
 *  - 重複を検出したら → リトライ
 *
 * ⚠️ なぜ重複を独立に見るのか（2026-07-15・公開11本で実害を確認して追加）:
 *   LCS類似度は「原稿が転写の部分列として残っているか」しか見ないので、TTSが同じ文を
 *   二度読んでも原稿は部分列として残り similarity≈1 で合格してしまう＝原理的に重複を検出できない。
 *   実例: 1990夏 seg2「…流れ方のひとつでした」を2回読んだ音声が similarity=0.977/ok=true で通過。
 */

import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { logApiUsage } from './usage-log';

const openai = new OpenAI();

/** mp3バイト数から秒数を概算する。128kbps mono 前提（tts-pipeline.ts/route.ts と同じ既存の慣例値）。 */
function estimateAudioSeconds(mp3: Buffer): number {
  return +(mp3.length / 16384).toFixed(1);
}

const GAP_THRESHOLD = 5;
const SIMILARITY_WARN = 0.8;
/**
 * 「転写にだけ現れる繰り返し」をどこから重複とみなすか（正規化後の文字数）。
 * 公開25本807チャンクで検証: 12〜15字はいずれも同じ15件を検出（＝実害のあった全件）、
 * 10字まで下げると誤検出が4件増える。安全側の下限として12を採用。
 */
const REPEAT_MIN_LEN = 12;
/** transcriptに含まれるASCII英文字の比率がこれを超えたら「英語化」と判定 */
const ENGLISH_RATIO_THRESHOLD = 0.25;

export type VerifyResult = {
  ok: boolean;
  similarity: number;
  maxGap: number;
  transcript: string;
  reason?: string;
};

export async function verifyChunkAudio(
  mp3: Buffer,
  expectedText: string,
  generationId?: number | string | null,
): Promise<VerifyResult> {
  const transcript = await transcribeMp3(mp3, generationId);
  return compareTexts(expectedText, transcript);
}

async function transcribeMp3(mp3: Buffer, generationId?: number | string | null): Promise<string> {
  const file = await toFile(mp3, 'chunk.mp3', { type: 'audio/mpeg' });
  const res = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'ja',
    response_format: 'text',
  });

  void logApiUsage({
    provider: 'openai',
    model: 'whisper-1',
    purpose: 'whisper_verify',
    units: { audio_seconds: estimateAudioSeconds(mp3) },
    generationId,
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

  // 重複検出（LCSの前に見る。LCSでは原理的に見えないため）
  const repeat = findExtraRepeat(normActual, normExpected);
  if (repeat) {
    return {
      ok: false,
      similarity: 0,
      maxGap: 0,
      transcript: actual,
      reason: `repeat: 「${repeat.phrase.slice(0, 24)}」×${repeat.times}`,
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

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = 0;
  for (;;) {
    const j = haystack.indexOf(needle, i);
    if (j < 0) break;
    n++;
    i = j + 1;
  }
  return n;
}

/**
 * 転写にだけ現れる最長の繰り返し句を返す（原稿にも同数現れる繰り返しは正当なので除外）。
 * 見つからなければ null。
 */
export function findExtraRepeat(
  normActual: string,
  normExpected: string,
): { phrase: string; times: number } | null {
  for (let i = 0; i + REPEAT_MIN_LEN <= normActual.length; i++) {
    const seed = normActual.slice(i, i + REPEAT_MIN_LEN);
    if (countOccurrences(normActual, seed) < 2) continue;
    if (countOccurrences(normActual, seed) <= countOccurrences(normExpected, seed)) continue;
    // 伸ばせるだけ伸ばして、繰り返しの全長を得る
    let len = REPEAT_MIN_LEN;
    while (i + len + 1 <= normActual.length) {
      const grown = normActual.slice(i, i + len + 1);
      if (
        countOccurrences(normActual, grown) >= 2 &&
        countOccurrences(normActual, grown) > countOccurrences(normExpected, grown)
      ) {
        len++;
      } else break;
    }
    const phrase = normActual.slice(i, i + len);
    return { phrase, times: countOccurrences(normActual, phrase) };
  }
  return null;
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
