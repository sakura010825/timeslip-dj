/**
 * ElevenLabs TTS 評価スクリプト
 *
 * tts-1-hd で苦戦したフレーズ群を、ElevenLabs の複数ボイスで生成し、
 * .tts-eval/elevenlabs/<voice-name>/<phrase-id>.mp3 に保存する。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/eval-elevenlabs.mjs
 *
 * 必要環境変数:
 *   ELEVENLABS_API_KEY
 */

import fs from 'node:fs';
import path from 'node:path';

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error('ERROR: ELEVENLABS_API_KEY が未設定です。');
  console.error('  node --env-file=.env.local scripts/eval-elevenlabs.mjs で起動してください。');
  process.exit(1);
}

const OUT_ROOT = path.resolve(process.cwd(), '.tts-eval', 'elevenlabs');
fs.mkdirSync(OUT_ROOT, { recursive: true });

/**
 * テストフレーズ — tts-1-hd の編集ログから抽出した「TTSが苦戦するパターン」
 */
const PHRASES = [
  {
    id: 'p1-kan',
    label: 'アルファベット略語の固有名詞（KAN）',
    text: '一曲目は、KANの『愛は勝つ』。九月にリリースされたばかりの曲です。',
  },
  {
    id: 'p2-jal',
    label: '略語＋カタカナ（JAL）',
    text: 'JALの沖縄キャンペーンのCMで流れていた、あの軽やかなギターを。',
  },
  {
    id: 'p3-komekome',
    label: 'アルファベット混在カタカナ（米米CLUB）',
    text: '三曲目は、米米CLUBの『浪漫飛行』。年末まで売れ続けた一曲です。',
  },
  {
    id: 'p4-utadate',
    label: '人名の漢字読み（内館牧子・唐沢寿明）',
    text: '脚本は内館牧子さん。今井美樹さんと唐沢寿明さんが姉妹と男を演じていました。',
  },
  {
    id: 'p5-bungaku',
    label: '文学的・難読漢字（名残・予兆）',
    text: '十月の夜は、夏の名残を引きずった風でも、十一月の冬の予兆でもない。',
  },
  {
    id: 'p6-ghost',
    label: 'カタカナ固有名詞（ゴースト・ニューヨーク）',
    text: '九月の終わりに、ある映画が日本の映画館にやってきました。『ゴースト・ニューヨークの幻』。',
  },
  {
    id: 'p7-senna',
    label: '外国人名（アイルトン・セナ）＋F1',
    text: '十月二十一日、F1日本グランプリ。スタート直後の第一コーナーで、アイルトン・セナがアラン・プロストに激突した。',
  },
  {
    id: 'p8-shinya-opening',
    label: 'シンヤらしさ（オープニング定型）',
    text: '……こんばんは。シンヤです。今夜は1990年の秋を、少しだけ歩いてみようと思います。',
  },
];

/**
 * 候補ボイス — シンヤ（40代男性・深夜DJトーン）に近そうなものを選定
 * voice_id は ElevenLabs のデフォルト音声から
 */
const VOICES = [
  // 落ち着いた深い男性声（multilingual v2 対応）
  { name: 'adam', voiceId: 'pNInz6obpgDQGcFmaJgB', note: 'mature deep American' },
  { name: 'brian', voiceId: 'nPczCjzI2devNBz1zQrb', note: 'deep calm' },
  { name: 'bill', voiceId: 'pqHfZKP75CvOlQylNhV4', note: 'deep mature narrator' },
  { name: 'daniel', voiceId: 'onwK4e9ZLuTAKqWW03F9', note: 'British authoritative' },
];

const MODEL_ID = 'eleven_multilingual_v2'; // 日本語対応最高品質

/** ElevenLabs TTS API を呼ぶ */
async function generateTTS(text, voiceId) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs API ${res.status}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

console.log(
  `# ElevenLabs 評価実行\n` +
    `モデル: ${MODEL_ID}\n` +
    `フレーズ数: ${PHRASES.length}\n` +
    `ボイス数: ${VOICES.length}\n` +
    `合計呼び出し: ${PHRASES.length * VOICES.length}\n` +
    `推定文字数: ${PHRASES.reduce((s, p) => s + p.text.length, 0) * VOICES.length}\n`,
);

const results = [];
let totalMs = 0;
for (const voice of VOICES) {
  const voiceDir = path.join(OUT_ROOT, voice.name);
  fs.mkdirSync(voiceDir, { recursive: true });
  console.log(`\n## ${voice.name} (${voice.note})`);

  for (const phrase of PHRASES) {
    const outPath = path.join(voiceDir, `${phrase.id}.mp3`);
    if (fs.existsSync(outPath)) {
      console.log(`  [skip] ${phrase.id} (already generated)`);
      results.push({ voice: voice.name, phrase: phrase.id, status: 'skipped' });
      continue;
    }
    const t0 = Date.now();
    try {
      const mp3 = await generateTTS(phrase.text, voice.voiceId);
      fs.writeFileSync(outPath, mp3);
      const ms = Date.now() - t0;
      totalMs += ms;
      console.log(`  [${phrase.id}] ${mp3.length} bytes (${ms}ms) — "${phrase.text.slice(0, 30)}..."`);
      results.push({ voice: voice.name, phrase: phrase.id, status: 'ok', bytes: mp3.length, ms });
    } catch (e) {
      console.error(`  [${phrase.id}] FAIL: ${e.message}`);
      results.push({ voice: voice.name, phrase: phrase.id, status: 'fail', error: e.message });
    }
  }
}

// HTML インデックスを生成
const htmlPath = path.join(path.dirname(OUT_ROOT), 'index.html');
const html = buildIndexHtml(PHRASES, VOICES, results);
fs.writeFileSync(htmlPath, html, 'utf8');

console.log(`\n=== 完了 ===`);
console.log(`合計時間: ${(totalMs / 1000).toFixed(1)}s`);
console.log(`MP3 出力先: ${OUT_ROOT}`);
console.log(`\n試聴用HTML: ${htmlPath}`);
console.log(`  → ブラウザで開いて聴き比べてください`);

function buildIndexHtml(phrases, voices, results) {
  const rows = phrases
    .map((p) => {
      const cells = voices
        .map((v) => {
          const result = results.find((r) => r.voice === v.name && r.phrase === p.id);
          const ok = result?.status === 'ok' || result?.status === 'skipped';
          if (!ok) {
            return `<td class="fail">— ${result?.error?.slice(0, 60) ?? 'no audio'} —</td>`;
          }
          const src = `elevenlabs/${v.name}/${p.id}.mp3`;
          return `<td><audio controls preload="none" src="${src}"></audio></td>`;
        })
        .join('');
      return `<tr>
  <th class="phrase">
    <div class="phrase-id">${p.id}</div>
    <div class="phrase-label">${p.label}</div>
    <div class="phrase-text">${p.text}</div>
  </th>
  ${cells}
</tr>`;
    })
    .join('\n');

  const headerCells = voices
    .map((v) => `<th>${v.name}<br><small>${v.note}</small></th>`)
    .join('');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>ElevenLabs TTS 比較試聴</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 20px; background: #f7f7f8; color: #222; }
  h1 { margin-top: 0; }
  table { border-collapse: collapse; width: 100%; background: white; }
  th, td { border: 1px solid #ddd; padding: 10px; vertical-align: top; text-align: left; }
  thead th { background: #2d3748; color: white; text-align: center; }
  thead th small { font-weight: normal; opacity: 0.7; }
  .phrase { background: #fafafa; max-width: 360px; }
  .phrase-id { font-family: monospace; font-size: 11px; color: #888; }
  .phrase-label { font-weight: bold; margin: 4px 0; font-size: 13px; color: #2d3748; }
  .phrase-text { font-size: 14px; line-height: 1.5; color: #444; }
  audio { width: 100%; }
  .fail { color: #c00; font-size: 12px; }
  .summary { margin-bottom: 20px; padding: 12px; background: white; border-radius: 6px; }
  .ref { margin-top: 30px; padding: 12px; background: #fffbe6; border-left: 4px solid #f0c674; }
</style>
</head>
<body>
<h1>ElevenLabs TTS 比較試聴（vs tts-1-hd 苦戦パターン）</h1>
<div class="summary">
  <strong>モデル:</strong> ${MODEL_ID}<br>
  <strong>判定軸:</strong> (1) 発音精度（誤読・英語化なし）／(2) シンヤらしさ（深夜DJ・40代男性のロートーン）／(3) 安定性（不自然な抑揚なし）
</div>

<table>
<thead>
<tr>
  <th class="phrase">フレーズ</th>
  ${headerCells}
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>

<div class="ref">
  <strong>比較方法:</strong> 各ボイスを上から順に聴き比べ、シンヤキャラに最も近い／違和感のないものを選んでください。
  特に <code>p1-kan</code> (KAN), <code>p3-komekome</code> (米米CLUB), <code>p4-utadate</code> (内館牧子・唐沢寿明) など、
  tts-1-hd で破綻していたパターンに注目。
</div>
</body>
</html>`;
}
