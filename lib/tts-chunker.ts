/**
 * TTSチャンク分割（P2）
 *
 * 方針:
 *  - 1次分割: 句点「。」で文単位に切る
 *  - 2次分割: 1文が150字超なら読点「、」で再分割
 *  - 結合: 30字未満の短い断片は前後と結合してプロソディを保つ
 *  - 段落境界: 元テキストの空行を「段落境界」フラグとして保持（concat時に長めの間を入れる）
 */

const TARGET_MAX_CHARS = 150;
const MIN_CHARS = 30;

export type Chunk = {
  index: number;
  text: string;
  /** このチャンクの後ろが段落境界（=concat時に長めの無音を入れる） */
  paragraphBoundaryAfter: boolean;
};

export function splitIntoChunks(input: string): Chunk[] {
  const paragraphs = input.split(/\n{2,}/).map((p) => p.replace(/\n/g, '').trim()).filter((p) => p.length > 0);
  const out: { text: string; paragraphBoundaryAfter: boolean }[] = [];

  paragraphs.forEach((para, paraIdx) => {
    const isLastPara = paraIdx === paragraphs.length - 1;

    const sentences = splitBy(para, '。');
    const sized = mergeAndResplit(sentences);

    sized.forEach((text, i) => {
      const isLastInPara = i === sized.length - 1;
      out.push({
        text,
        paragraphBoundaryAfter: isLastInPara && !isLastPara,
      });
    });
  });

  return out.map((c, index) => ({ index, ...c }));
}

/** 区切り文字で分割し、区切り文字を末尾に残す。 */
function splitBy(text: string, delim: string): string[] {
  const parts: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (ch === delim) {
      parts.push(buf);
      buf = '';
    }
  }
  if (buf.length > 0) parts.push(buf);
  return parts.filter((p) => p.length > 0);
}

/**
 * 短い断片は結合し、長すぎる断片は読点で再分割する。
 */
/**
 * 1チャンクを2つに分割する（最終フォールバック用）。
 * 読点で割れるならそこで割る。読点がなければ中央付近の文字で割る。
 * 分割できなかったら（極端に短い等）、元と同じ単一要素を返す。
 */
export function subdivideChunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length < 16) return [trimmed];

  const commaIndices: number[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '、') commaIndices.push(i);
  }
  if (commaIndices.length > 0) {
    const mid = trimmed.length / 2;
    let bestIdx = commaIndices[0];
    let bestDist = Math.abs(bestIdx - mid);
    for (const idx of commaIndices) {
      const d = Math.abs(idx - mid);
      if (d < bestDist) {
        bestIdx = idx;
        bestDist = d;
      }
    }
    const a = trimmed.slice(0, bestIdx + 1).trim();
    const b = trimmed.slice(bestIdx + 1).trim();
    if (a.length > 0 && b.length > 0) return [a, b];
  }

  // 読点がなければ中央で割る
  const mid = Math.floor(trimmed.length / 2);
  return [trimmed.slice(0, mid).trim(), trimmed.slice(mid).trim()].filter((s) => s.length > 0);
}

function mergeAndResplit(sentences: string[]): string[] {
  const result: string[] = [];
  let buf = '';

  const flushBuf = () => {
    if (buf.length > 0) {
      result.push(buf);
      buf = '';
    }
  };

  for (const s of sentences) {
    if (s.length > TARGET_MAX_CHARS) {
      flushBuf();
      const subParts = splitBy(s, '、');
      let subBuf = '';
      for (const sp of subParts) {
        if (subBuf.length + sp.length > TARGET_MAX_CHARS && subBuf.length > 0) {
          result.push(subBuf);
          subBuf = sp;
        } else {
          subBuf += sp;
        }
      }
      if (subBuf.length > 0) result.push(subBuf);
      continue;
    }

    if (buf.length + s.length < MIN_CHARS) {
      buf += s;
      continue;
    }

    if (buf.length > 0 && buf.length + s.length <= TARGET_MAX_CHARS) {
      buf += s;
      continue;
    }

    flushBuf();
    buf = s;
  }
  flushBuf();

  return result.map((s) => s.trim()).filter((s) => s.length > 0);
}
