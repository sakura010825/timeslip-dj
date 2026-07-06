/**
 * gpt-4o-mini-tts スナップショット比較（2025-03-20 → 2025-12-15 移行判定用）
 *
 * 背景（2026-07-06）:
 *   - 旧スナップショット gpt-4o-mini-tts-2025-03-20（シンヤの現行声）は 2026-07-23 に廃止
 *   - 素の slug `gpt-4o-mini-tts` は新スナップショット 2025-12-15 へ向け替え済み
 *   - 新版は instructions を無視して棒読みになるという報告あり（要実測）
 *
 * 出力: .tts-snapshot-test/{name}.mp3 を hide さんが試聴して移行可否を判定する。
 *   - 新版が許容 → TTS_MODEL を 2025-12-15 に更新して終了
 *   - 新版が不可 → 代替プロバイダ再評価（voice-bake-off 系の再走）
 *
 * 使い方:
 *   node --env-file=.env.local scripts/compare-tts-snapshots.mjs
 */

import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';

const client = new OpenAI();

// test-tts-variants.mjs と同一パッセージ（過去の試聴比較と条件を揃える）
const SAMPLE_TEXT = `こんばんは。シンヤです。

1990年の冬。
その言葉を口にするだけで、何かが胸の内側を、そっと通り過ぎていく気がします。

日経平均が、前のとしの大晦日に38915円の最高値をつけていた。
そこから1年で、四割近く崩れた。
でも街の表情は、まだそれを知らないふりをしていた。
デパートのショーウィンドウは光っていて、タクシーはなかなか捕まらなくて、年末のボーナス明けの財布は、まだ少し重かった。

今夜は、そのあたりまで、少し戻ってみようと思います。

シートベルトを、どうぞ。`;

// 現行のシンヤ instructions（.env.local TTS_INSTRUCTIONS と同一）
const SHINYA_INSTRUCTIONS =
  'Voice: Middle-aged Japanese male radio DJ, late-night jazz / city-pop station. Tone: Deep mellow voice, intelligent and reserved, warm and contemplative. Pacing: Slow and deliberate, with thoughtful pauses between sentences. Never rushed. Mood: Slight melancholic undertone, like a knowledgeable friend reminiscing about the past. Calm and grounding. Style: Speaks softly but clearly. Treats the listener as an intimate companion in the dark. The content is in Japanese.';

// 新版で instructions が弱く効く場合に備えた強調版（命令形・箇条書き・冗長化）
const SHINYA_INSTRUCTIONS_STRONG = [
  'You MUST follow these speaking instructions strictly.',
  'Speak as a middle-aged Japanese male radio DJ hosting a late-night jazz program.',
  'Use a deep, mellow, warm voice. Never bright, never energetic.',
  'Speak SLOWLY with long thoughtful pauses between sentences. Never rush.',
  'Keep a slight melancholic, nostalgic undertone throughout, like reminiscing about the past with a close friend at 1 AM.',
  'Soft but clear articulation. Intimate, close-microphone late-night radio delivery.',
  'The content is in Japanese.',
].join(' ');

const CASES = [
  {
    name: 's1_2025-03-20_current',
    label: 'S1 - 旧版 2025-03-20 × 現行instructions（現状の声・7/23廃止）',
    model: 'gpt-4o-mini-tts-2025-03-20',
    instructions: SHINYA_INSTRUCTIONS,
  },
  {
    name: 's2_2025-12-15_same-inst',
    label: 'S2 - 新版 2025-12-15 × 現行instructions（移行そのまま案）',
    model: 'gpt-4o-mini-tts-2025-12-15',
    instructions: SHINYA_INSTRUCTIONS,
  },
  {
    name: 's3_2025-12-15_strong-inst',
    label: 'S3 - 新版 2025-12-15 × 強調instructions（緩和チューニング案）',
    model: 'gpt-4o-mini-tts-2025-12-15',
    instructions: SHINYA_INSTRUCTIONS_STRONG,
  },
];

const OUT_DIR = path.resolve('.tts-snapshot-test');

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`[compare-tts-snapshots] generating ${CASES.length} cases...`);
  console.log(`Output: ${OUT_DIR}`);
  console.log('');

  for (const c of CASES) {
    const t0 = Date.now();
    try {
      const mp3 = await client.audio.speech.create({
        model: c.model,
        voice: 'onyx',
        input: SAMPLE_TEXT,
        instructions: c.instructions,
      });
      const buf = Buffer.from(await mp3.arrayBuffer());
      const outPath = path.join(OUT_DIR, c.name + '.mp3');
      await fs.writeFile(outPath, buf);
      const ms = Date.now() - t0;
      console.log(`✓ ${c.label}`);
      console.log(`  → ${outPath} (${(buf.length / 1024).toFixed(1)}KB, ${ms}ms)`);
    } catch (e) {
      console.error(`✗ ${c.label}: ${e.message}`);
    }
  }

  console.log('');
  console.log('試聴して判定してください:');
  CASES.forEach((c) => console.log('  -', c.label));
  console.log('');
  console.log('判定の分岐:');
  console.log('  S2 or S3 が許容 → .env.local の TTS_MODEL を gpt-4o-mini-tts-2025-12-15 へ（S3採用なら TTS_INSTRUCTIONS も差し替え）');
  console.log('  どちらも不可   → 代替プロバイダ再評価（比較対象が棒読み新版になるため前回の判定は無効）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
