/**
 * TTS誤読対策辞書
 *
 * Azure / OpenAI TTS の既知の誤読を、送信前にカタカナ/ひらがな表記へ置換する。
 * Whisper検証も置換後テキストに対して行うため、ここを通したテキストが「正解」として扱われる。
 *
 * 追加方針:
 *  - .tts-archive/ の入出力ペアを聴いて誤読が確認できたものを追加
 *  - 一般的な単語は追加しない（過剰置換で別の誤読を生む）
 *  - 固有名詞・難読語に絞る
 *  - 過剰置換のリスクがある短い表記は正規表現で文脈限定する
 */

export type PronunciationEntry = {
  /** マッチさせる元表記。string はリテラル一致、RegExp は正規表現。RegExp は g フラグ推奨 */
  pattern: string | RegExp;
  /** 置換後の読み（カタカナまたはひらがな） */
  replacement: string;
  /** メモ（誤読の確認元など） */
  note?: string;
};

export const PRONUNCIATION_DICT: PronunciationEntry[] = [
  // 2026-04-24 セッションで確認された誤読
  { pattern: '押井守', replacement: 'おしいまもる', note: '「おじまもる」と誤読' },
  { pattern: '密か', replacement: 'ひそか', note: '「みつか」と誤読' },
  // 2026-04-30 セッションで確認された誤読
  { pattern: '競馬', replacement: 'けいば', note: '「きょうば」と誤読' },
  { pattern: '仰木彬', replacement: 'おおぎあきら', note: '読めず破綻' },
  { pattern: '仰木', replacement: 'おおぎ', note: '単独使用時のフォールバック' },
  // 2026-05-11 hideさんの 1995-09 編集ログから抽出した固有名詞・難読語
  { pattern: '倶楽部', replacement: 'くらぶ', note: 'プリント倶楽部などで誤読（クラックなどに化ける）' },
  { pattern: '現像', replacement: 'げんぞう', note: '現像液で誤読' },
  { pattern: '野島伸司', replacement: 'のじましんじ', note: 'TV脚本家。人名読み誤り' },
  { pattern: 'いしだ壱成', replacement: 'いしだいっせい', note: '俳優名。「壱成」が読めず破綻' },
  { pattern: '反町隆史', replacement: 'そりまちたかし', note: '俳優名。「反町」が読めず破綻' },
  { pattern: '桜井幸子', replacement: 'さくらいさちこ', note: '俳優名。「幸子→さちこ」' },
  { pattern: 'ジュディ・アンド・メアリー', replacement: 'ジュディ・アンド・まりー', note: 'バンド名。メアリー部分が英語化を誘発' },
  // 2026-05-12 Azure 評価で確認された誤読
  { pattern: '米米CLUB', replacement: 'こめこめクラブ', note: 'Azureが「ベイベイクラブ」と読む（米を音読み）' },
  { pattern: 'F1', replacement: 'エフワン', note: 'F1の読み誤り対策' },
  { pattern: 'KAN', replacement: 'カン', note: 'シンガーKAN。Azureが英語読みする' },
  { pattern: 'JAL', replacement: 'ジャル', note: '航空会社名。略語の英語読み回避' },
  // 2026-05-15 走馬灯型試作（1990秋10月）で確認された誤読
  { pattern: 'ジェイエイエル', replacement: 'ジャル', note: 'Claudeが独自にJALをカタカナ化した場合、Azureが「ジェイエイエル」を音節読みで破綻させるための保険' },
  { pattern: '麻布', replacement: 'あざぶ', note: 'Azureが「あさの」と誤読' },
  // 2026-05-22 1995夏/2000夏/1990夏セッションで繰り返し修正対象になった
  // フジテレビの「月曜9時ドラマ」枠の表記。Azureが「げつく」と読めない
  // 過剰置換回避: 直後が「日/月/年」（日付表現）の場合は対象外
  { pattern: /月9(?![日月年])/g, replacement: 'げつく', note: '月曜9時ドラマ枠。「○月9日」等の日付表現は対象外（負の先読み）' },
  { pattern: /月九(?![日月年])/g, replacement: 'げつく', note: '「月9」の漢字表記。月九・げつく。日付ガード: 「五月九日」等の漢数字日付に過剰マッチしないよう負の先読み（2026-06-10 1986春seg2で実害確認）' },
  // 2026-05-26 1995冬で確認された誤読
  { pattern: 'Windows 95', replacement: 'ウィンドウズきゅうじゅうご', note: 'Azureが「ウィンドウズナインティファイブ」と英語読みする' },
  { pattern: 'Windows95', replacement: 'ウィンドウズきゅうじゅうご', note: 'スペースなし表記の保険' },
  { pattern: 'ウィンドウズナインティファイブ', replacement: 'ウィンドウズきゅうじゅうご', note: 'Claudeが先回りカタカナ化した場合の保険' },
  { pattern: 'ウィンドウズ・ナインティファイブ', replacement: 'ウィンドウズきゅうじゅうご', note: '中黒入りの場合（2000冬で誤読確認）' },
  { pattern: 'ウィンドウズ95', replacement: 'ウィンドウズきゅうじゅうご', note: '混在表記の保険' },
  // 2026-05-26 1990冬・2000冬で確認された誤読
  { pattern: 'フエム', replacement: 'エフエム', note: 'ClaudeがFMを「フエム」と先回りカタカナ化するパターン。実体としての日本語「フエム」は存在しないため安全に置換可' },
  { pattern: 'ケイエイエヌ', replacement: 'カン', note: 'シンガーKANを「ケイエイエヌ」と先回りカタカナ化されたケース。dictで先にKAN→カンを定義してあるが、Claude側でカタカナ化された後は別ルールが必要' },
  { pattern: 'ダイヤモンズ', replacement: 'ダイヤモンド', note: 'プリンセス・プリンセス「Diamonds」を「ダイヤモンズ」と複数形読みされるのを単数形へ統一' },
  { pattern: '同い年', replacement: 'おないどし', note: 'Azureが「どういどし」と誤読する場合あり、明示的にひらがな化' },
  { pattern: '前の年', replacement: '前のとし', note: 'Azureが「まえのねん」と読みがちな箇所を「とし」へ。日付表現の「○○年」とは衝突しないリテラル一致' },
  // 2026-06-05 1985春で確認された誤読（hideさん試聴）
  // ⚠️ フルネームは単独の「掛布」より前に置くこと。逐次置換なので、先に掛布→かけふ が走ると
  //    「かけふ雅之」になりフルネームのパターンが二度とマッチしない（2026-07-17 に「かけふまさやき」で露見）
  { pattern: '掛布雅之', replacement: 'かけふまさゆき', note: '阪神・掛布雅之。「雅之」が「まさやき」と誤読（正: かけふまさゆき）。2026-07-17 hideさん試聴・野球殿堂表記で確認' },
  // 既存アーカイブの chunk.text は「辞書適用後」で保存されており、既に「かけふ雅之」になっている。
  // 引き直し（fix-duplicate-chunks）はそのテキストを使うので、上のフルネーム規則ではマッチしない。
  // → 変換後の表記に対する規則も要る（'ケイエイエヌ'→'カン' と同じ型）。
  { pattern: 'かけふ雅之', replacement: 'かけふまさゆき', note: '上の掛布雅之が既に適用済みのテキスト（アーカイブ）向け。単独の「雅之」は読みが多く危険なので文脈限定' },
  { pattern: '掛布', replacement: 'かけふ', note: '阪神・掛布雅之。「掛布」が読めず誤読（正: かけふ）' },
  { pattern: '彰布', replacement: 'あきのぶ', note: '阪神・岡田彰布の「彰布」。岡田は読めるが彰布が破綻するため彰布のみ置換（おかだ・あきのぶ）' },
  { pattern: '村さ来', replacement: 'むらさき', note: '居酒屋チェーン。「村さ来」を誤読（正: むらさき）' },
  { pattern: '明石家', replacement: 'あかしや', note: '明石家さんま。「明石家」を誤読（正: あかしや）' },
  // 2026-06-10 1986春で確認された誤読（hideさん試聴）
  { pattern: '手繰', replacement: 'たぐ', note: '「手繰って」を「てぐって」と誤読（正: たぐって）。手繰る/手繰り含め常に「たぐ」' },
  { pattern: '工藤公康', replacement: 'くどうきみやす', note: '西武・工藤公康。「くどうこうやす」と誤読（正: きみやす）' },
  { pattern: '阿部寛', replacement: 'あべひろし', note: '俳優・阿部寛。「あべひらん」と誤読（正: あべひろし）' },
  // 2026-06-10 1986春のWhisper全文検査で検出（hideさん未報告分）
  { pattern: '千代の富士', replacement: 'ちよのふじ', note: 'Whisperが「塩野富士」と書き起こし=読み破綻の疑い（正: ちよのふじ）' },
  { pattern: '筑紫哲也', replacement: 'ちくしてつや', note: 'Whisperが「少し徹夜」と書き起こし=読み破綻の疑い（正: ちくしてつや）' },
  { pattern: '産声', replacement: 'うぶごえ', note: 'Whisperが「海声」と書き起こし=読み破綻の疑い（正: うぶごえ）' },
  { pattern: '1986年の春', replacement: 'せんきゅうひゃくはちじゅうろく年の春', note: '文頭の「1986年の春」を「にせんきゅうひゃく…」と誤読（seg3/seg4で確認）。この定型句に限定してかな化。他年で再発したら一般化を検討' },
  // 2026-06-10 1986春の再ロールで新規混入した誤読（Whisper検査）。いずれも読みが一意で置換による副作用なし
  { pattern: 'ダイアナ妃', replacement: 'ダイアナひ', note: '再ロールで「ダイアナひめ」と誤読（正: ダイアナひ）。フレーズ限定' },
  { pattern: '躍っ', replacement: 'おどっ', note: '「新聞に躍って」を「やごって」と誤読（正: おどって）。躍動(やくどう)は「っ」が続かないため衝突しない' },
  { pattern: '休場', replacement: 'きゅうじょう', note: '「途中休場」を「きゅうじょ」と誤読の疑い（Whisperが救助と書き起こし）。相撲ネタで頻出のため恒久化' },
  { pattern: '印刷', replacement: 'いんさつ', note: '「印刷されていた」を「うんさつ」と誤読（正: いんさつ）' },
  { pattern: '所作', replacement: 'しょさ', note: '「しょさく」と誤読の疑い（2ロール連続でWhisperが初作と書き起こし）' },
  { pattern: '滲み', replacement: 'にじみ', note: '「滲み込んで」の読みが2ロール連続で不安定（Whisperがみじみと書き起こし）。にじみへ固定' },
  { pattern: '三月', replacement: 'さんがつ', note: '「三月に」を「みかつ」系に誤読（チャンク/全文Whisperが独立に検出）。月名の漢数字は誤読リスクが高い' },
  // 2026-06-16 カバレッジ#2-4（1987夏/1988秋/1989冬）のWhisper全文検査で検出した固有名詞・難読語
  { pattern: '俵万智', replacement: 'たわらまち', note: 'Whisperが「タワラマンチ」と書き起こし＝読み破綻（正: たわらまち）。1987夏' },
  { pattern: '南野陽子', replacement: 'みなみのようこ', note: '「陽子→よこ」と誤読（Whisperが「南の横」と書き起こし）。1988秋' },
  { pattern: '稲葉浩志', replacement: 'いなばこうし', note: "B'z稲葉浩志は『いなばこうし』が正（2026-06-16 hideさん試聴で確定。以前『ひろし』としたのは誤り）。1988秋" },
  { pattern: '渥美清', replacement: 'あつみきよし', note: '俳優・渥美清。「あつみきよ」と末尾欠落で誤読（正: あつみきよし）。1987夏' },
  { pattern: '知床慕情', replacement: 'しれとこぼじょう', note: '映画タイトル。難読で破綻（Whisperが「白友女」と書き起こし）。知床より前に置くこと。1987夏' },
  { pattern: '知床', replacement: 'しれとこ', note: '地名。単独でも誤読（Whisperが「チロ島」と書き起こし）。1987夏' },
  { pattern: '祭囃子', replacement: 'まつりばやし', note: '「囃子」が難読で破綻（Whisperが「松井林」と書き起こし）。1988秋' },
  { pattern: 'ちびまる子ちゃん', replacement: 'ちびまるこちゃん', note: '「まる子→まるぽ」等に誤読（Whisperが「チビマルポ」と書き起こし）。1989冬' },
  // 2026-06-16 カバレッジ#5（1991春）のWhisper検査で検出
  { pattern: '貴花田', replacement: 'たかはなだ', note: '相撲・貴花田（のちの貴乃花）。Whisperが「木金田」と書き起こし＝読み破綻（正: たかはなだ）。1991春' },
  // 2026-06-16 カバレッジ#6（1992夏）のTTSで検出。英語2文字「if」がdropout（読み飛ばし maxGap=9）を起こし、
  // verifyリトライで処理が異常に長時間化 → fetch socket切れの一因に。英語タイトル曲は確実にカナ化する。
  { pattern: /\bif\b/gi, replacement: 'イフ', note: "CHAGE and ASKA『if』等。英語2文字のままだとTTSがdropoutする。単語境界で限定。1992夏" },
  { pattern: 'エスエーワイ・イエス', replacement: 'セイ・イエス', note: "CHAGE and ASKA『SAY YES』をClaudeが「エスエーワイ」と先回り誤カナ化。正: セイ・イエス。1992夏" },
  { pattern: 'SAY YES', replacement: 'セイ・イエス', note: '英語のままの場合の保険。セイ・イエス。1992夏' },
  // 2026-06-16 カバレッジ#6（1992夏）のWhisper検査で検出した固有名詞・難読語
  { pattern: '紅の豚', replacement: 'くれないのぶた', note: '映画タイトル。「紅」が読めず2ロール連続で破綻（Whisperが「家内の豚」「栗菜の豚」と書き起こし）。正: くれないのぶた。1992夏' },
  { pattern: '賀来千香子', replacement: 'かくちかこ', note: '女優・賀来千香子。「賀来」が読めず破綻（Whisperが「辛井千佳子」と書き起こし・attempts=3で不安定）。正: かくちかこ。1992夏' },
  { pattern: '山形新幹線', replacement: 'やまがたしんかんせん', note: '「山形」が箇所により「やまれた」等に揺れる（Whisperが「山れた新幹線」と書き起こし）。新幹線文脈に限定してかな化。1992夏' },
  // 2026-06-16 カバレッジ#7（1993秋）のWhisper検査で検出
  { pattern: '硝子の塔', replacement: 'がらすのとう', note: '映画タイトル。「硝子」が読めず破綻（Whisperが「証拠の塔」と書き起こし）。正: がらすのとう。1993秋' },
  { pattern: '曙', replacement: 'あけぼの', note: '横綱・曙。Whisperが「悪魔」と書き起こし＝読み破綻（正: あけぼの）。1993秋' },
  // 2026-06-16 カバレッジ#8（1994冬）のWhisper検査で検出
  { pattern: '野茂英雄', replacement: 'のもひでお', note: '投手・野茂英雄。箇所により「もも英雄」等に揺れる（Whisperが「桃英雄」と書き起こし）。正: のもひでお。1994冬' },
  // 2026-06-16 hideさんスポット試聴で検出（#6-8）
  { pattern: '有森裕子', replacement: 'ありもりゆうこ', note: 'マラソン・有森裕子。「ありもりひろこ」と誤読（裕子→ゆうこ）。1992夏' },
  { pattern: '井上雄彦', replacement: 'いのうえたけひこ', note: 'スラムダンク作者・井上雄彦。「いのうえゆうひこ」と誤読（雄彦→たけひこ）。1993秋' },
  { pattern: '白鳥麗子', replacement: 'しらとりれいこ', note: 'ドラマ『白鳥麗子でございます』。「はくちょうれいこ」と誤読（白鳥→しらとり）。1993秋' },
  // 2026-06-17 カバレッジ#9-12（1996春/1997夏/1998秋/1999冬）のWhisper検査で検出
  { pattern: '硝子の少年', replacement: 'ガラスのしょうねん', note: 'KinKi Kids『硝子の少年』。「硝子」が音読み破綻（Whisperが「将暮の少年」と書き起こし）。正: ガラスのしょうねん。1997夏' },
  { pattern: '高嶋仁', replacement: 'たかしまひとし', note: '智弁和歌山・高嶋仁監督。「仁」を「じん」と誤読（Whisperが「高島陣」と書き起こし）。正: たかしまひとし。1997夏' },
  { pattern: '中田英寿', replacement: 'なかたひでとし', note: 'サッカー・中田英寿。「英寿」が「へいし/ひでし」に揺れる（Whisperが「中田兵士/秀氏」と書き起こし）。正: なかたひでとし。1998秋' },
  { pattern: 'TSUNAMI', replacement: 'ツナミ', note: 'サザン『TSUNAMI』。アルファベット展開（ティーエスユー…）や英語読みを回避。災害文脈ではなく楽曲名として。1999冬' },
  // 2026-06-18 hideさんスポット試聴で検出（#9-12: 1997夏/1998秋/1999冬）
  { pattern: '白球', replacement: 'はっきゅう', note: '甲子園「白球の軌道」等。「しらきゅう」と誤読（正: はっきゅう）。1997夏' },
  { pattern: 'セリエア', replacement: 'セリエ・アー', note: 'サッカー セリエA。カタカナ「セリエア」を「せりええー」と崩す。イタリア式「アー」へ。1998秋' },
  { pattern: 'セリエA', replacement: 'セリエ・アー', note: 'アルファベットA表記の保険（A→英語「エー」読み回避）' },
  { pattern: '佐々木主浩', replacement: 'ささきかずひろ', note: '横浜・大魔神 佐々木主浩。「ささきぬしひろ」と誤読（主浩→かずひろ）。1998秋' },
  { pattern: '常盤貴子', replacement: 'ときわたかこ', note: '女優・常盤貴子。「じょうばんたかこ」と誤読（常盤→ときわ）。1999冬' },
  { pattern: '小渕恵三', replacement: 'おぶちけいぞう', note: '小渕恵三首相。「おぶちめざむ」と誤読（恵三→けいぞう）。1999冬' },
  // 2026-06-23 onyx焼き直し（Azure製11本）のwhisper-scanで確認
  { pattern: '布袋寅泰', replacement: 'ほていともやす', note: 'ミュージシャン布袋寅泰。onyxが「ヌボクロ・トライアス」と漢字総崩れ。1990春' },
  { pattern: '布袋', replacement: 'ほてい', note: '単独の「布袋」フォールバック（布袋寅泰の後に配置）。「ぬのくろ」系の誤読回避' },
  { pattern: '森喜朗', replacement: 'もりよしろう', note: '森喜朗首相。「喜朗→よしろう」が読めず「もりきろう/もりたかろう」に化ける。2000春・冬' },
  { pattern: '吉川晃司', replacement: 'きっかわこうじ', note: 'ミュージシャン吉川晃司。「晃司→あきり」等に化ける（布袋寅泰の再TTS時に判明）。正: きっかわこうじ。1990春' },
  // 2026-07-06 S3焼き直しのwhisper-scanで確認
  { pattern: '槇原寛己', replacement: 'まきはらひろみ', note: '巨人の投手・槇原寛己。「寛己→かんき」等に化ける（1985春S3焼き直しで判明）' },
  { pattern: '渡辺久信', replacement: 'わたなべひさのぶ', note: '西武の投手・渡辺久信。「くさのぶ」等の読み揺れ（1986春S3焼き直しで判明）' },
  { pattern: '最高値', replacement: 'さいたかね', note: '相場用語。「さいこうち/さいこうきん」に化ける（1990冬S3焼き直しで判明）。価格文脈では常に「さいたかね」' },
  // 2026-07-09 オンデマンド生成（hideさん試聴・1992）で確認。誤読ログ docs/ONDEMAND_MISREADING_LOG.md 参照
  { pattern: '加藤登紀子', replacement: 'かとうときこ', note: '歌手・加藤登紀子。「登紀子→のぼり子」と誤読（登=のぼり）。オンデマンド1992' },
  { pattern: '古賀稔彦', replacement: 'こがとしひこ', note: '柔道・古賀稔彦（1992バルセロナ金・平成の三四郎）。「稔彦」が読めず破綻。オンデマンド1992' },
  // 2026-07-17 ショート初弾の試聴（hideさん）で確認
  { pattern: '西灘', replacement: 'にしなだ', note: '阪神電鉄・西灘駅（神戸市灘区）。読めず「やがたにやがたにした、にしなん」と破綻＝原稿に無い音を挿入していた（1995春seg1）。正: にしなだ（阪神電鉄公式）' },
  // 2026-07-22 ショート試写（hideさん）で確認。どちらも固有名詞ではなく**普通の語の脱落・誤読**で、
  // 原稿は正しいのに音だけがずれる型。単独では過剰置換が怖いので助詞まで含めて文脈を限定する。
  { pattern: '高さまで', replacement: 'たかさまで', note: '「約十メートルの高さまでジャッキで」で「たかまで」と“さ”が脱落（1995春seg1）。高さ単独は文脈が広いので「高さまで」に限定' },
  { pattern: 'ネクタイ', replacement: 'ねくたい', note: '「ネクタイを緩めた男」で「ねくたく」と誤読（1990冬seg1）。カタカナのまま送ると語末が濁る' },
  // 2026-07-22 v2 hideさん試聴（#11）。「日本」という最も基本的な語でも誤読が起きる＝
  // 難読語だけを疑うのでは足りない。過剰置換を避けるため助詞まで含めて文脈を限定する。
  { pattern: '日本のどこかの', replacement: 'にほんのどこかの', note: '「毎朝、日本のどこかの家庭で」で「にんぎょのどこかの」と誤読（1995春seg3）。日本単独は出現が多すぎるので文脈限定' },
  // 2026-07-24 日付の読みを機械的に守る（hideさん試聴で公開済みエピソードに3件の誤読が確定）
  //   日の読みは不規則（1=ついたち／4=よっか／20=はつか／24=にじゅうよっか）で、TTSは月・日の両方を壊す:
  //     九月二十四日 → 「くがつ じゅうに じゅうよっか」（2000秋 seg1・公開済み）
  //     一月二十七日 → 「いちがく にち にじゅうしちにち」（1995冬 seg2・公開済み）
  //   台本は正しいので校正では見つからず、音を聴くまで分からない。カタログに87箇所あり全部は聴けない。
  //   → 月を先にかな化し、続けて日をかな化する（**この順序に依存**。日の規則は直前の「がつ」を目印にする）。
  //   月は「漢数字の日が続くとき」だけに限定＝「一月」単体（月名としての言及）には触らない。
  //   ⚠️ 日の前に中黒を入れるのが要（2026-07-24 実測）。「くがつにじゅうよっか」は「がつ」の直後の
  //     「に」を助詞と解釈して「くがつに／じゅうよっか」と割れる（3回中2回失敗）。中黒を入れると3/3成功。
  //     21〜29日は全て「に」始まり、10日「とおか」20日「はつか」も助詞と衝突しうるので全日付に入れる
  //     （しがつ・ついたち／くがつ・はつか／じゅうがつ・とおか／いちがつ・にじゅうしちにち／しがつ・いつか＝10/10成功）。
  //   検査は scripts/audit-dates.mjs（台本の日付の正しい読みが転写に出るかを見る）。
  { pattern: /十二月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'じゅうにがつ', note: '日付の月。単独の「十二月」は対象外' },
  { pattern: /十一月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'じゅういちがつ', note: '日付の月。単独の「十一月」は対象外' },
  { pattern: /十月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'じゅうがつ', note: '日付の月。単独の「十月」は対象外' },
  { pattern: /九月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'くがつ', note: '日付の月。単独の「九月」は対象外' },
  { pattern: /八月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'はちがつ', note: '日付の月。単独の「八月」は対象外' },
  { pattern: /七月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'しちがつ', note: '日付の月。単独の「七月」は対象外' },
  { pattern: /六月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'ろくがつ', note: '日付の月。単独の「六月」は対象外' },
  { pattern: /五月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'ごがつ', note: '日付の月。単独の「五月」は対象外' },
  { pattern: /四月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'しがつ', note: '日付の月。単独の「四月」は対象外' },
  { pattern: /三月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'さんがつ', note: '日付の月。単独の「三月」は対象外' },
  { pattern: /二月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'にがつ', note: '日付の月。単独の「二月」は対象外' },
  { pattern: /一月(?=[〇一二三四五六七八九十]{1,3}日)/g, replacement: 'いちがつ', note: '日付の月。単独の「一月」は対象外' },
  { pattern: /がつ三十一日/g, replacement: 'がつ・さんじゅういちにち', note: '31日の読み（月をかな化した後に効く）' },
  { pattern: /がつ三十日/g, replacement: 'がつ・さんじゅうにち', note: '30日の読み（月をかな化した後に効く）' },
  { pattern: /がつ二十九日/g, replacement: 'がつ・にじゅうくにち', note: '29日の読み（月をかな化した後に効く）' },
  { pattern: /がつ二十八日/g, replacement: 'がつ・にじゅうはちにち', note: '28日の読み（月をかな化した後に効く）' },
  { pattern: /がつ二十七日/g, replacement: 'がつ・にじゅうしちにち', note: '27日の読み（月をかな化した後に効く）' },
  { pattern: /がつ二十六日/g, replacement: 'がつ・にじゅうろくにち', note: '26日の読み（月をかな化した後に効く）' },
  { pattern: /がつ二十五日/g, replacement: 'がつ・にじゅうごにち', note: '25日の読み（月をかな化した後に効く）' },
  { pattern: /がつ二十四日/g, replacement: 'がつ・にじゅうよっか', note: '24日の読み（月をかな化した後に効く）' },
  { pattern: /がつ二十三日/g, replacement: 'がつ・にじゅうさんにち', note: '23日の読み（月をかな化した後に効く）' },
  { pattern: /がつ二十二日/g, replacement: 'がつ・にじゅうににち', note: '22日の読み（月をかな化した後に効く）' },
  { pattern: /がつ二十一日/g, replacement: 'がつ・にじゅういちにち', note: '21日の読み（月をかな化した後に効く）' },
  { pattern: /がつ二十日/g, replacement: 'がつ・はつか', note: '20日の読み（月をかな化した後に効く）' },
  { pattern: /がつ十九日/g, replacement: 'がつ・じゅうくにち', note: '19日の読み（月をかな化した後に効く）' },
  { pattern: /がつ十八日/g, replacement: 'がつ・じゅうはちにち', note: '18日の読み（月をかな化した後に効く）' },
  { pattern: /がつ十七日/g, replacement: 'がつ・じゅうしちにち', note: '17日の読み（月をかな化した後に効く）' },
  { pattern: /がつ十六日/g, replacement: 'がつ・じゅうろくにち', note: '16日の読み（月をかな化した後に効く）' },
  { pattern: /がつ十五日/g, replacement: 'がつ・じゅうごにち', note: '15日の読み（月をかな化した後に効く）' },
  { pattern: /がつ十四日/g, replacement: 'がつ・じゅうよっか', note: '14日の読み（月をかな化した後に効く）' },
  { pattern: /がつ十三日/g, replacement: 'がつ・じゅうさんにち', note: '13日の読み（月をかな化した後に効く）' },
  { pattern: /がつ十二日/g, replacement: 'がつ・じゅうににち', note: '12日の読み（月をかな化した後に効く）' },
  { pattern: /がつ十一日/g, replacement: 'がつ・じゅういちにち', note: '11日の読み（月をかな化した後に効く）' },
  { pattern: /がつ十日/g, replacement: 'がつ・とおか', note: '10日の読み（月をかな化した後に効く）' },
  { pattern: /がつ九日/g, replacement: 'がつ・ここのか', note: '9日の読み（月をかな化した後に効く）' },
  { pattern: /がつ八日/g, replacement: 'がつ・ようか', note: '8日の読み（月をかな化した後に効く）' },
  { pattern: /がつ七日/g, replacement: 'がつ・なのか', note: '7日の読み（月をかな化した後に効く）' },
  { pattern: /がつ六日/g, replacement: 'がつ・むいか', note: '6日の読み（月をかな化した後に効く）' },
  { pattern: /がつ五日/g, replacement: 'がつ・いつか', note: '5日の読み（月をかな化した後に効く）' },
  { pattern: /がつ四日/g, replacement: 'がつ・よっか', note: '4日の読み（月をかな化した後に効く）' },
  { pattern: /がつ三日/g, replacement: 'がつ・みっか', note: '3日の読み（月をかな化した後に効く）' },
  { pattern: /がつ二日/g, replacement: 'がつ・ふつか', note: '2日の読み（月をかな化した後に効く）' },
  { pattern: /がつ一日/g, replacement: 'がつ・ついたち', note: '1日の読み（月をかな化した後に効く）' },
  // 2026-08-20 hideさん実聴報告（公開済みエピソードの誤読3件）
  { pattern: '木梨憲武', replacement: 'きなし・のりたけ', note: 'とんねるず木梨憲武。誤読報告（hideさん実聴・1988秋）' },
  { pattern: '男闘呼組', replacement: 'おとこぐみ', note: 'ジャニーズ男闘呼組。「おとていぐみ」系に崩れた（hideさん実聴・1988秋）' },
  { pattern: '桑田佳祐', replacement: 'くわた・けいすけ', note: 'サザン桑田佳祐。誤読報告（hideさん実聴・2000春/1990夏いずれか）' },
  // 2026-09-17 hideさん実聴報告（有料会員の通し確認で作った1993秋の回＝オンデマンド生成・人の確認が入らない経路）
  { pattern: '三浦知良', replacement: 'みうら・かずよし', note: 'サッカー三浦知良。「みうらちら」と読まれた（ミドルトーク1・1993秋 KB）' },
  { pattern: '柴門ふみ', replacement: 'さいもん・ふみ', note: '漫画家・柴門ふみ（ペンネームはポール・サイモン由来）。「しばもんふみ」と読まれた（ミドルトーク2・1993秋 KB）' },
  { pattern: '小林聡美', replacement: 'こばやし・さとみ', note: '俳優・小林聡美（十六茶CM）。「こばやしそうみ」と読まれた（ミドルトーク2・1993秋 KB）' },
  // 2026-09-17 公開25セルの知識ベースにある人名の読みを先回りで登録（オンデマンド生成は人の聞き直しが無い）。
  // 抽出＝KB 25ファイル全件→読み誤りやすい候補を、Wikipedia／コトバンク／公式プロフィールで1件ずつ裏取り。
  // 直後に漢字が続くときは置き換えない（「岡田弘子」の中の「岡田弘」等を誤って置き換えないため）。
  { pattern: /鹿賀丈史(?![一-龠々])/g, replacement: 'かが・たけし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /三重野康(?![一-龠々])/g, replacement: 'みえの・やすし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /中尊寺ゆつこ(?![一-龠々])/g, replacement: 'ちゅうそんじ・ゆつこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /久保田利伸(?![一-龠々])/g, replacement: 'くぼた・としのぶ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /槇原敬之(?![一-龠々])/g, replacement: 'まきはら・のりゆき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /辛島美登里(?![一-龠々])/g, replacement: 'からしま・みどり', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /奥田民生(?![一-龠々])/g, replacement: 'おくだ・たみお', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /岡村靖幸(?![一-龠々])/g, replacement: 'おかむら・やすゆき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /荻野目洋子(?![一-龠々])/g, replacement: 'おぎのめ・ようこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /土田正顕(?![一-龠々])/g, replacement: 'つちだ・まさあき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /宇野宗佑(?![一-龠々])/g, replacement: 'うの・そうすけ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /岸谷香(?![一-龠々])/g, replacement: 'きしたに・かおり', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /奥居香(?![一-龠々])/g, replacement: 'おくい・かおり', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /近藤房之助(?![一-龠々])/g, replacement: 'こんどう・ふさのすけ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /坪倉唯子(?![一-龠々])/g, replacement: 'つぼくら・ゆいこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /三浦徳子(?![一-龠々])/g, replacement: 'みうら・よしこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /浜田雅功(?![一-龠々])/g, replacement: 'はまだ・まさとし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /森下裕美(?![一-龠々])/g, replacement: 'もりした・ひろみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /破矢ジンタ(?![一-龠々])/g, replacement: 'はし・ジンタ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /前田亘輝(?![一-龠々])/g, replacement: 'まえだ・のぶてる', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /春畑道哉(?![一-龠々])/g, replacement: 'はるはた・みちや', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /桜井敦司(?![一-龠々])/g, replacement: 'さくらい・あつし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /櫻井敦司(?![一-龠々])/g, replacement: 'さくらい・あつし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /上沼恵美子(?![一-龠々])/g, replacement: 'かみぬま・えみこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /草野満代(?![一-龠々])/g, replacement: 'くさの・みつよ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /村山富市(?![一-龠々])/g, replacement: 'むらやま・とみいち', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /深作欣二(?![一-龠々])/g, replacement: 'ふかさく・きんじ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /岡野昭仁(?![一-龠々])/g, replacement: 'おかの・あきひと', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /鬼束ちひろ(?![一-龠々])/g, replacement: 'おにつか・ちひろ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /草彅剛(?![一-龠々])/g, replacement: 'くさなぎ・つよし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /堤幸彦(?![一-龠々])/g, replacement: 'つつみ・ゆきひこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /真保裕一(?![一-龠々])/g, replacement: 'しんぽ・ゆういち', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /原恵一(?![一-龠々])/g, replacement: 'はら・けいいち', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /原貢(?![一-龠々])/g, replacement: 'はら・みつぐ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /岡田弘(?![一-龠々])/g, replacement: 'おかだ・ひろむ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /松岡充(?![一-龠々])/g, replacement: 'まつおか・みつる', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /伴都美子(?![一-龠々])/g, replacement: 'ばん・とみこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /松浦勝人(?![一-龠々])/g, replacement: 'まつうら・まさと', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /新藤晴一(?![一-龠々])/g, replacement: 'しんどう・はるいち', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /小出義雄(?![一-龠々])/g, replacement: 'こいで・よしお', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /坂口博信(?![一-龠々])/g, replacement: 'さかぐち・ひろのぶ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /井原正巳(?![一-龠々])/g, replacement: 'いはら・まさみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /ラモス瑠偉(?![一-龠々])/g, replacement: 'ラモス・るい', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /久保尚志(?![一-龠々])/g, replacement: 'くぼ・たかし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /近藤喜文(?![一-龠々])/g, replacement: 'こんどう・よしふみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /板尾創路(?![一-龠々])/g, replacement: 'いたお・いつじ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /蔵野孝洋(?![一-龠々])/g, replacement: 'くらの・たかひろ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /小林武史(?![一-龠々])/g, replacement: 'こばやし・たけし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /林田健司(?![一-龠々])/g, replacement: 'はやしだ・けんじ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /宮沢和史(?![一-龠々])/g, replacement: 'みやざわ・かずふみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /池森秀一(?![一-龠々])/g, replacement: 'いけもり・しゅういち', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /浅岡雄也(?![一-龠々])/g, replacement: 'あさおか・ゆうや', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /豊川悦司(?![一-龠々])/g, replacement: 'とよかわ・えつし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /本名陽子(?![一-龠々])/g, replacement: 'ほんな・ようこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /朝本浩文(?![一-龠々])/g, replacement: 'あさもと・ひろふみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /椎名桔平(?![一-龠々])/g, replacement: 'しいな・きっぺい', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /水橋文美江(?![一-龠々])/g, replacement: 'みずはし・ふみえ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /江角マキコ(?![一-龠々])/g, replacement: 'えすみ・マキコ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /草刈民代(?![一-龠々])/g, replacement: 'くさかり・たみよ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /周防正行(?![一-龠々])/g, replacement: 'すおう・まさゆき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /信本敬子(?![一-龠々])/g, replacement: 'のぶもと・けいこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /土屋昌巳(?![一-龠々])/g, replacement: 'つちや・まさみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /長岡秀星(?![一-龠々])/g, replacement: 'ながおか・しゅうせい', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /氷室京介(?![一-龠々])/g, replacement: 'ひむろ・きょうすけ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /藤井郁弥(?![一-龠々])/g, replacement: 'ふじい・ふみや', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /鶴久政治(?![一-龠々])/g, replacement: 'つるく・まさはる', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /飛鳥涼(?![一-龠々])/g, replacement: 'あすか・りょう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /野村宏伸(?![一-龠々])/g, replacement: 'のむら・ひろのぶ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /衣笠祥雄(?![一-龠々])/g, replacement: 'きぬがさ・さちお', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /三好鉄生(?![一-龠々])/g, replacement: 'みよし・てっせい', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /藤井尚之(?![一-龠々])/g, replacement: 'ふじい・なおゆき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /猪俣公章(?![一-龠々])/g, replacement: 'いのまた・こうしょう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /森祇晶(?![一-龠々])/g, replacement: 'もり・まさあき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /江副浩正(?![一-龠々])/g, replacement: 'えぞえ・ひろまさ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /麻生祐未(?![一-龠々])/g, replacement: 'あそう・ゆみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /鈴木保奈美(?![一-龠々])/g, replacement: 'すずき・ほなみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /大江千里(?![一-龠々])/g, replacement: 'おおえ・せんり', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /若尾文子(?![一-龠々])/g, replacement: 'わかお・あやこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /牧瀬里穂(?![一-龠々])/g, replacement: 'まきせ・りほ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /宮田和弥(?![一-龠々])/g, replacement: 'みやた・かずや', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /及川眠子(?![一-龠々])/g, replacement: 'おいかわ・ねこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /鈴木早智子(?![一-龠々])/g, replacement: 'すずき・さちこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /桜井和寿(?![一-龠々])/g, replacement: 'さくらい・かずとし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /大黒摩季(?![一-龠々])/g, replacement: 'おおぐろ・まき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /安達祐実(?![一-龠々])/g, replacement: 'あだち・ゆみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /古舘伊知郎(?![一-龠々])/g, replacement: 'ふるたち・いちろう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /和久井映見(?![一-龠々])/g, replacement: 'わくい・えみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /唐沢寿明(?![一-龠々])/g, replacement: 'からさわ・としあき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /岸谷五朗(?![一-龠々])/g, replacement: 'きしたに・ごろう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /山口智子(?![一-龠々])/g, replacement: 'やまぐち・ともこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /庵野秀明(?![一-龠々])/g, replacement: 'あんの・ひであき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /士郎正宗(?![一-龠々])/g, replacement: 'しろう・まさむね', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /田原成貴(?![一-龠々])/g, replacement: 'たばら・せいき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /葉加瀬太郎(?![一-龠々])/g, replacement: 'はかせ・たろう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /松野泰己(?![一-龠々])/g, replacement: 'まつの・やすみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /華原朋美(?![一-龠々])/g, replacement: 'かはら・ともみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /清春(?![一-龠々])/g, replacement: 'きよはる', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /森友嵐士(?![一-龠々])/g, replacement: 'もりとも・あらし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /上杉昇(?![一-龠々])/g, replacement: 'うえすぎ・しょう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /橋田壽賀子(?![一-龠々])/g, replacement: 'はしだ・すがこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /高嶋政伸(?![一-龠々])/g, replacement: 'たかしま・まさのぶ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /高橋克典(?![一-龠々])/g, replacement: 'たかはし・かつのり', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /今井寿(?![一-龠々])/g, replacement: 'いまい・ひさし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /成田昭次(?![一-龠々])/g, replacement: 'なりた・しょうじ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /前田耕陽(?![一-龠々])/g, replacement: 'まえだ・こうよう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /小山田圭吾(?![一-龠々])/g, replacement: 'おやまだ・けいご', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /篠田正浩(?![一-龠々])/g, replacement: 'しのだ・まさひろ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /長渕剛(?![一-龠々])/g, replacement: 'ながぶち・つよし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /榎木孝明(?![一-龠々])/g, replacement: 'えのき・たかあき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /海音寺潮五郎(?![一-龠々])/g, replacement: 'かいおんじ・ちょうごろう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /津川雅彦(?![一-龠々])/g, replacement: 'つがわ・まさひこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /安田成美(?![一-龠々])/g, replacement: 'やすだ・なるみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /斎藤雅樹(?![一-龠々])/g, replacement: 'さいとう・まさき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /藤田元司(?![一-龠々])/g, replacement: 'ふじた・もとし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /吉村禎章(?![一-龠々])/g, replacement: 'よしむら・さだあき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /礼宮文仁親王(?![一-龠々])/g, replacement: 'あやのみや・ふみひと・しんのう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /川嶋紀子(?![一-龠々])/g, replacement: 'かわしま・きこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /佐野史郎(?![一-龠々])/g, replacement: 'さの・しろう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /佐藤竹善(?![一-龠々])/g, replacement: 'さとう・ちくぜん', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /坂井泉水(?![一-龠々])/g, replacement: 'さかい・いずみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /織田哲郎(?![一-龠々])/g, replacement: 'おだ・てつろう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /長戸大幸(?![一-龠々])/g, replacement: 'ながと・だいこう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /一色紗英(?![一-龠々])/g, replacement: 'いっしき・さえ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /森山周一郎(?![一-龠々])/g, replacement: 'もりやま・しゅういちろう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /小野正利(?![一-龠々])/g, replacement: 'おの・まさとし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /吉田秀彦(?![一-龠々])/g, replacement: 'よしだ・ひでひこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /堺屋太一(?![一-龠々])/g, replacement: 'さかいや・たいち', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /大貫亜美(?![一-龠々])/g, replacement: 'おおぬき・あみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /鈴木蘭々(?![一-龠々])/g, replacement: 'すずき・らんらん', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /西川貴教(?![一-龠々])/g, replacement: 'にしかわ・たかのり', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /本広克行(?![一-龠々])/g, replacement: 'もとひろ・かつゆき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /権藤博(?![一-龠々])/g, replacement: 'ごんどう・ひろし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /松岡佑子(?![一-龠々])/g, replacement: 'まつおか・ゆうこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /中村勘九郎(?![一-龠々])/g, replacement: 'なかむら・かんくろう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /富野由悠季(?![一-龠々])/g, replacement: 'とみの・よしゆき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /折口雅博(?![一-龠々])/g, replacement: 'おりぐち・まさひろ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /鈴木英人(?![一-龠々])/g, replacement: 'すずき・えいじん', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /浅井博章(?![一-龠々])/g, replacement: 'あさい・ひろあき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /松平定知(?![一-龠々])/g, replacement: 'まつだいら・さだとも', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /北川悦吏子(?![一-龠々])/g, replacement: 'きたがわ・えりこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /筒井道隆(?![一-龠々])/g, replacement: 'つつい・みちたか', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /道場六三郎(?![一-龠々])/g, replacement: 'みちば・ろくさぶろう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /陳建一(?![一-龠々])/g, replacement: 'ちん・けんいち', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /石鍋裕(?![一-龠々])/g, replacement: 'いしなべ・ゆたか', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /大村雅朗(?![一-龠々])/g, replacement: 'おおむら・まさあき', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /尾崎亜美(?![一-龠々])/g, replacement: 'おざき・あみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /筒美京平(?![一-龠々])/g, replacement: 'つつみ・きょうへい', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /森高千里(?![一-龠々])/g, replacement: 'もりたか・ちさと', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /柴田恭兵(?![一-龠々])/g, replacement: 'しばた・きょうへい', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /小林稔侍(?![一-龠々])/g, replacement: 'こばやし・ねんじ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /樹木希林(?![一-龠々])/g, replacement: 'きき・きりん', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /寺内小春(?![一-龠々])/g, replacement: 'てらうち・こはる', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /磯村春子(?![一-龠々])/g, replacement: 'いそむら・はるこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /二又一成(?![一-龠々])/g, replacement: 'ふたまた・いっせい', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /保志信芳(?![一-龠々])/g, replacement: 'ほし・のぶよし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /北勝海(?![一-龠々])/g, replacement: 'ほくとうみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /阿木燿子(?![一-龠々])/g, replacement: 'あき・ようこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /後藤次利(?![一-龠々])/g, replacement: 'ごとう・つぐとし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /森雪之丞(?![一-龠々])/g, replacement: 'もり・ゆきのじょう', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /玉置浩二(?![一-龠々])/g, replacement: 'たまき・こうじ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /武部聡志(?![一-龠々])/g, replacement: 'たけべ・さとし', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /川村真澄(?![一-龠々])/g, replacement: 'かわむら・ますみ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /中島美春(?![一-龠々])/g, replacement: 'なかじま・みはる', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /康珍化(?![一-龠々])/g, replacement: 'かん・ちんふぁ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /馬飼野康二(?![一-龠々])/g, replacement: 'まかいの・こうじ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /麻生圭子(?![一-龠々])/g, replacement: 'あそう・けいこ', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
  { pattern: /貴乃花(?![一-龠々])/g, replacement: 'たかのはな', note: 'KB人名・9/17一括（Wikipedia/コトバンクで確認）' },
];

/**
 * テキストに誤読辞書を適用する。
 * string パターンはリテラル置換、RegExp パターンは正規表現置換。
 */
export function applyPronunciationDict(input: string): {
  output: string;
  applied: { pattern: string; count: number }[];
} {
  let output = input;
  const applied: { pattern: string; count: number }[] = [];

  for (const entry of PRONUNCIATION_DICT) {
    if (typeof entry.pattern === 'string') {
      const occurrences = countOccurrences(output, entry.pattern);
      if (occurrences > 0) {
        output = output.split(entry.pattern).join(entry.replacement);
        applied.push({ pattern: entry.pattern, count: occurrences });
      }
    } else {
      // RegExp: マッチ数を数えてから置換
      const matches = output.match(entry.pattern);
      const count = matches ? matches.length : 0;
      if (count > 0) {
        output = output.replace(entry.pattern, entry.replacement);
        applied.push({ pattern: entry.pattern.toString(), count });
      }
    }
  }

  return { output, applied };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}
