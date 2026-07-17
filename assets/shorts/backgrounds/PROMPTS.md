# ショート背景画像 生成プロンプト集（Gemini / Nano Banana Pro）

「題材の空気を感じさせる情景」路線（hide承認 2026-07-13）。実物そのもの・実在ブランドは描かず、**その時代の"気配"**を作る。生成した画像を `assets/shorts/backgrounds/{filename}` に置き、CLIの `--bg {filename}` で差し込む。

## 全画像で必ず守る条件（各プロンプト末尾に付与済み）

- **縦 9:16 / 1080×1920**（vertical）
- **フォトリアル・シネマティック・夜・低照度・彩度控えめ・全体に暗い**（白字幕を上に重ねるため。CLI側でさらに暗転＋ビネットをかける）
- **文字・ロゴ・ブランドマーク・商品意匠を一切入れない**（no text, no logos, no signage, no brand designs）＝商標回避
- **実在人物・顔を出さない**（無人、または遠景の匿名シルエットのみ）＝肖像回避
- **著作物を写さない**（アニメ/キャラ/ジャケット/ポスターなし）
- **1990年代日本の雰囲気**だが特定できない汎用の情景
- **構図**: 下端は暗めに（字幕帯）／左上も空ける（年バッジ）。焦点は上〜中央寄り
- **⚠️ 明暗は題材に合わせる（一律に暗くしない）**: プリクラ・ゲームセンターのような**賑やかで楽しい場所は明るくカラフル・キラキラ**に／深夜のコンビニ・机の上・夜の電車など**静かな題材は落ち着いた低照度**に。CLIが最終的に少し暗転＋ビネットをかけ、字幕は縁取りで読めるので、明るめの画像でも問題ない
- **ChatGPT(DALL-E)で作る場合**: 否定条件（"no 〜"の羅列）を書くと生成が固まりやすい。**含めたい情景だけを肯定文で短く**書く（各項の「ChatGPT向け短縮版」を使う）。Geminiは否定条件込みの詳細版でOK

---

## purikura-night.png ／ プリクラ（1995秋・華やかで可愛い一角）

⚠️ プリクラは**暗い/陰鬱にしない**。実際は「明るく・カラフルで・女の子が集まる華やかで可愛い場所」。キラキラ・パステル・ポップに（hideフィードバック 2026-07-13：暗くするとホラー映画のゲーセンに見える）。字幕の可読性はCLIの暗転＋字幕の縁取りで担保するので、画像はキラキラ寄りでよい。

```
A bright, cheerful, colorful vertical 9:16 photograph of a cute 1990s Japanese photo-sticker-booth corner, glowing with pop energy. Several tall photo booths with pastel pink, mint, and cyan glowing frames and frilly curtains, decorated with sparkly star and heart shapes and shiny reflective panels. Warm inviting light spilling from inside the booths, glossy floor twinkling with pink and cyan reflections, a lively fun late-1990s girly atmosphere, saturated pastel palette, sparkling highlights, nostalgic and joyful. Empty of people. No text, no letters, no logos, no brand names, no visible people or faces, no copyrighted characters. Keep the very bottom of the frame a little darker for captions. Photorealistic. Vertical 1080x1920.
```

**ChatGPT(DALL-E)向け短縮版**（否定を書かず、含めたい情景だけ）:
```
明るくカラフルで可愛い1990年代日本のプリクラコーナー。パステルピンクとシアンに光る背の高い写真ブースが並び、フリルのカーテン、星やハートのキラキラした装飾、光沢のある床に反射する光。楽しくて華やかな女の子が集まる雰囲気、パステルの彩度、きらめくハイライト、ノスタルジックで幸福感。無人。縦長9:16、フォトリアル。
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

## night-station.png ／ 六甲道駅・復旧の朝（1995春・#1）

```
A tall vertical 9:16 cinematic photograph: an empty elevated Japanese commuter train platform at dawn in early spring, 1995. Faint morning mist, a single local train just arrived and standing quietly at the platform, soft blue-hour light beginning to warm at the horizon. A quiet sense of return and relief. No people, no text, no signage, no logos, no watermark. Deep navy and cool grey tones with a faint warm dawn glow far away. The center and lower half must stay dark and uncluttered for overlaid text. Photographic, shallow depth of field, film grain, vertical 9:16.
```

## cassette-night.png ／ カセットと音楽（1988秋・#2）

```
A tall vertical 9:16 cinematic photograph: a single audio cassette tape and a vintage portable stereo resting on a wooden desk at night, late 1980s Japan, lit only by a warm desk lamp from one side. An unplayed tape, intimate and quiet, late-night music nostalgia. No people, no readable text or brand names, no logos, no watermark. Deep shadow with warm amber highlights on the plastic and metal. The center and lower half must stay dark and uncluttered for overlaid text. Photographic, shallow depth of field, film grain, vertical 9:16.
```

## stadium-night.png ／ 甲子園ナイター（1985春・#7）

⚠️ 球団章・スコアボードの文字を描かせない（商標）。

```
A tall vertical 9:16 cinematic photograph: a night baseball stadium under bright floodlights, seen from the empty stands looking toward the glowing green infield, 1980s Japan. Deep night sky above, warm stadium light haze. Nostalgic and grand. No people, no team logos, no text, no scoreboard text, no watermark. Green field and warm light against dark sky. The center and lower half must stay dark and uncluttered for overlaid text. Photographic, shallow depth of field, film grain, vertical 9:16.
```

## summer-poster-night.png ／ 「生きろ。」の夏（1997夏・#8）

⚠️ 映画のポスター意匠・コピーそのものは描かせない（著作権）。**空白の掲示板**にして「気配」だけ作る。

```
A tall vertical 9:16 cinematic photograph: a Japanese city street at night in high summer, 1997. A large blank illuminated poster board or signboard glows softly on a station pillar or building wall, its surface empty (no readable image or text). Humid summer air, faint neon, the sense of a hot night in the city. No people, no text, no poster art, no logos, no watermark. Warm amber and deep teal night tones. The center and lower half must stay dark and uncluttered for overlaid text. Photographic, shallow depth of field, film grain, vertical 9:16.
```

## sydney-dawn.png ／ 坂を駆け上がった朝（2000秋・#9）

⚠️ 五輪マーク・選手の顔を描かせない。**無人の坂と夜明け**で「あの朝」の気配を作る。

```
A tall vertical 9:16 cinematic photograph: an empty road climbing a gentle hill at dawn, faint mist, the first golden light breaking over the crest of the slope. Quiet, hopeful, the feeling of a morning after a long night. No people, no text, no logos, no watermark. Cool blue shadows in the foreground giving way to warm dawn light at the top of the hill. The center and lower half must stay dark and uncluttered for overlaid text. Photographic, shallow depth of field, film grain, vertical 9:16.
```

---

## ⚠️ Geminiの透かし（✦）は必ず消す

Geminiの出力は**右下に✦の透かし**が入る（2026-07-17 実測: 768×1376 の画像で **x624-671 / y1232-1279**）。
レンダは 768→1080 に拡大するので、**そのままだと動画に写り込む**。

```
node scripts/shorts/strip-watermark.mjs <原本.png> assets/shorts/backgrounds/<filename>.png
```

既定は **crop＝透かしの上で下端を切り落とす**（768×1376 → 768×1222）。塗って消す方式は
**透かしが実contentの上に乗っている画像で必ず破綻する**（2026-07-17 の実地: 近傍パッチのコピーは
konbiniの斜めの帯に矩形跡／双一次補間は purikura の光の筋を途切れさせ summer-poster に矩形跡）。
暗い画像なら下部scrimに沈んで見えないが、明るい題材では見える＝画像ごとの判断が要る方式は
将来の背景で事故る。失う下端はほぼ前景の床/路面なので、常にcropでよい。

## 使い方

1. 上のプロンプトでGeminiに生成（9:16・複数候補から選ぶ）
2. **原本を `redial/SNS/youtube/` に保存**（Geminiは同じ絵を二度と出さない＝失うと復元不可）
3. 透かしを消して `assets/shorts/backgrounds/{filename}` に保存（gitignore対象＝**ここのバイナリはコミットしない**。原本がredial gitにあり、上のスクリプトでいつでも作り直せる）
3. レンダ時に `--bg purikura-night.png` のように指定（manifestの `bg` フィールドにも同名で設定済み）
4. CLIが自動で暗転＋ビネット＋ゆっくりズーム（Ken Burns）を適用する。**もし特定画像で字幕が読みにくければ** `render.mjs` の `eq=brightness` を下げるか、その画像を暗めに再生成

## 品質チェック（生成後・出す前に）

- [ ] 文字・ロゴ・ブランド意匠が写り込んでいない（拡大して確認）
- [ ] 実在人物の顔が写っていない
- [ ] 全体に暗く、字幕（中央下）と年バッジ（左上）が乗る余白がある
- [ ] 「安っぽい生成AI感」が出ていない（深夜ラジオの質感・戦略書 品質ゲート）
