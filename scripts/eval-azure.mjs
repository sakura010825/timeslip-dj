/**
 * Azure AI Speech 評価スクリプト
 *
 * tts-1-hd で苦戦した8フレーズを、Azure 日本語ネイティブ音声で生成する。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/eval-azure.mjs
 *
 * 必要環境変数:
 *   AZURE_SPEECH_KEY
 *   AZURE_SPEECH_REGION   (例: japaneast)
 */

import fs from 'node:fs';
import path from 'node:path';

const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_REGION = process.env.AZURE_SPEECH_REGION;

if (!AZURE_KEY || !AZURE_REGION) {
  console.error('ERROR: AZURE_SPEECH_KEY または AZURE_SPEECH_REGION が未設定です。');
  console.error('  node --env-file=.env.local scripts/eval-azure.mjs で起動してください。');
  process.exit(1);
}

const OUT_ROOT = path.resolve(process.cwd(), '.tts-eval', 'azure');
fs.mkdirSync(OUT_ROOT, { recursive: true });

const PHRASES = [
  { id: 'p1-kan', label: 'アルファベット略語（KAN）', text: '一曲目は、KANの『愛は勝つ』。九月にリリースされたばかりの曲です。' },
  { id: 'p2-jal', label: '略語＋カタカナ（JAL）', text: 'JALの沖縄キャンペーンのCMで流れていた、あの軽やかなギターを。' },
  { id: 'p3-komekome', label: 'アルファベット混在（米米CLUB）', text: '三曲目は、米米CLUBの『浪漫飛行』。年末まで売れ続けた一曲です。' },
  { id: 'p4-utadate', label: '人名漢字（内館牧子・唐沢寿明）', text: '脚本は内館牧子さん。今井美樹さんと唐沢寿明さんが姉妹と男を演じていました。' },
  { id: 'p5-bungaku', label: '文学的・難読漢字', text: '十月の夜は、夏の名残を引きずった風でも、十一月の冬の予兆でもない。' },
  { id: 'p6-ghost', label: 'カタカナ固有名詞', text: '九月の終わりに、ある映画が日本の映画館にやってきました。『ゴースト・ニューヨークの幻』。' },
  { id: 'p7-senna', label: '外国人名＋F1', text: '十月二十一日、F1日本グランプリ。スタート直後の第一コーナーで、アイルトン・セナがアラン・プロストに激突した。' },
  { id: 'p8-shinya-opening', label: 'シンヤらしさ（オープニング）', text: '……こんばんは。シンヤです。今夜は1990年の秋を、少しだけ歩いてみようと思います。' },
];

const VOICES = [
  { name: 'keita', voiceName: 'ja-JP-KeitaNeural', note: '40代男性・温かみ' },
  { name: 'daichi', voiceName: 'ja-JP-DaichiNeural', note: '30代男性・プロフェッショナル' },
  { name: 'naoki', voiceName: 'ja-JP-NaokiNeural', note: '若め男性（対照群）' },
  { name: 'masaru', voiceName: 'ja-JP-MasaruMultilingualNeural', note: '40代男性・多言語対応' },
];

const ENDPOINT = `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
const OUTPUT_FORMAT = 'audio-24khz-160kbitrate-mono-mp3';

function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSSML(voiceName, text) {
  return `<speak version='1.0' xml:lang='ja-JP'>
  <voice name='${voiceName}'>${escapeXml(text)}</voice>
</speak>`;
}

async function generateTTS(text, voiceName) {
  const ssml = buildSSML(voiceName, text);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': AZURE_KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
      'User-Agent': 'redial-tts-eval',
    },
    body: ssml,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Azure TTS ${res.status}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

console.log(`# Azure TTS 評価実行`);
console.log(`region: ${AZURE_REGION}`);
console.log(`phrase × voice: ${PHRASES.length} × ${VOICES.length} = ${PHRASES.length * VOICES.length}\n`);

const results = [];
let totalMs = 0;
for (const voice of VOICES) {
  const voiceDir = path.join(OUT_ROOT, voice.name);
  fs.mkdirSync(voiceDir, { recursive: true });
  console.log(`\n## ${voice.name} (${voice.voiceName}) — ${voice.note}`);
  for (const phrase of PHRASES) {
    const outPath = path.join(voiceDir, `${phrase.id}.mp3`);
    if (fs.existsSync(outPath)) {
      results.push({ voice: voice.name, phrase: phrase.id, status: 'skipped' });
      continue;
    }
    const t0 = Date.now();
    try {
      const mp3 = await generateTTS(phrase.text, voice.voiceName);
      fs.writeFileSync(outPath, mp3);
      const ms = Date.now() - t0;
      totalMs += ms;
      console.log(`  [${phrase.id}] ${mp3.length} bytes (${ms}ms)`);
      results.push({ voice: voice.name, phrase: phrase.id, status: 'ok', bytes: mp3.length, ms });
    } catch (e) {
      console.error(`  [${phrase.id}] FAIL: ${e.message}`);
      results.push({ voice: voice.name, phrase: phrase.id, status: 'fail', error: e.message });
    }
  }
}

// HTML index
const htmlPath = path.resolve(process.cwd(), '.tts-eval', 'index-azure.html');
const html = buildIndexHtml(PHRASES, VOICES, results);
fs.writeFileSync(htmlPath, html, 'utf8');

console.log(`\n=== 完了 ===`);
console.log(`合計時間: ${(totalMs / 1000).toFixed(1)}s`);
console.log(`MP3: ${OUT_ROOT}`);
console.log(`HTML: ${htmlPath}`);

function buildIndexHtml(phrases, voices, results) {
  const rows = phrases
    .map((p) => {
      const cells = voices
        .map((v) => {
          const result = results.find((r) => r.voice === v.name && r.phrase === p.id);
          const ok = result?.status === 'ok' || result?.status === 'skipped';
          if (!ok) return `<td class="fail">— ${result?.error?.slice(0, 60) ?? 'no audio'} —</td>`;
          const src = `azure/${v.name}/${p.id}.mp3`;
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
    .map((v) => `<th>${v.name}<br><small>${v.voiceName}<br>${v.note}</small></th>`)
    .join('');

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Azure AI Speech 比較</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 20px; background: #f7f7f8; color: #222; }
  table { border-collapse: collapse; width: 100%; background: white; }
  th, td { border: 1px solid #ddd; padding: 10px; vertical-align: top; text-align: left; }
  thead th { background: #2d3748; color: white; text-align: center; font-size: 13px; }
  thead th small { font-weight: normal; opacity: 0.75; font-size: 11px; }
  .phrase { background: #fafafa; max-width: 360px; }
  .phrase-id { font-family: monospace; font-size: 11px; color: #888; }
  .phrase-label { font-weight: bold; margin: 4px 0; font-size: 13px; color: #2d3748; }
  .phrase-text { font-size: 14px; line-height: 1.5; color: #444; }
  audio { width: 100%; }
  .fail { color: #c00; font-size: 12px; }
  .note { padding: 12px; background: #fffbe6; border-left: 4px solid #f0c674; margin-bottom: 16px; }
</style></head><body>
<h1>Azure AI Speech 比較試聴</h1>
<div class="note">
  日本語ネイティブの Neural voice ${voices.length}種類。シンヤ（40代男性・深夜DJ）に最も近いものを選んでください。<br>
  <strong>判定軸:</strong> (1)発音精度（誤読なし）／(2)シンヤらしさ／(3)安定性／(4)tts-1-hd と比べての改善感
</div>
<table><thead><tr>
  <th class="phrase">フレーズ</th>
  ${headerCells}
</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}
