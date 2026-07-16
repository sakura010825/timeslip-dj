/**
 * 長尺アンカーの「アップロード・キット」生成（2026-07-15）。
 *
 * なぜ必要か:
 *   make-anchor.mjs は mp4 と .json（タイトル/概要欄/チャプター/曲リスト）を吐くが、
 *   hideさんは JSON を読んでコピペする人ではない。**YouTube Studio の入力欄の順に並んだ
 *   1枚のテキスト**にして、上から順に貼れる状態にする。
 *
 * 出力: output/anchors/UPLOAD_KIT.md（.gitignore 配下）
 *
 * usage:
 *   node scripts/make-upload-kit.mjs [--manifest data/anchors.manifest.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readJson, OUT_ROOT } from './shorts/util.mjs';

const args = parseArgs(process.argv.slice(2));
const ANCHOR_OUT = path.resolve(OUT_ROOT, '..', 'anchors');
const manifestPath = String(args.manifest ?? 'data/anchors.manifest.json');

const m = readJson(manifestPath);
const anchors = (m.anchors ?? []).filter((a) => a.slug);

const blocks = [];
blocks.push(`# 長尺アンカー アップロード・キット

**自動生成: \`node scripts/make-upload-kit.mjs\`（元データ = ${manifestPath} ＋ 各 .json）**
YouTube Studio の入力欄の順に並べてあります。上から順にコピペしてください。

---

## ⚠️ 先にやること: 電話番号の確認（5分・これが無いと詰みます）

**新規チャンネルは電話番号を確認するまで、次の2つが使えません:**
- **15分を超える動画のアップロード** → 合本（35:13）が上げられない
- **カスタムサムネイル** → 用意した \`-thumb.png\` が使えない

YouTube Studio → 設定 → チャンネル → **機能の利用資格** → 「中級者向け機能」→ 電話番号で確認。
（反映に数分〜24時間かかることがあるので、**アップロードの前日までに**済ませておくと安全）

## ⚠️ 公開順序の制約

**アンカー（長尺）を先に上げる → ショートを後で上げる。**
ショートの「関連動画」リンクはアップロード時に設定し、**リンク先の動画が既に存在している必要がある**ため。

## 共通設定（3本とも同じ）

| 項目 | 値 |
|---|---|
| 公開設定 | 公開 |
| 視聴者 | **子ども向けではありません** |
| カテゴリ | エンターテイメント |
| 言語 | 日本語 |
| コメント | 許可（同窓会になる。ただし返信はハートのみ＝世界観保護） |
| 再生リスト | 「あの季節の走馬灯（通し版）」を新規作成して3本とも入れる |
`);

for (const a of anchors) {
  const metaPath = path.resolve(ANCHOR_OUT, `${a.slug}.json`);
  if (!fs.existsSync(metaPath)) {
    blocks.push(`\n---\n\n## ⚠️ ${a.slug}: メタが未生成（\`--only ${a.id}\` でレンダするか \`--meta-only\` を実行）\n`);
    continue;
  }
  const j = readJson(metaPath);
  const mp4 = path.resolve(ANCHOR_OUT, `${a.slug}.mp4`);
  const thumb = path.resolve(ANCHOR_OUT, `${a.slug}-thumb.png`);
  const tags = (j.description.match(/#[^\s#]+/g) ?? []).map((t) => t.slice(1));

  blocks.push(`
---

## ${j.kind === 'compile' ? '合本' : '単セル'} ${a.id}: ${j.cells.join(' + ')}（${j.durationLabel}）${j.free ? ' 🆓無料回' : ''}

**動画ファイル**
\`\`\`
${mp4}
\`\`\`
**サムネイル**（※電話番号確認が必要）
\`\`\`
${thumb}
\`\`\`

**タイトル**（${j.title.length}字 / 上限100）
\`\`\`
${j.title}
\`\`\`

**説明**（チャプターと曲リストを含む・そのまま全部貼る）
\`\`\`
${j.description}
\`\`\`

**タグ**（「タグ」欄にカンマ区切りで）
\`\`\`
${tags.join(', ')}
\`\`\`

**チャプター確認**（説明に含まれています。0:00始まり・${j.chapters.length}個）
${j.chapters.map((c) => `- ${c.at} ${c.label}`).join('\n')}
`);
}

blocks.push(`
---

## アップロード後にやること

1. **3本とも公開できたら、Claudeに動画URLを伝える**
   → ショート全本の「関連動画」リンクをどのアンカーに向けるか確定させる（二段導線の要）
2. 再生リスト「あの季節の走馬灯（通し版）」にまとめる
3. チャンネルの「ホーム」タブに、**1990春（無料回）を注目動画に設定**
   → 初見の人が最初に見るのが「概要欄リンクの着地が完結する回」になる

## 補足: 字幕について

**自動生成の字幕に任せてください。** \`--srt\` で書き出せますが、Whisperは固有名詞に弱く
（「ポール・マッカートニー」→「コール・マッカートニー」等）、校正なしで上げると
ブランドを毀損します。人手校正の余裕ができるまでは、YouTubeの自動字幕のほうが安全です。
`);

const out = path.resolve(ANCHOR_OUT, 'UPLOAD_KIT.md');
fs.writeFileSync(out, blocks.join('\n'), 'utf8');
console.log(`✅ ${path.relative(process.cwd(), out)}（${anchors.length}本ぶん / ${(fs.statSync(out).size / 1024).toFixed(1)}KB）`);
