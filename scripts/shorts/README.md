# ショート自動生成CLI（make-short）

公開エピソード（`../redial/data/stock/{slug}`）のトークセグメントから、投稿用の縦型ショート mp4 を作る。
**音はシンヤの声だけ・楽曲0秒**（権利クリーン）。設計の正: `../redial/docs/SHORTS_CLI_DESIGN_2026-07.md`／編集方針: `../redial/docs/SHORTS_PLAYBOOK_2026-07.md`。

## 前提
- ffmpeg（showwaves/zoompan/ass/subtitles 対応・full build）が PATH にある
- `OPENAI_API_KEY`（Whisper用）。実行時に `--env-file=.env.local` で読み込む
- 日本語フォントは `assets/shorts/fonts/` に `NotoSerifJP-VF.ttf` / `NotoSansJP-VF.ttf`（gitignore・システムからコピー）
  ```
  cp /c/Windows/Fonts/NotoSerifJP-VF.ttf /c/Windows/Fonts/NotoSansJP-VF.ttf assets/shorts/fonts/
  ```

## 使い方

### まず必ず dry-run（窓・尺・一致スコアの確認・課金ほぼ0）
```
node --env-file=.env.local scripts/make-short.mjs \
  --cell 1995-spring --seg 1 \
  --start "最後まで残っていた六甲道駅は" --end "関西の人は知っている。" \
  --hook "駅の段ボール" --dry-run
```
`--start`/`--end` は **Whisper transcript（漢字正規化済）に現れる一意な句**。一致スコアが start/end とも高い（≒1）ことを確認する。低い/失敗なら句を調整（固有名詞・数字を含む句が当たりやすい）。

### 本レンダ
```
node --env-file=.env.local scripts/make-short.mjs \
  --cell 1995-spring --seg 1 \
  --start "最後まで残っていた六甲道駅は" --end "関西の人は知っている。" \
  --hook "駅の段ボール" --title "「おかえりなさい」と書いた段ボール——1995年春、六甲道駅" \
  [--bg night-station.png]
```
→ `output/shorts/{cell}-seg{N}-{hook}.mp4` ＋ 同名 `.json`（投稿メタ）。

### バッチ（manifest）
```
node --env-file=.env.local scripts/make-short.mjs --manifest data/shorts.manifest.json --dry-run
node --env-file=.env.local scripts/make-short.mjs --manifest data/shorts.manifest.json --only 1
```

## 主なオプション
| 引数 | 既定 | 意味 |
|---|---|---|
| `--cell` | — | slug（例 1995-spring・1995秋は 1995-autumn-09） |
| `--seg` | — | segmentIndex 0..4（OP/M1/M2/ED1/ED2） |
| `--start` / `--end` | — | 切り出しアンカー句 |
| `--hook` | clip | 出力名スラグ＋メタ |
| `--title` | — | 冒頭2.6sに出るフックタイトル |
| `--bg` | なし | `assets/shorts/backgrounds/` の画像。無ければ合成背景フォールバック |
| `--pad-start`/`--pad-end` | 0.25/0.6 | アンカー前後の余白秒 |
| `--max` | 90 | 上限秒（超過で停止） |
| `--subs-file` | — | 手直し字幕（1行1字幕・時刻は均等割付） |
| `--dry-run` | — | 窓解決だけ・動画は作らない |
| manifest の `startAt` / `endAt` | なし | 波形で決めた切れ目（秒・セグメント音声の先頭から）。アンカーの一致は従来どおり確かめたうえで、この位置で切る。型Cは `clips[]` の中に書く |

### 切れ目は波形で確かめる（2026-09-28・第9バッチ）
Whisper の語の時刻は、前後の無音を語に吸い込んで伸びることがある（「…はずです」の終わりが実音より0.35秒遅い等）。
既定の余白（頭0.25秒・尻0.6秒）と隣語クランプはその伸びた時刻で止まるので、**語の頭を0.05〜0.15秒削る／次の語の頭を拾う**ことがあり、`check-window-tail` も語の時刻で見るので通ってしまう。
また全体に**頭0.3秒のフェードイン・尻0.3秒のフェードアウト**が掛かるので、声の出だしまでの間が短いと一音目が細くなる。
→ 焼く前に各切れ目の前後を 50ms 刻みの RMS で見て、頭は**声の出だしの0.25〜0.3秒前の無音**、尻は**声が消えた後の無音**に `startAt` / `endAt` を置く。
窓の上限はセグメント音声の実尺（ffprobe）で持つ（以前は Whisper の最後の語の end で、末尾まで切る型Bの「〜です」がフェードに掛かっていた）。

## 出力・キャッシュ
- 生成物: `output/shorts/`（gitignore）
- Whisper結果: `output/shorts/.cache/{slug}-seg{N}.words.json`（同segの2本目以降は再課金しない）

## 既知の残作業（P1）
- 背景画像プール（`assets/shorts/backgrounds/`・Gemini生成・9:16文字なし）は未整備。現状は合成グラデ背景で動く
- 字幕グルーピングが稀に語をまたぐ（例「段ボール」が2字幕に分かれる）。`--subs-file` で手直し可
- manifest の #2〜#10 のアンカーは Playbook 由来・**dry-run未検証**（#1のみ検証済）
