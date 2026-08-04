/**
 * 出力メタ（output/shorts/*.json）を mp4 を焼き直さずに作り直す（2026-07-30）。
 *
 * なぜ必要か:
 *   post-meta.mjs の冒頭に「**mp4 を焼き直さずに作り直せる**ように writeMeta から
 *   切り出してある」と書いてありながら、**実際にそれをやる道具が無かった**。
 *   タイトル・説明文・ハッシュタグ・UTM は動画のピクセルに焼き込まれていないので、
 *   変えても再レンダは不要。にもかかわらず「マニフェストを直した → 全16本を焼き直す」を
 *   やっていた（1本1分 × 16本）。
 *
 *   ⚠️ ただし**タイトルは焼き込まれている**（冒頭のタイトルカード）。
 *      タイトルを変えたときは make-short.mjs での焼き直しが必要。
 *      このスクリプトが作り直すのは **description / hashtags / utm / topicTags** だけ。
 *
 * usage:
 *   node scripts/shorts/refresh-meta.mjs            # 反映
 *   node scripts/shorts/refresh-meta.mjs --dry-run  # 差分だけ表示
 *
 * 反映後は make-shorts-upload-kit.mjs を再実行してキットに載せる。
 */
import fs from 'node:fs';
import path from 'node:path';
import { readJson, OUT_ROOT } from './util.mjs';
import { buildDescription, hashtagsFor } from './post-meta.mjs';

const DRY = process.argv.includes('--dry-run');
const manifest = readJson(path.resolve('data', 'shorts.manifest.json'));
const byId = new Map((manifest.shorts ?? []).map((s) => [s.id, s]));

const files = fs.readdirSync(OUT_ROOT).filter((f) => f.endsWith('.json')).sort();
let changed = 0;
let skipped = 0;

for (const f of files) {
  const p = path.join(OUT_ROOT, f);
  const j = readJson(p);
  const s = byId.get(j.id);
  if (!s) { skipped.toString(); skipped++; console.log(` -  ${f}（マニフェストに id=${j.id} が無い）`); continue; }

  const utm = s.utm ?? j.utm ?? { source: 'youtube', medium: 'short' };
  const next = {
    ...j,
    utm,
    topicTags: s.tags ?? null,
    hashtags: hashtagsFor(s.cell, s.tags),
    campaign: s.campaign ?? null,
    description: buildDescription({
      cell: s.cell, title: s.title ?? j.title, utm,
      song: s.song ?? null, walkingFlame: !!s.walkingFlame, tags: s.tags,
      campaign: s.campaign,
    }),
  };

  const before = JSON.stringify(j);
  const after = JSON.stringify(next);
  if (before === after) continue;
  changed++;
  console.log(`✎ #${j.id} ${j.hook}`);
  if (JSON.stringify(j.hashtags) !== JSON.stringify(next.hashtags)) {
    console.log(`     タグ: ${(j.hashtags ?? []).map((t) => '#' + t).join(' ')}`);
    console.log(`       →   ${next.hashtags.map((t) => '#' + t).join(' ')}`);
  }
  // ⚠️ タイトルは焼き込まれているので、ここで差分が出たら再レンダが必要
  if ((s.title ?? '') !== (j.title ?? '')) {
    console.log(`  🔴 タイトルがマニフェストと違います。**mp4に焼き込まれているので make-short.mjs で焼き直しが必要**`);
    console.log(`     mp4内: ${j.title}`);
    console.log(`     正   : ${s.title}`);
  }
  if (!DRY) fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
}

console.log(`\n${DRY ? '[DRY-RUN] ' : ''}メタ更新 ${changed}件${skipped ? ` / 対象外 ${skipped}件` : ''}`);
if (changed && !DRY) console.log('次: node scripts/make-shorts-upload-kit.mjs');
