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
  { pattern: '月九', replacement: 'げつく', note: '「月9」の漢字表記。月九・げつく' },
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
