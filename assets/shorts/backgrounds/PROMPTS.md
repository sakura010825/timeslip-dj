# ショート背景画像 生成プロンプト集（Gemini / Nano Banana Pro）

「題材の空気を感じさせる情景」路線（hide承認 2026-07-13）。実物そのもの・実在ブランドは描かず、**その時代の"気配"**を作る。生成した画像を `assets/shorts/backgrounds/{filename}` に置き、CLIの `--bg {filename}` で差し込む。

## 全画像で必ず守る条件（各プロンプト末尾に付与済み）

- **縦 9:16 / 1080×1920**（vertical）
- **フォトリアル・シネマティック・夜・低照度・彩度控えめ・全体に暗い**（白字幕を上に重ねるため。CLI側でさらに暗転＋ビネットをかける）
- **文字・ロゴ・ブランドマーク・商品意匠を一切入れない**（no text, no logos, no signage, no brand designs）＝商標回避
- **実在人物・顔を出さない**（無人、または遠景の匿名シルエットのみ）＝肖像回避
- **著作物を写さない**（アニメ/キャラ/ジャケット/ポスターなし）
- **1990年代日本の雰囲気**だが特定できない汎用の情景
- **構図**: 下1/3と中央は暗く・シンプルに（字幕帯）／左上も空ける（年バッジ）。焦点は上寄り・周辺に

---

## purikura-night.png ／ プリクラ（1995秋・夜のゲームセンターの気配）

```
A moody, cinematic vertical 9:16 photograph of the interior of a dim Japanese game arcade at night in the mid-1990s, seen from a quiet corner. Rows of anonymous, unbranded photo-booth-like machines glowing faintly with soft pink and cyan light, curtains half-drawn. Empty of people. Hazy neon reflections on a tiled floor, deep shadows, nostalgic low-key lighting, slight film grain, muted desaturated colors, dark overall. No text, no logos, no signage, no brand names, no visible people or faces, no copyrighted characters. Negative space and darkness in the lower third and center. Photorealistic, 35mm film look. Vertical 1080x1920.
```

## pager-night.png ／ ポケベル（1993秋・夜の机の上）

```
A cinematic vertical 9:16 photograph of a small anonymous 1990s pocket pager-like device resting on a wooden student's desk at night, lit by a single warm desk lamp just out of frame. Blank device screen (no text, no numbers). Beside it a spiral notebook and a mug in soft focus. Intimate, quiet, nostalgic mood, deep shadows, muted warm palette, shallow depth of field, dark overall. No text, no logos, no brand marks, no people, no faces. Keep the lower third dark and simple. Photorealistic, 35mm film grain. Vertical 1080x1920.
```

## train-window-spring.png ／ ガラケー・親指の革命（2000春・夜の電車内）

```
A cinematic vertical 9:16 photograph from inside a quiet Japanese commuter train at night, looking toward the window. Soft blurred cherry-blossom branches and city lights faintly visible through the glass. Empty seats, cool blue interior light, a faint reflection on the window. Calm, contemplative, nostalgic early-2000s mood, muted desaturated colors, deep shadows, dark overall. No text, no logos, no signage, no people, no faces, no phone screens with content. Negative space in the lower third. Photorealistic, subtle film grain. Vertical 1080x1920.
```

## konbini-night.png ／ 深夜のコンビニ（1990冬・外からの窓明かり）

```
A cinematic vertical 9:16 photograph of an anonymous Japanese convenience store at night in winter, seen from across an empty street. Warm fluorescent light spilling from the windows onto wet asphalt, faint mist, no signage or logos on the storefront (blank facade). Empty of people. Lonely, quiet, nostalgic late-1990s mood, muted cool palette with a warm glow, deep shadows, dark overall. No text, no logos, no brand marks, no visible people or faces. Keep center and lower third dark. Photorealistic, 35mm film look. Vertical 1080x1920.
```

## arcade-night.png ／ ストリートファイター対戦台（1991春・夜のゲームセンター）

```
A cinematic vertical 9:16 photograph of a dim 1990s Japanese arcade at night, focusing on a row of anonymous unbranded sit-down cabinet-style arcade machines facing each other (versus-style), their screens glowing with abstract soft light (no game imagery, no characters, no text). Empty of people. Smoky atmosphere, neon reflections, deep shadows, nostalgic low-key lighting, muted colors, dark overall. No text, no logos, no game screens with recognizable content, no characters, no people, no faces. Lower third dark and simple. Photorealistic, film grain. Vertical 1080x1920.
```

## city-night-default.png ／ 汎用デフォルト（深夜ラジオ・夜の街）

```
A cinematic vertical 9:16 photograph of a quiet Japanese city street at night in the 1990s, wet pavement reflecting soft blurred neon and streetlight glow, distant anonymous lit windows, no readable signage. Empty and still. Melancholic late-night radio mood, muted desaturated palette, deep shadows, heavy negative space, dark overall. No text, no logos, no brand names, no people, no faces. Focal glow in the upper-middle; lower third and center kept dark for overlaid captions. Photorealistic, 35mm film grain. Vertical 1080x1920.
```

---

## 使い方

1. 上のプロンプトでGeminiに生成（9:16・複数候補から選ぶ）
2. `assets/shorts/backgrounds/{filename}` に保存（gitignore対象。バイナリはコミットしない運用）
3. レンダ時に `--bg purikura-night.png` のように指定（manifestの `bg` フィールドにも同名で設定済み）
4. CLIが自動で暗転＋ビネット＋ゆっくりズーム（Ken Burns）を適用する。**もし特定画像で字幕が読みにくければ** `render.mjs` の `eq=brightness` を下げるか、その画像を暗めに再生成

## 品質チェック（生成後・出す前に）

- [ ] 文字・ロゴ・ブランド意匠が写り込んでいない（拡大して確認）
- [ ] 実在人物の顔が写っていない
- [ ] 全体に暗く、字幕（中央下）と年バッジ（左上）が乗る余白がある
- [ ] 「安っぽい生成AI感」が出ていない（深夜ラジオの質感・戦略書 品質ゲート）
