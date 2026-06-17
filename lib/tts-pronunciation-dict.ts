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
