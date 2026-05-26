/**
 * gpt-4o-mini-tts のVoice × Instructions 5パターン比較生成
 *
 * 出力: .tts-variant-test/v{N}_{voice}_{label}.mp3
 *
 * 使い方:
 *   node scripts/test-tts-variants.mjs
 */

// .env.local は node --env-file=.env.local で読み込む
import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';

const client = new OpenAI();

// 1990冬のオープニング冒頭から、シンヤのキャラ感が出るパッセージを抜粋
const SAMPLE_TEXT = `こんばんは。シンヤです。

1990年の冬。
その言葉を口にするだけで、何かが胸の内側を、そっと通り過ぎていく気がします。

日経平均が、前のとしの大晦日に38915円の最高値をつけていた。
そこから1年で、四割近く崩れた。
でも街の表情は、まだそれを知らないふりをしていた。
デパートのショーウィンドウは光っていて、タクシーはなかなか捕まらなくて、年末のボーナス明けの財布は、まだ少し重かった。

今夜は、そのあたりまで、少し戻ってみようと思います。

シートベルトを、どうぞ。`;

const VARIANTS = [
  {
    name: 'v1_onyx_jazz-dj',
    label: 'V1 - onyx × 深夜JAZZ DJ（現状）',
    voice: 'onyx',
    instructions:
      'Voice: Middle-aged Japanese male radio DJ, late-night jazz / city-pop station. Tone: Deep mellow voice, intelligent and reserved, warm and contemplative. Pacing: Slow and deliberate, with thoughtful pauses between sentences. Never rushed. Mood: Slight melancholic undertone, like a knowledgeable friend reminiscing about the past. Calm and grounding. Style: Speaks softly but clearly. Treats the listener as an intimate companion in the dark. The content is in Japanese.',
  },
  {
    name: 'v2_echo_jazz-dj-deep',
    label: 'V2 - echo × 深夜JAZZ DJ・低音強調',
    voice: 'echo',
    instructions:
      'Voice: Late-night Japanese radio DJ, mid-40s male. Tone: Very deep, resonant, smoky baritone. Slightly weary but warm, like someone who has lived through many seasons. Pacing: Unhurried. Generous pauses. Words placed carefully, never spilled. Mood: Gentle melancholy, the kind of voice that makes the listener exhale. Style: Intimate radio booth at 1 AM. The microphone is close, the listener is close. The content is in Japanese.',
  },
  {
    name: 'v3_sage_music-critic',
    label: 'V3 - sage × 元音楽評論家',
    voice: 'sage',
    instructions:
      'Voice: Former music critic and record shop owner in his 40s, now hosting a quiet late-night Japanese radio show. Tone: Intellectual, analytical, slightly detached but never cold. Knows everything but understates everything. Pacing: Thoughtful. Pauses after key references, as if savoring the memory. Mood: Quietly contemplative, occasionally a hint of dry humor. Style: Speaks as if quoting a passage from a book he wrote, then suddenly turns warm. The content is in Japanese.',
  },
  {
    name: 'v4_onyx_bar-master',
    label: 'V4 - onyx × 老舗バーのマスター',
    voice: 'onyx',
    instructions:
      'Voice: 60-something Japanese male bartender at a legendary jazz bar in Ginza, decades of stories in his throat. Tone: Lower than middle, gravelly but not rough. Has seen everything, tells nothing unless asked. Pacing: Very slow. Each phrase comes after a small breath. Mood: Wistful, occasionally amused, never sentimental. Style: Like leaning on the bar counter at 2 AM, listening rather than telling, but when he speaks every word lands. The content is in Japanese.',
  },
  {
    name: 'v5_ash_nhk-fm',
    label: 'V5 - ash × NHK FM 深夜便ホスト',
    voice: 'ash',
    instructions:
      'Voice: Gentle Japanese male announcer in his late 40s, hosting the NHK FM Radio Late-Night Service. Tone: Refined, polite, calm. Slight melodic quality to each phrase ending. Pacing: Slow and clear. Designed to lull a sleepless listener at 3 AM into either reflection or sleep. Mood: Comforting, attentive, never imposing. Style: Like a public broadcaster who has chosen to be quiet rather than commanding. Every sentence ends with care. The content is in Japanese.',
  },
];

const OUT_DIR = path.resolve('.tts-variant-test');

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`[test-tts-variants] generating ${VARIANTS.length} variants...`);
  console.log(`Output: ${OUT_DIR}`);
  console.log('Sample text:', SAMPLE_TEXT.slice(0, 80) + '...');
  console.log('');

  for (const v of VARIANTS) {
    const t0 = Date.now();
    try {
      const mp3 = await client.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: v.voice,
        input: SAMPLE_TEXT,
        instructions: v.instructions,
      });
      const buf = Buffer.from(await mp3.arrayBuffer());
      const outPath = path.join(OUT_DIR, v.name + '.mp3');
      await fs.writeFile(outPath, buf);
      const ms = Date.now() - t0;
      console.log(`✓ ${v.label}`);
      console.log(`  → ${outPath} (${(buf.length / 1024).toFixed(1)}KB, ${ms}ms)`);
    } catch (e) {
      console.error(`✗ ${v.label}: ${e.message}`);
    }
  }

  console.log('');
  console.log('All variants generated. Open the folder and listen:');
  console.log(`  ${OUT_DIR}`);
  console.log('');
  console.log('Variants:');
  VARIANTS.forEach((v) => console.log('  -', v.label));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
