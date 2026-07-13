/**
 * 窓解決: seg mp3の実体解決 → Whisper word timestamps（キャッシュ）→ アンカー句→[t0,t1]
 * 設計 §4。時刻付きtranscriptは実在しないため、対象segをWhisperで都度解決しキャッシュする。
 */
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import {
  STOCK_ROOT, CACHE_ROOT, ensureDir, readJson, normalizeForCompare,
} from './util.mjs';

/** stock.json を読み、segmentIndex → { segmentName, mp3Path, durationSec } を返す */
export function locateSegAudio(slug, segIndex) {
  const stockPath = path.join(STOCK_ROOT, slug, 'stock.json');
  if (!fs.existsSync(stockPath)) {
    throw new Error(`stock.json が見つかりません: ${stockPath}（--cell の値=slugを確認）`);
  }
  const stock = readJson(stockPath);
  const seg = (stock.segments ?? []).find((s) => s.segmentIndex === segIndex);
  if (!seg) {
    throw new Error(`seg${segIndex} が ${slug} に存在しません（存在するのは 0..${(stock.segments?.length ?? 1) - 1}）`);
  }
  const mp3Path = path.join(STOCK_ROOT, slug, 'segments', `seg${segIndex}-${seg.segmentName}.mp3`);
  if (!fs.existsSync(mp3Path)) {
    throw new Error(`seg音声が見つかりません: ${mp3Path}`);
  }
  return { segmentName: seg.segmentName, mp3Path, durationSec: seg.estimatedDurationSec ?? null };
}

/** Whisper verbose_json (word timestamps) を取得。キャッシュ優先。 */
export async function getWords(slug, segIndex, mp3Path) {
  ensureDir(CACHE_ROOT);
  const cachePath = path.join(CACHE_ROOT, `${slug}-seg${segIndex}.words.json`);
  const stat = fs.statSync(mp3Path);
  const sig = `${stat.size}:${Math.round(stat.mtimeMs)}`;

  if (fs.existsSync(cachePath)) {
    const cached = readJson(cachePath);
    if (cached.sig === sig && Array.isArray(cached.words) && cached.words.length) {
      return cached;
    }
  }

  const openai = new OpenAI();
  const res = await openai.audio.transcriptions.create({
    file: fs.createReadStream(mp3Path),
    model: 'whisper-1',
    language: 'ja',
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
  });

  const words = (res.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end }));
  const segments = (res.segments ?? []).map((s) => ({ text: s.text, start: s.start, end: s.end }));
  const data = { sig, text: res.text ?? '', words, segments };
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 1));
  return data;
}

/**
 * アンカー句を word列にマッチさせて時刻を返す。
 * mode 'start' は最良一致の先頭語の start、'end' は末尾語の end を返す。
 * 返り値: { time, score, matchedText } / 見つからなければ score=0
 */
function matchAnchor(words, anchor, mode) {
  const normAnchor = normalizeForCompare(anchor);
  if (!normAnchor) return { time: null, score: 0, matchedText: '' };

  // word列の正規化と、各wordの正規化後開始オフセットを作る
  const normWords = words.map((w) => normalizeForCompare(w.word));
  const joined = normWords.join('');
  // 各文字位置 → wordインデックスの逆引き
  const charToWord = [];
  normWords.forEach((nw, wi) => { for (let k = 0; k < nw.length; k++) charToWord.push(wi); });

  // アンカーを joined 内で部分一致探索（完全一致優先→なければ最長共通接頭辞スライド）
  let bestPos = -1;
  let bestScore = 0;
  const L = normAnchor.length;
  for (let i = 0; i + 1 <= joined.length; i++) {
    // i から L 文字ぶんの一致率
    const window = joined.slice(i, i + L);
    if (!window) break;
    let match = 0;
    for (let k = 0; k < window.length; k++) if (window[k] === normAnchor[k]) match++;
    const score = match / L;
    if (score > bestScore) { bestScore = score; bestPos = i; if (score === 1) break; }
  }
  if (bestPos < 0) return { time: null, score: 0, matchedText: '' };

  const startWordIdx = charToWord[bestPos];
  const endCharPos = Math.min(bestPos + L - 1, joined.length - 1);
  const endWordIdx = charToWord[endCharPos];
  const matchedText = words.slice(startWordIdx, endWordIdx + 1).map((w) => w.word).join('');

  const time = mode === 'start' ? words[startWordIdx].start : words[endWordIdx].end;
  return { time, score: +bestScore.toFixed(2), matchedText, startWordIdx, endWordIdx };
}

/**
 * start/end アンカーから切り出し窓を解決する。
 * words が薄い場合は segments（文節）境界でフォールバック。
 */
export function resolveWindow({ data, startAnchor, endAnchor, padStart, padEnd, segDurationSec }) {
  const words = data.words ?? [];
  const useWords = words.length >= 4;

  let startM, endM;
  if (useWords) {
    startM = matchAnchor(words, startAnchor, 'start');
    endM = matchAnchor(words, endAnchor, 'end');
  }

  // フォールバック: segments（文節・start/end付き）で近似
  if (!useWords || (startM?.score ?? 0) < 0.8 || (endM?.score ?? 0) < 0.8) {
    const segFb = matchViaSegments(data.segments ?? [], startAnchor, endAnchor);
    if (segFb) {
      startM = startM && startM.score >= 0.8 ? startM : { time: segFb.startTime, score: segFb.startScore, matchedText: segFb.startText, fallback: true };
      endM = endM && endM.score >= 0.8 ? endM : { time: segFb.endTime, score: segFb.endScore, matchedText: segFb.endText, fallback: true };
    }
  }

  const startScore = startM?.score ?? 0;
  const endScore = endM?.score ?? 0;
  let t0 = startM?.time;
  let t1 = endM?.time;
  if (t0 == null || t1 == null || t1 <= t0) {
    return { ok: false, startScore, endScore, startText: startM?.matchedText ?? '', endText: endM?.matchedText ?? '', t0, t1 };
  }

  t0 = Math.max(0, t0 - padStart);
  t1 = t1 + padEnd;
  if (segDurationSec) t1 = Math.min(t1, segDurationSec);

  return {
    ok: true,
    t0: +t0.toFixed(3),
    t1: +t1.toFixed(3),
    dur: +(t1 - t0).toFixed(3),
    startScore,
    endScore,
    startText: startM?.matchedText ?? '',
    endText: endM?.matchedText ?? '',
    fallback: !!(startM?.fallback || endM?.fallback),
  };
}

function matchViaSegments(segments, startAnchor, endAnchor) {
  if (!segments.length) return null;
  const nStart = normalizeForCompare(startAnchor);
  const nEnd = normalizeForCompare(endAnchor);
  let best = { startTime: null, startScore: 0, startText: '', endTime: null, endScore: 0, endText: '' };
  for (const s of segments) {
    const ns = normalizeForCompare(s.text);
    if (ns.includes(nStart.slice(0, Math.min(nStart.length, 8))) && best.startTime == null) {
      best.startTime = s.start; best.startScore = 0.8; best.startText = s.text;
    }
    if (ns.includes(nEnd.slice(0, Math.min(nEnd.length, 8)))) {
      best.endTime = s.end; best.endScore = 0.8; best.endText = s.text;
    }
  }
  return best;
}
