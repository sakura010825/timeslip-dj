/**
 * ElevenLabs 日本語ネイティブ音声の評価。
 *
 * Community Voice Library から日本語ネイティブ男性音声を検索 →
 * シンヤ向け候補を選定 → 同じ7+1フレーズで生成。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/eval-elevenlabs-ja.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error('ERROR: ELEVENLABS_API_KEY が未設定です。');
  process.exit(1);
}

const OUT_ROOT = path.resolve(process.cwd(), '.tts-eval', 'elevenlabs-ja');
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

const MODEL_ID = 'eleven_multilingual_v2';

// Step 1: Japanese 男性音声を検索
console.log('# Step 1: Japanese male voices を検索');
const searchUrl =
  'https://api.elevenlabs.io/v1/shared-voices?language=ja&gender=male&page_size=30';
const searchRes = await fetch(searchUrl, {
  headers: { 'xi-api-key': API_KEY },
});
if (!searchRes.ok) {
  console.error(`shared-voices API ${searchRes.status}: ${await searchRes.text()}`);
  process.exit(1);
}
const searchData = await searchRes.json();
const candidates = searchData.voices ?? [];
console.log(`  ヒット: ${candidates.length} 件`);

// シンヤ向けに「mature / middle-aged / calm」っぽい候補を上位選出
function scoreVoice(v) {
  let s = 0;
  const desc = JSON.stringify(v).toLowerCase();
  if (/middle|mature|old/.test(v.age ?? '')) s += 3;
  if (/young/.test(v.age ?? '')) s -= 2;
  if (/calm|warm|deep|narration|story/.test(desc)) s += 2;
  if (/young|cute|kawaii|anime/.test(desc)) s -= 3;
  // use_count が多い voice は試聴で安全
  s += Math.log10((v.cloned_by_count ?? 0) + 1);
  s += Math.log10((v.usage_character_count_1y ?? 0) + 1);
  return s;
}

candidates.sort((a, b) => scoreVoice(b) - scoreVoice(a));
const TOP_N = 4;
const picked = candidates.slice(0, TOP_N);

console.log('\n選定した候補（上位 ' + TOP_N + ' 件）:');
picked.forEach((v, i) => {
  console.log(`  ${i + 1}. ${v.name} (id=${v.voice_id})`);
  console.log(`     age=${v.age ?? '?'} accent=${v.accent ?? '?'} cloned=${v.cloned_by_count ?? 0} usage=${v.usage_character_count_1y ?? 0}`);
  console.log(`     description: ${(v.description ?? '').slice(0, 120)}`);
});

// Step 2: 各音声で生成
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
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TTS ${res.status}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

console.log('\n# Step 2: 各音声で 8 フレーズ生成');
const results = [];
for (const voice of picked) {
  const safeName = voice.name.replace(/[^a-zA-Z0-9_-]+/g, '_').toLowerCase();
  const voiceDir = path.join(OUT_ROOT, safeName);
  fs.mkdirSync(voiceDir, { recursive: true });
  console.log(`\n## ${voice.name}`);

  for (const phrase of PHRASES) {
    const outPath = path.join(voiceDir, `${phrase.id}.mp3`);
    if (fs.existsSync(outPath)) {
      results.push({ voice: safeName, phrase: phrase.id, status: 'skipped' });
      continue;
    }
    try {
      const t0 = Date.now();
      const mp3 = await generateTTS(phrase.text, voice.voice_id);
      fs.writeFileSync(outPath, mp3);
      const ms = Date.now() - t0;
      console.log(`  [${phrase.id}] ${mp3.length} bytes (${ms}ms)`);
      results.push({ voice: safeName, phrase: phrase.id, status: 'ok', bytes: mp3.length, ms });
    } catch (e) {
      console.error(`  [${phrase.id}] FAIL: ${e.message}`);
      results.push({ voice: safeName, phrase: phrase.id, status: 'fail', error: e.message });
    }
  }
}

// Step 3: HTML 生成
const htmlPath = path.resolve(process.cwd(), '.tts-eval', 'index-ja.html');
const html = buildIndexHtml(PHRASES, picked, results);
fs.writeFileSync(htmlPath, html, 'utf8');

console.log('\n=== 完了 ===');
console.log(`HTML: ${htmlPath}`);
console.log(`MP3: ${OUT_ROOT}/<voice>/`);

function buildIndexHtml(phrases, voices, results) {
  const safeNames = voices.map((v) => v.name.replace(/[^a-zA-Z0-9_-]+/g, '_').toLowerCase());
  const rows = phrases
    .map((p) => {
      const cells = voices
        .map((v, i) => {
          const safeName = safeNames[i];
          const result = results.find((r) => r.voice === safeName && r.phrase === p.id);
          const ok = result?.status === 'ok' || result?.status === 'skipped';
          if (!ok) return `<td class="fail">— ${result?.error?.slice(0, 60) ?? 'no audio'} —</td>`;
          const src = `elevenlabs-ja/${safeName}/${p.id}.mp3`;
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
    .map(
      (v) =>
        `<th>${v.name}<br><small>age=${v.age ?? '?'}<br>accent=${v.accent ?? '?'}<br>cloned=${v.cloned_by_count ?? 0}</small></th>`,
    )
    .join('');

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>ElevenLabs 日本語ネイティブ音声 比較</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 20px; background: #f7f7f8; color: #222; }
  table { border-collapse: collapse; width: 100%; background: white; }
  th, td { border: 1px solid #ddd; padding: 10px; vertical-align: top; text-align: left; }
  thead th { background: #2d3748; color: white; text-align: center; font-size: 13px; }
  .phrase { background: #fafafa; max-width: 360px; }
  .phrase-id { font-family: monospace; font-size: 11px; color: #888; }
  .phrase-label { font-weight: bold; margin: 4px 0; font-size: 13px; color: #2d3748; }
  .phrase-text { font-size: 14px; line-height: 1.5; color: #444; }
  audio { width: 100%; }
  .fail { color: #c00; font-size: 12px; }
  .note { padding: 12px; background: #fffbe6; border-left: 4px solid #f0c674; margin-bottom: 16px; }
</style></head><body>
<h1>ElevenLabs 日本語ネイティブ音声 比較</h1>
<div class="note">
  Community Voice Library から <code>language=ja&gender=male</code> で検索した上位${voices.length}件。
  前回（英語ネイティブ音声）と聴き比べてください。
</div>
<table><thead><tr>
  <th class="phrase">フレーズ</th>
  ${headerCells}
</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}
