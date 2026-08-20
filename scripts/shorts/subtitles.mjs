/**
 * 字幕ASS生成。Whisperの segment（文/フレーズ単位・クリーンな句読点・信頼できる時刻）を字幕イベントの
 * 基本単位にする。word トークンは日本語で境界が不安定（例「シール」→「シ」+「ール」）なため使わない。
 * 改行は「シンヤの間＝segment内の空白」と句読点でのみ行い、単語の途中で切らない（hideフィードバック 2026-07-13）。
 * 設計 §5。libassで描画。日本語フォントは fontsdir で渡す。
 */
import fs from 'node:fs';
import { assTime, normalizeForCompare } from './util.mjs';

const SEASON_JP = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const MAX_LINE = 15; // 1行の全角目安（フォント56px・使用幅936px≒16.7字ぶん）。超えたら改行する
const SPLIT_EVENT = 34; // これを超えるsegmentは時間比で2イベントに分割

/**
 * 見出し札（2026-08-18・SHORTS_RECIPE §2-j）＝**最初の1秒で「読む」のではなく「見える」札**。
 *
 * なぜ要るか: チャンネルの常態は「視聴を継続」11〜20%（目に入った人の8割超が1秒でスワイプ）。
 * 同ジャンルで回っている2アカウント（@実はな実話 中央値22.6万再生／音楽語りカセットくん 9.3万）を
 * 実測したところ、**登録率はうち（0.044%）と同じ 0.043〜0.045%**で、差は1本が通過する人数だけだった。
 * 向こうの焼き込み札は画面高の8〜12%／行・8〜12字・全尺表示。うちの旧タイトルカードは fs54
 * （2.8%／行）・23字×2行・0〜3.6秒で消える＝**205pxのサムネで5.8px・判読不能**、読み切るのに約3秒。
 *
 * 設計（案X・hide承認 2026-08-18）:
 *   - 題名（メタデータ・24〜30字の文）とは**別に**、2行×各10字以内の見出しを毎回書く（manifest `card`）
 *   - fs130（画面高の6.8%＝旧の2.4倍）。205pxサムネで約14px＝読める
 *   - 極太の明朝（新聞見出し）。トリビア系のポップゴシック＋黄色とは違う顔にする
 *   - 色は生成り（クリーム）＋ `*語*` で囲んだ1語だけ琥珀（ダイヤルの灯り）。黄色は使わない
 *   - 上段（YouTube UI y≤169 とバッジ/CTA の下・字幕の上）・**全尺表示**（サムネにどのフレームが
 *     選ばれても札が乗る／向こうも全尺）
 *   - S3（儀式・道具）の見出しは「手で触れる物・動作・音」を必ず1つ入れる（「そうそう」は具体物で発火する）
 * `card` 未指定なら従来の小さなタイトルカード（旧レンダの再現用）。
 */
/**
 * 札の大きさ（使用幅 960px = 1080 - 60 - 60 に収める）:
 *   M = 10字×2行（1字≒92px・画面高の4.8%）…… 文として書ける最小の大きさ
 *   L =  7字×3行（1字≒128px・画面高の6.7%）…… 向こうの札に近い。字を減らして大きく
 * fs は HG（行高≒1em）基準。Noto は行高1.448em なので ×1.41 する（resolveCardFont）。
 */
const CARD_SIZES = {
  M: { max: 10, lines: 2, fsHG: 92, fsNoto: 130 },
  L: { max: 7, lines: 3, fsHG: 128, fsNoto: 180 },
};
const CARD_CREAM = '&H00D3EAF3&';    // #F3EAD3（ASSはBGR順）
const CARD_AMBER = '&H0041B4F2&';    // #F2B441 ダイヤルの灯り

/**
 * 見出し札の書体プリセット（2026-08-18 実測で選定）。
 *
 * ⚠️ libass の Fontsize は em ではなく**行の高さ（ascent+descent）**。Noto CJK は 1.448em なので
 *   fs130 で 1字≒89px、HG系（Office同梱・行の高さ≒1em）は fs92 で 1字≒92px。**同じ見た目の
 *   大きさにするには HG は fs92 が Noto の fs130 に相当**する（fs130 のままだと10字=1300pxで画面外）。
 * ⚠️ HG明朝E／HG創英角ゴシックUB は Microsoft Office 同梱（C:\Windows\Fonts\HGRME.TTC 等）。
 *   **repo には入れない**（再配布不可）。libass はシステムフォントも引けるので family 名で参照する。
 *   ただし libass は見つからない書体を**黙って別のシステム書体に置き換える**（Yu Gothic 等・2026-08-18 実測）
 *   ので、ファイルの存在を先に確かめて、無ければ落とす（黙って壊れる系は必ず先に止める）。
 * Noto（'noto'）は repo 同梱の可変フォント。Bold=1 は疑似ボールドで太さはほぼ出ない（実測）が、
 * どのPCでも同じに描ける安全側の書体として残す。
 */
const CARD_FONTS = {
  // 極太明朝＝当時の新聞見出し・チラシの顔。トリビア系のポップゴシックと違う（本命）
  mincho: { family: 'HG明朝E', file: 'C:/Windows/Fonts/HGRME.TTC', hg: true, bold: 0, outline: 5, dj: 30 },
  // 90年代テレビテロップの太ゴシック（比較用・音が大きい）
  gothic: { family: 'HG創英角ｺﾞｼｯｸUB', file: 'C:/Windows/Fonts/HGRSGU.TTC', hg: true, bold: 0, outline: 5, dj: 30 },
  // repo同梱・どのPCでも同じ（控えめ）
  noto: { family: 'Noto Serif JP', file: null, hg: false, bold: 1, outline: 6, dj: 34 },
  'noto-sans': { family: 'Noto Sans JP', file: null, hg: false, bold: 1, outline: 6, dj: 34 },
};
CARD_FONTS.serif = CARD_FONTS.noto;       // 旧名の別名
CARD_FONTS.sans = CARD_FONTS['noto-sans'];

export function resolveCardFont(name, size = 'M') {
  const key = String(name ?? 'mincho');
  const f = CARD_FONTS[key];
  if (!f) throw new Error(`cardFont「${key}」は未定義です（${Object.keys(CARD_FONTS).join(' / ')}）`);
  const sz = CARD_SIZES[String(size ?? 'M')];
  if (!sz) throw new Error(`cardSize「${size}」は未定義です（${Object.keys(CARD_SIZES).join(' / ')}）`);
  if (f.file && process.platform === 'win32' && !fs.existsSync(f.file)) {
    throw new Error(`見出し札の書体「${f.family}」がこのPCにありません（${f.file}）\n   → Office同梱フォント。無いPCでは cardFont を noto にしてください（黙って別書体に落ちるのを防ぐため止めています）`);
  }
  return { key, ...f, fs: f.hg ? sz.fsHG : sz.fsNoto, size: sz };
}

/** ASSテキスト用エスケープ（改行・オーバーライド記号の暴発防止） */
function assEscape(s) {
  return (s ?? '').replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim();
}

const visLen = (s) => normalizeForCompare(s).length;

/** segment.text → フレーズ配列（空白＝間、読点直後で分割・単語は割らない）
 *  ⚠️ 句点の直後に閉じ括弧が続く「…なさい。」と書いた」のような並びで機械的に割ると、
 *     「」」だけが次行の先頭に取り残される（2026-07-17 1995春で露見）。閉じ括弧・読点が
 *     続く場合は割らない（禁則）。 */
function toPhrases(text) {
  return (text ?? '')
    .trim()
    .replace(/^[、。」』）・\s]+/, '')
    .split(/\s+/)
    .flatMap((p) => p.split(/(?<=[、。])(?![」』）\]｝、。・])/))
    .map((p) => p.trim())
    .filter(Boolean);
}

/** 表示幅（全角=1・半角=0.5）。visLenは比較用の正規化（読点除去・カナ化）で表示幅ではない。 */
const dispLen = (s) => Array.from(s ?? '')
  .reduce((n, ch) => n + (/[\x00-\xFF｡-ﾟ]/.test(ch) ? 0.5 : 1), 0);

/** 折り返しの最小単位。全角は1文字＝1トークン、半角の連続（1995 / ReDial 等）は割らずに1トークン。
 *  2026-08-18 追加（#37『ビューティフルライフ』が「ライ／フ」に割れた・行長を揃える再折り返しが語の中で切る）:
 *   ・『…』「…」《…》の括弧内は1トークン（番組名・曲名は割らない）
 *   ・カタカナの連続（ー・゛゜含む）は1トークン（外来語・人名は割らない）
 *  どちらも幅が MAX_LINE を超える塊はこれまでどおり1字ずつに戻す（1行に収まらない語は割るしかない）。 */
function tokenizeJa(s) {
  const src = Array.from(s ?? '');
  const toks = [];
  let buf = '';
  const flush = () => { if (buf) { toks.push(buf); buf = ''; } };
  const isKata = (ch) => /[゠-ヿー]/.test(ch);
  const OPEN = { '『': '』', '「': '」', '《': '》', '【': '】' };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (/[0-9A-Za-z]/.test(ch)) { buf += ch; continue; }
    if (isKata(ch)) {
      // カタカナ連続をまとめる（直前が半角英数バッファならそちらは先に閉じる）
      flush();
      let j = i; let run = '';
      while (j < src.length && isKata(src[j])) { run += src[j]; j++; }
      if (dispLen(run) <= MAX_LINE) { toks.push(run); i = j - 1; continue; }
      toks.push(ch); continue;
    }
    if (OPEN[ch]) {
      flush();
      const close = OPEN[ch];
      const k = src.indexOf(close, i + 1);
      if (k > i) {
        const span = src.slice(i, k + 1).join('');
        if (dispLen(span) <= MAX_LINE) { toks.push(span); i = k; continue; }
      }
      toks.push(ch); continue;
    }
    flush();
    toks.push(ch);
  }
  flush();
  return toks;
}

/** ⚠️ libassは空白の無い日本語を自動折返ししない（WrapStyle:0は空白でしか折らない）。
 *  2026-07-16にアンカー側で判明し、ショートも同じ穴だった（読点の無い長文が画面外へ溢れる）。
 *  文字数で折るが、西暦や英単語は割らず、行頭に来てはいけない約物は前行に残す。 */
// 2026-08-18: 助詞（の・が・は・を・に・と・で・も・へ・や）も行頭に置かない（日本語組版の慣例。
// 「ズ／の」「ラジオ／から」型の助詞行頭を空白で逃げていた（#33/#35）のを規則にする。1字はみ出しは
// 句読点と同じ扱い＝MAX_LINE は実幅（936px≒24字）に対して十分安全側なので溢れない）
const CLOSER = /^[、。，．！？!?」』）\]｝・ー…ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮのがはをにとでもへや]$/;

/** トークン列を幅 max で貪欲に折る。行頭に来てはいけない約物は前行に残す。 */
function wrapTokens(toks, max) {
  const lines = [];
  let cur = '';
  for (const tok of toks) {
    if (cur && dispLen(cur) + dispLen(tok) > max && !CLOSER.test(tok)) { lines.push(cur); cur = ''; }
    cur += tok;
  }
  if (cur) lines.push(cur);
  return lines;
}

function wrapJa(s, max = MAX_LINE) {
  const t = (s ?? '').trim();
  if (!t || dispLen(t) <= max) return t;
  const toks = tokenizeJa(t);
  const greedy = wrapTokens(toks, max);

  // 2行で収まるなら、**句読点の直後**で割るのが最も自然。文字数だけで割ると
  // 「数字で気持／ちを伝えていた」のように語の途中で切れて素人臭くなる（2026-07-22 実測）。
  // 両行が max に収まる候補のうち、行長が最も揃うものを選ぶ。
  if (greedy.length === 2) {
    let best = null;
    for (let i = 0; i < t.length - 1; i++) {
      if (!/[、。]/.test(t[i])) continue;
      // 「生きろ。」の 。 のように、直後が閉じ括弧なら割らない（」だけが次行頭に落ちる）
      if (/^[」』）\]｝】〉》]/.test(t[i + 1] ?? '')) continue;
      const a = t.slice(0, i + 1);
      const b = t.slice(i + 1);
      if (!b || dispLen(a) > max || dispLen(b) > max) continue;
      const cost = Math.abs(dispLen(a) - dispLen(b));
      if (!best || cost < best.cost) best = { a, b, cost };
    }
    if (best) return [best.a, best.b].join('\\N');
  }
  // 貪欲に詰めると最終行が「た。」だけ、のような落ち穂になる（2026-07-22 実測:
  // 「今夜はあの春を少しだけ歩きまし／た。」「…逆転へ向かっていっ／た」）。
  // 読めるが素人臭く見えるので、行数を増やさずに幅を詰めて行長を揃え直す。
  const n = greedy.length;
  if (n >= 2 && dispLen(greedy[n - 1]) < max * 0.4) {
    const balanced = wrapTokens(toks, Math.ceil(dispLen(t) / n));
    if (balanced.length === n) return balanced.join('\\N');
  }
  return greedy.join('\\N');
}

/**
 * 見出し札のテキストを ASS 用に組む。
 *   - 改行は書き手が `\n` で明示（無ければ wrapJa で CARD_MAX 幅に折る）
 *   - `*語*` は琥珀色（1語だけ・固有名詞か触れる物）
 *   - 各行 CARD_MAX 字・CARD_LINES_MAX 行を超えたら**落とさず止める**（溢れた札は
 *     サムネで切れる＝「見える札」の目的が死ぬ。書き直してもらう）
 * 戻り値は { text, lines }。
 */
/**
 * ナウプレイング札（2026-08-20・SHORTS_RECIPE §2-k′・型D「トーク→曲」）。
 *
 * 型Dは mp4 に曲を焼き込まない（曲はYouTubeアプリの「サウンドを追加」で投稿後に乗せる）。
 * トーク終了後、無音の曲区間（songTailSec 秒）に入ったことを示すため、下段（字幕と同じ
 * 位置＝トーク中は字幕、曲区間はこちらに入れ替わるので同じゾーンを再利用できる）に
 * 「♪ 曲名 — アーティスト（年）」を全区間表示する。見出し札（上段）は §2-k′ の
 * 「札L全尺」に従いエンドカードに切り替わる直前まで表示を継続する（buildAss 側で処理）。
 * `*語*` は見出し札と同じ琥珀強調（曲名を1語だけ目立たせる）。
 */
// NowPlaying style は fs54・使用幅936px（72,72マージン）。EM_RATIO 0.689（check-overflow.mjs実測）
// で 936/(54*0.689)≈25.2字。安全側で24（タイトルカードのfs54/使用幅900pxで23を使う先例と同じ考え方）。
function buildNowPlayingText(nowPlaying, max = 24) {
  const raw = String(nowPlaying ?? '').replace(/\r\n/g, '\n').trim();
  if (!raw) return null;
  const lines = raw.includes('\n')
    ? raw.split('\n').map((l) => l.trim()).filter(Boolean)
    : wrapJa(raw.replace(/\*/g, ''), max).split('\\N');
  const painted = lines.map((l) => {
    const esc = assEscape(l);
    const n = (esc.match(/\*/g) ?? []).length;
    if (n < 2) return esc.replace(/\*/g, '');
    return esc.replace(/\*([^*]+)\*/g, `{\\c${CARD_AMBER}}$1{\\c${CARD_CREAM}}`).replace(/\*/g, '');
  });
  return painted.join('\\N');
}

export function buildCardText(card, size = 'M') {
  const raw = String(card ?? '').replace(/\r\n/g, '\n').trim();
  if (!raw) return null;
  const sz = CARD_SIZES[String(size ?? 'M')] ?? CARD_SIZES.M;
  const lines = raw.includes('\n')
    ? raw.split('\n').map((l) => l.trim()).filter(Boolean)
    : wrapJa(raw.replace(/\*/g, ''), sz.max).split('\\N');
  const problems = [];
  if (lines.length > sz.lines) problems.push(`${lines.length}行（上限${sz.lines}行）`);
  for (const l of lines) {
    const w = dispLen(l.replace(/\*/g, ''));
    if (w > sz.max) problems.push(`「${l.replace(/\*/g, '')}」が${w}字（上限${sz.max}字）`);
  }
  if (problems.length) {
    throw new Error(`見出し札（サイズ${size}）が収まりません: ${problems.join('／')}\n   → manifest の card を ${sz.lines}行×各${sz.max}字以内に書き直してください（改行は \\n で明示）`);
  }
  // `*語*` → 琥珀。閉じ忘れは無視（そのまま * を消す）
  const painted = lines.map((l) => {
    const esc = assEscape(l);
    const n = (esc.match(/\*/g) ?? []).length;
    if (n < 2) return esc.replace(/\*/g, '');
    return esc.replace(/\*([^*]+)\*/g, `{\\c${CARD_AMBER}}$1{\\c${CARD_CREAM}}`).replace(/\*/g, '');
  });
  return { text: painted.join('\\N'), lines: painted.length };
}

/** フレーズ配列を1つの表示テキストに。長い場合はフレーズ境界（中央寄り・句読点優先）で改行し、
 *  それでも1行が長いときは wrapJa で強制的に折る。 */
function renderLine(phrases) {
  const escaped = phrases.map(assEscape).filter(Boolean);
  if (!escaped.length) return '';
  const total = visLen(escaped.join(''));
  if (total <= MAX_LINE) return escaped.join('');
  if (escaped.length === 1) return wrapJa(escaped[0]);

  const cum = [];
  let acc = 0;
  for (const e of escaped) { acc += visLen(e); cum.push(acc); }
  const half = total / 2;
  let bestIdx = 0;
  let bestCost = Infinity;
  for (let i = 0; i < escaped.length - 1; i++) {
    const afterPunct = /[、。・」』）]$/.test(escaped[i]);
    const cost = Math.abs(cum[i] - half) - (afterPunct ? 3 : 0);
    if (cost < bestCost) { bestCost = cost; bestIdx = i; }
  }
  const a = wrapJa(escaped.slice(0, bestIdx + 1).join(''));
  const b = wrapJa(escaped.slice(bestIdx + 1).join(''));
  return [a, b].filter(Boolean).join('\\N');
}

/** Whisper segments → 字幕イベント（クリップ相対時刻）。events = [{start,end,text}] */
function segmentsToEvents(segments, t0, t1, words, fixes) {
  const dur = t1 - t0;
  const base = [];
  for (const seg of segments ?? []) {
    if (seg.end <= t0 + 0.1 || seg.start >= t1 - 0.1) continue;
    const s = Math.max(0, seg.start - t0);
    const e = Math.min(dur, seg.end - t0);
    // ⚠️ 窓の端にまたがるセグメントは、**音声に無い語まで表示してしまう**（hide試写 2026-07-24）。
    //   表示時刻だけ窓内に詰めてもテキストは全文のままなので、
    //   #6=「大阪の春の空気が…」28字が1.1秒で点滅（物理的に読めない）、
    //   #9=話していない「9月24日」が冒頭に出る、が起きていた。
    //   単語時刻があるときは、窓内で実際に鳴っている語だけに刈り込む。
    let text = seg.text;
    if ((seg.start < t0 - 0.05 || seg.end > t1 + 0.05) && words?.length) {
      const lo = Math.max(seg.start, t0) - 0.05;
      const hi = Math.min(seg.end, t1) + 0.05;
      const inWin = words.filter((w) => w.start >= lo && w.end <= hi);
      // 刈り込むと空になる場合（単語時刻が薄い等）は元の全文に戻す＝出さないより出す
      const joined = applyFixes(inWin.map((w) => w.word).join(''), fixes);
      if (joined.trim()) text = joined;
    }
    const phrases = toPhrases(text);
    if (!phrases.length) continue;
    base.push({ start: s, end: e, phrases });
  }

  // 長すぎる segment は中央のフレーズ境界で2イベントに（時間は文字数比で配分）
  const events = [];
  for (const ev of base) {
    const vis = ev.phrases.reduce((n, p) => n + visLen(p), 0);
    if (vis > SPLIT_EVENT && ev.phrases.length >= 2) {
      const half = vis / 2;
      let acc = 0; let bi = 0; let best = Infinity;
      for (let i = 0; i < ev.phrases.length - 1; i++) {
        acc += visLen(ev.phrases[i]);
        if (Math.abs(acc - half) < best) { best = Math.abs(acc - half); bi = i; }
      }
      const a = ev.phrases.slice(0, bi + 1);
      const b = ev.phrases.slice(bi + 1);
      const aVis = a.reduce((n, p) => n + visLen(p), 0);
      const mid = ev.start + (ev.end - ev.start) * (aVis / vis);
      events.push({ start: ev.start, end: mid, text: renderLine(a) });
      events.push({ start: mid, end: ev.end, text: renderLine(b) });
    } else {
      events.push({ start: ev.start, end: ev.end, text: renderLine(ev.phrases) });
    }
  }

  // 最小表示・重なり調整
  for (let i = 0; i < events.length; i++) {
    if (events[i].end - events[i].start < 0.5) events[i].end = Math.min(dur, events[i].start + 0.6);
    if (i + 1 < events.length && events[i].end > events[i + 1].start) {
      events[i].end = Math.max(events[i].start + 0.4, events[i + 1].start - 0.02);
    }
  }
  return events;
}

/** 誤読語の literal 置換（[wrong,right]…）。Whisperの固有名詞誤りを、
 *  セグメントのタイミングを保ったまま校正する。音声(TTS)は正しく字幕化だけが誤るため。 */
function applyFixes(text, fixes) {
  if (!fixes || !fixes.length || !text) return text;
  let t = text;
  for (const [from, to] of fixes) {
    if (from) t = t.split(from).join(to ?? '');
  }
  return t;
}

/**
 * clips = [{ segments, win }, ...]。型A/型Bは1要素、型C（走馬灯）は複数。
 * 断片ごとに時刻を先頭からの通算へ寄せて1本の字幕トラックにする。
 */
export function buildAss({ assPath, clips, year, season, title, topic, subsOverride, endcardSec, djName, songCard, walkingFlame, fixes, card, cardFont, cardSize, songTailSec, nowPlaying }) {
  const dur = clips.reduce((s, c) => s + c.win.dur, 0);
  const total = dur + endcardSec;
  const seasonJP = SEASON_JP[season] ?? '';
  const cardBuilt = buildCardText(card, cardSize);
  // 書体の存在確認は card があるときだけ（無い旧レンダは HG が無いPCでも通す）
  const cf = cardBuilt ? resolveCardFont(cardFont, cardSize) : { ...CARD_FONTS.noto, fs: 130 };
  // 型D（トーク→曲・2026-08-20）: endcardSec は「トーク後の無音区間 S」全体（呼び出し側=
  // make-short.mjs が job.songTail.seconds を渡す）。見出し札は「最後10秒」の直前まで
  // 表示を続け（＝札L全尺・SHORTS_RECIPE §2-k′）、最後10秒だけエンドカードに入れ替わる。
  // 型D以外（songTailSec 未指定）は従来どおり cardEnd=dur（トーク終了と同時に入れ替わる）。
  const SONGTAIL_ENDCARD_SEC = 10;
  const hasSongTail = songTailSec != null;
  const cardEnd = hasSongTail ? Math.max(dur, total - SONGTAIL_ENDCARD_SEC) : dur;
  const nowPlayingBuilt = hasSongTail ? buildNowPlayingText(nowPlaying) : null;

  let subEvents;
  if (subsOverride) {
    const lines = subsOverride.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const slot = dur / Math.max(1, lines.length);
    subEvents = lines.map((text, i) => ({ start: i * slot, end: (i + 1) * slot, text: assEscape(applyFixes(text, fixes)) }));
  } else {
    subEvents = [];
    let offset = 0;
    for (const c of clips) {
      const fixed = (c.segments ?? []).map((s) => ({ ...s, text: applyFixes(s.text, fixes) }));
      for (const e of segmentsToEvents(fixed, c.win.t0, c.win.t1, c.words, fixes)) {
        subEvents.push({ ...e, start: e.start + offset, end: e.end + offset });
      }
      offset += c.win.dur;
    }
  }

  const styles = [
    // Name,Fontname,Fontsize,Primary,Secondary,Outline,Back,Bold,Italic,U,S,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,ML,MR,MV,Encoding
    // ⚠️ MarginV は 430 → 760（2026-08-17・hide実機スクショから実測）。
    //   YouTubeのショートUI（コメントプレビュー→ハンドル＋登録ボタン→タイトル→関連動画チップ→共有）は
    //   **画面の67%から下を全部覆う**。MarginV 430 では字幕の下端が77.6%＝UIの下に潜り込み、
    //   実際にスクショで2行目がコメントの吹き出しに完全に隠れていた（＝読めない字幕を出していた）。
    //   760 にすると字幕の下端が y=1160（60.4%）に上がり、UIの上端（67%）との間に余白ができる。
    //   ついでに中央の空白が埋まり、「見せたいもの（字幕）」と「押させたいもの（登録・チップ）」が
    //   上下に分離する。
    'Style: Sub,Noto Sans JP,56,&H00FFFFFF,&H000000FF,&H00202020,&H80000000,1,0,0,0,100,100,0,0,1,3.4,2,2,72,72,760,1',
    // ⚠️ MarginV は 64 → 200（2026-07-27・hide実機スクショから実測）。
    // YouTube自身のUI（戻る矢印・「ショート」ラベル・検索・その下のチップ行）が
    // **動画の上端から y=169 までを覆う**ため、64 ではバッジが完全に下敷きになっていた。
    // 実測: 画面900x1898に1080x1920を幅フィット→表示高1600・上余白149・scale 0.833。
    // チップ行の下端 画面y≈290 → 動画y=169。安全側で 200 から始める。
    'Style: Badge,Noto Serif JP,46,&H00B0D9E8,&H00000000,&H00101010,&H00000000,0,0,0,0,100,100,2,0,1,2,1,7,54,54,200,1',
    'Style: Endcard,Noto Serif JP,66,&H00D8ECF5,&H00000000,&H00101010,&H90000000,0,0,0,0,100,100,0,0,1,3,3,5,90,90,0,1',
    // 常時CTA＝**ショートはループする**のに終端エンドカードは一瞬で頭に戻る（hide試写 2026-07-24）。
    // 終端頼みだと宛先の存在に気づけない。動画中ずっと出す常設の宛先。
    // 置き場所: 上部中央（下部はYouTubeのUI＝チャンネル名/タイトル/関連動画リンク/シークバーと重なる）。
    // MarginV は 210 → 300（2026-07-27）。YouTubeのUIが動画 y=169 までを覆うので 210 では
    // チップ行との間合いが41pxしかなく、機種の縦横比によっては噛む。バッジ(y=200から2行)とも
    // 縦をずらして視覚的に分離する（横は バッジ x54-219 / CTA x320-760 で元々重ならない）。
    // 見た目: 半透明の白＋濃い縁取りで、明暗どちらの背景でも沈まず、声の没入も壊さない控えめさ。
    'Style: Cta,Noto Serif JP,40,&H1AF4F4F4,&H00000000,&H80000000,&HA0000000,0,0,0,0,100,100,0,0,1,2.6,1,8,60,60,300,1',
    // 見出し札（2026-08-18・ファイル冒頭のコメント参照）。上段・全尺・極太。書体は CARD_FONTS。
    // 位置: 上端 y=400。上には UI(〜169)→バッジ(200〜)→CTA(300〜340) が積まれ、下は字幕の上端(≈1010)。
    // 2行でも y≈400〜780 に収まり、字幕との間に約230pxの余白が残る。
    // 縁取り＋影 2: 背景写真は本ごとに明るさが違い、Ken Burns で動く。明るい箇所でも生成りが沈まないため。
    `Style: Card,${cf.family},${cf.fs},${CARD_CREAM.slice(0, -1)},&H00000000,&H001A140C,&H90000000,${cf.bold},0,0,0,100,100,0,0,1,${cf.outline},2,8,60,60,400,1`,
    // ナウプレイング札（2026-08-20・型D §2-k′）。下段＝字幕(Sub)と同じゾーン（72,72,760）を再利用。
    // トーク中は Sub が、曲区間（無音）はこちらがこの位置を占める＝時間的に排他なので安全に共用できる
    // （下端760は2026-08-17実測でYouTube UIとの間に余白がある確認済みの安全マージン）。
    // 見出し札と同じ生成り＋琥珀（`*曲名*`）語彙で「同じ番組の一部」と分かる見た目にする。
    'Style: NowPlaying,Noto Serif JP,54,&H00D3EAF3,&H00000000,&H001A140C,&H90000000,1,0,0,0,100,100,0,0,1,3,2,2,72,72,760,1',
  ];

  const events = [];
  // 左上バッジ＝**いつ見ても「何年のどの季節の何の話か」が分かる**ための常設表示。
  // 冒頭3.6秒のタイトルだけだと途中から見た人に何も伝わらない（hide試写 2026-07-22）。
  // 1行目=年と季節（フル表記）／2行目=題材。2行目は控えめにして声の邪魔をしない。
  // ⚠️ Shortsは説明欄・コメントのURLがクリック不能（MARKETING_FUNNEL §3.1）。Reelsのキャプションも同様。
  // つまり**画面にドメインを文字で出すことが、どの面でも唯一その場で渡せる宛先**。
  // 常時CTAとエンドカードの両方で使うので、両者より前に宣言しておく。
  const SITE = 'redial.jp';

  const badge = topic
    ? `${assEscape(`${year}年・${seasonJP}`)}\\N{\\fs30\\c&H0098BCCC&}${assEscape(topic)}`
    : assEscape(`${year}年・${seasonJP}`);
  events.push(`Dialogue: 0,${assTime(0)},${assTime(total)},Badge,,0,0,0,,${badge}`);
  // 常時CTA（トーク中ずっと・エンドカード区間は大きいCTAに譲る）。ループしても常に宛先が画面にある。
  //
  // 宛先の変遷: 「左下のアカウント」→「下の▶」(2026-07-27)→**平文ドメイン**(2026-07-30)。
  // 平文に戻した理由は2つあり、どちらも実測にもとづく:
  //   ① **▶（関連動画リンク）は効いていない**。2,329再生に対し SHORTS_CONTENT_LINKS 経由は
  //      2クリック＝0.09%。bio経由も16訪問中2件。押せる導線を作っても押されていない。
  //   ② **「下の▶」はYouTube専用の文言**で、Instagram Reels に同じ動画を出せない。
  //      横展開の第一候補が Instagram（40〜50代の利用率48.5%・Reelsは非フォロワーに配る）に
  //      決まったため、**どの面でも成立する文言**が必要になった。
  // ▶ の帯自体は関連動画を設定すればYouTube側に自動で出るので、文言で指さなくても導線は残る。
  events.push(`Dialogue: 0,${assTime(0)},${assTime(dur)},Cta,,0,0,0,,♪ フル版（無料）は ${SITE}`);
  for (const e of subEvents) {
    events.push(`Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Sub,,0,0,0,,${e.text}`);
  }
  // エンドカード＝感情の宛先をReDialに書き換える装置（Fable 2026-07-13 マーケ再設計）。
  // 型B（--song）: 曲予告クリフハンガー「♪ ここで『◯◯』が流れます／音楽つきのフル版は、ReDialで。」
  // 型A/C（既定）: 「♪ この続きに、あの頃の曲が流れます／ReDial——あなたの季節に、もう一度。」
  // 曲名が長いと1行に収まらない（Endcard fs66・使用幅900px）→ wrapJaで折る
  // 型C（走馬灯・複数断片）: 年という額縁で閉じ、**問い**で個人化へ渡す（Playbook §8.3）。
  // 「あなたの◯は、何年ですか」＝ 最初のひと回（年×季節を編む）への導火線。
  // 「ReDialで。」だけでは、良いと思った人が行き先を持ち帰れない（hide試写 2026-07-22）ので
  // ドメインを必ず文字で出す。**2026-07-30 にドメインを fs34 → fs48 へ格上げ**した:
  // 以前は「下の▶から」を主動線として fs48 に置き、ドメインは持ち帰り用として fs34 に下げていたが、
  // ▶ 経由は 2,329再生に対し2クリック（0.09%）しか出なかった。押せる導線より、
  // **打てば行けるドメインが読める**ことを優先する。あわせて Instagram Reels でも同じ
  // 動画をそのまま出せるようになる（「下の▶」はYouTube専用の指示だった）。
  // 登録の誘いは残す＝その場で飛ばなかった大多数を次の季節まで手元に置くため
  // （実測: 1,276再生に対し登録者1名＝一度も頼んでいなかった）。
  // 背景は本ごとに明るさが違う（Ken Burnsで動きもする）。小さく薄い字は明るい箇所で沈むので、
  // CTAは白・情緒行に次ぐ大きさを確保する。
  // 2026-08-17 変更: 「登録すると、次の季節も届きます。」→「明日の22時も、どこかの季節を。」
  //   ① Studio「チャンネル登録元」（過去90日）で **登録11人中9人＝81.8%がショートフィード**と判明。
  //      登録が押されるのは動画の隣＝**このエンドカードは登録の主戦場**だった
  //   ② 依頼（登録すると…）より**約束・次回予告**の形にする（YouTubeは依頼自体を許可しているので、
  //      これは規約ではなく世界観の選択。ラジオの締めとして毎晩同じ言い回しにする＝番組に見せる）
  //   ③ 「次の季節も届きます」は通知が前提の約束だが、**登録してもショートはほぼ通知されない**
  //      （公式ヘルプ）＝果たせない約束だった。時刻を言う形なら約束は果たせる
  const CTA = `\\N{\\fs48\\c&H00FFFFFF&}フル版（無料）は ${SITE}\\N{\\fs34\\c&H00D0D0D0&}明日の22時も、どこかの季節を。`;
  // 曲予告の1行目。曲名が長いと「…が流れ／ます」の落ち穂になる（#37『今夜月の見える丘に』で実測・
  // 2026-08-18）ので、1行に収まらないときは「が」で折って「流れます」を2行目に置く（曲名は割らない）。
  const songLine = (song) => {
    const one = `♪ ここで「${assEscape(song)}」が流れます`;
    return dispLen(one) <= 19 ? one : `♪ ここで「${assEscape(song)}」が\\N流れます`;
  };
  // 型D（トーク→曲）: 曲はアプリでこの後乗る（mp4は無音）ので、旧来の
  // 「ここで『◯◯』が流れます」（=これから鳴る、という予告）は時制が合わない
  // （曲区間ではすでに鳴っている想定＝ナウプレイング札が担う）。SHORTS_RECIPE §2-k
  // の指定文言「この続きはredial.jp」の趣旨で、フルエピソードが聴けることを伝える。
  const endcard = hasSongTail
    ? `♪ この続きも、まるごと聴けます${CTA}`
    : songCard
      ? `${songLine(songCard)}${CTA}`
      : walkingFlame
        ? `${wrapJa(`ぜんぶ、${year}年の${seasonJP}です。`, 19)}\\N{\\fs40\\c&H00C8C8C8&}あなたの${seasonJP}は、何年ですか。${CTA}`
        : `♪ この続きに、あの頃の曲が流れます${CTA}`;
  // 見出し札がある弾は、エンドカードを**札と同じ上段（y=400〜）**に出す（2026-08-18）。
  // 札は cardEnd で消えるので、同じ場所に宛先が入れ替わる＝視線を動かさない。画面中央（従来の位置）は
  // 背景の焦点（#36 ではドームの屋根と入口の灯り）と重なって読めなかった（フレーム実測）。
  // 札の無い旧レンダは従来どおり中央。型D（hasSongTail）は cardEnd=total-10（§2-k′「最後10秒」）。
  events.push(cardBuilt
    ? `Dialogue: 0,${assTime(cardEnd)},${assTime(total)},Endcard,,0,0,400,,{\\an8}${endcard}`
    : `Dialogue: 0,${assTime(dur)},${assTime(total)},Endcard,,0,0,0,,${endcard}`);
  if (cardBuilt) {
    // 見出し札（型Dは §2-k′「札L全尺」＝エンドカードに切り替わる直前=cardEndまで表示を継続。
    // 型D以外は cardEnd=dur なので従来どおりトーク終了と同時に切り替わる）。
    // 名乗りは札の下に小さく常設＝「番組名つきのコーナータイトル」として一体で見せる
    // （旧カードでは3.6秒で消えていた。フィードで見える番組表示は名乗りだけ＝2026-08-17）。
    // 名乗りは書体をNotoに戻す（HG明朝Eの小さい字は潰れる）。色は字幕と同じ白＋縁取り3.4:
    // 灰色（B8B0A0）だと明るい面（#36 ドームの屋根）で沈んだ（2026-08-18 フレーム実測）。
    const djLine = djName ? `\\N{\\fnNoto Serif JP\\b0\\fs${cf.dj}\\bord3.4\\shad2\\c&H00F4F4F4&}${assEscape(djName)}` : '';
    events.push(`Dialogue: 0,${assTime(0)},${assTime(cardEnd)},Card,,0,0,0,,${cardBuilt.text}${djLine}`);
  } else if (title) {
    // 冒頭に「何の話か」を平易に提示＋シンヤ名乗りで「これは深夜DJラジオ」という正体を毎回運ぶ。
    const djLine = djName ? `\\N{\\fs32\\c&H00B0B0B0&}${assEscape(djName)}` : '';
    // タイトルは長いと左右に溢れる（YouTube用のSEOタイトルをそのまま画面に出しているため）。
    // fs54は実測で1字=37.2px・使用幅900px（1080-90-90）→ 収まる上限24字。安全側で23。
    const cardText = wrapJa(assEscape(title), 23);
    // 位置 1140 → 1300（2026-08-17）: 字幕を MarginV 760 まで上げたので、
    // 冒頭3.6秒はタイトルカードと字幕が同時に出る。カードも上げて重なりを避ける。
    events.push(`Dialogue: 0,${assTime(0)},${assTime(Math.min(3.6, dur))},Endcard,,0,0,1300,,{\\fs54\\c&H00F0F0F0&}${cardText}${djLine}`);
  }

  // ナウプレイング札（型D・2026-08-20）: トーク終了(dur)〜末尾(total)の無音区間、下段に全区間表示。
  // Sub（字幕）は 0..dur にしか無いので同じゾーンを時間的に排他で共用できる（style定義側コメント参照）。
  if (nowPlayingBuilt) {
    // 「♪」は manifest の songTail.nowPlaying 側で明示する（card と同様、装飾はコード側で自動付与しない）。
    events.push(`Dialogue: 0,${assTime(dur)},${assTime(total)},NowPlaying,,0,0,0,,${nowPlayingBuilt}`);
  }

  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');

  fs.writeFileSync(assPath, ass, 'utf8');
  return { assPath, subCount: subEvents.length, total };
}
