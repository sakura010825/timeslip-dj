// Layer 3 グラウンディング検証の実測ハーネス（使い捨て・node直実行）
// 本体 lib/grounding-verifier.ts と同一プロンプト・同一モデルで捕捉率を測る。
// 実行: env -u ANTHROPIC_API_KEY node C:/Users/user/dev/timeslip-dj/scripts/test-grounding.mjs
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

const TIMESLIP = 'C:/Users/user/dev/timeslip-dj';
const REDIAL = 'C:/Users/user/dev/redial';
const MODEL = 'claude-sonnet-4-6';

// --- .env.local から ANTHROPIC_API_KEY を明示ロード（素のnodeはNextのenv自動読込が無い） ---
function loadKey() {
  if (process.env.ANTHROPIC_API_KEY) return; // env -u 後は空なので基本ここを通らない
  const txt = readFileSync(`${TIMESLIP}/.env.local`, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) {
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env.ANTHROPIC_API_KEY = v;
    }
  }
}
loadKey();
console.log('[key] ANTHROPIC_API_KEY length:', (process.env.ANTHROPIC_API_KEY || '').length);

// --- 知識ベース（真実源）を絶対パスで直読み ---
const kb = JSON.parse(readFileSync(`${REDIAL}/data/knowledge/2000-autumn.json`, 'utf8'));
const items = kb.items;
console.log('[kb] 2000-autumn items:', items.length);

// --- grounding-verifier.ts と同一のプロンプト ---
const VERIFIER_SYSTEM = `あなたは厳密な事実検証官です。与えられた【素材】だけを唯一の真実源とみなします。素材の外にあるあなた自身の知識を、真実の根拠として使ってはいけません。素材に書かれていないことは「根拠なし」として扱います。`;

function materialsBlock(items) {
  return items
    .map((it) => `- [${it.category}/${it.month}月] ${it.title}\n  事実: ${it.oneLiner}\n  文脈: ${it.context}\n  キーワード: ${(it.keywords || []).join('、')}`)
    .join('\n');
}

function verifierPrompt(scriptText, items) {
  return `次の【台本】を検査し、【素材】に根拠を持たない主張をすべて挙げてください。

【判定基準】
- 台本中の固有名詞・人物名・配役・日付・出来事・数値・歌詞のうち、
  素材に書かれていない、または素材と矛盾するもの → ungrounded として挙げる
- severity の付け方:
  - critical: 人物・配役・固有名詞の事実主張／日付・数値／楽曲の歌詞の引用。
    （例: 素材にない人物を登場させる、配役を取り違える、歌詞を引用する、素材と違う日付を言う）
  - minor: 素材にない一般的な時代背景の補足説明（特定の固有事実は断定していないもの）
- 次のものは ungrounded として挙げない（対象外）:
  - 情緒・季節・天候・街の空気・身体感覚など、特定の事実を主張しない描写
  - 「〜だった気がする」「覚えていますか」等の主観・回想の枠付け
  - 素材に明記された事実の言い換え・要約

【素材】（この年×季節の知識ベース・唯一の真実源）
${materialsBlock(items)}

【台本】
${scriptText}

【出力（このJSONのみ・前後に説明文を付けない）】
{
  "ungrounded": [
    { "claim": "<台本中の根拠なき主張>", "severity": "critical", "reason": "<素材に無い/矛盾 等の理由>" }
  ]
}
根拠なき主張が一つも無ければ {"ungrounded": []} を返してください。`;
}

function extractJson(text) {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) return JSON.parse(fence[1]);
  const f = t.indexOf('{'), l = t.lastIndexOf('}');
  if (f >= 0 && l > f) return JSON.parse(t.substring(f, l + 1));
  return JSON.parse(t);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function verify(scriptText) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [{ type: 'text', text: VERIFIER_SYSTEM }],
    messages: [{ role: 'user', content: verifierPrompt(scriptText, items) }],
  });
  const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  let ung = [];
  try {
    const p = extractJson(raw);
    if (Array.isArray(p.ungrounded)) ung = p.ungrounded;
  } catch {
    return { critical: 0, minor: 0, ungrounded: [], raw, parseFail: true };
  }
  return {
    critical: ung.filter((u) => u.severity === 'critical').length,
    minor: ung.filter((u) => u.severity === 'minor').length,
    ungrounded: ung,
  };
}

// --- テストケース ---
let stockSeg1 = '';
try {
  stockSeg1 = readFileSync(`${REDIAL}/data/stock/2000-autumn/scripts/seg1-middle-talk-1.txt`, 'utf8');
} catch {}

const cases = [
  {
    name: '負例1: 配役捏造（所ジョージ ← 正は堤真一）',
    expect: 'critical>=1',
    script: '月曜九時、松嶋菜々子と所ジョージの『やまとなでしこ』が始まって。あの毒舌と不器用な誠実さに、街は沸いていました。',
  },
  {
    name: '負例2: 歌詞捏造（サウダージの歌詞を引用）',
    expect: 'critical>=1',
    script: 'ポルノグラフィティのサウダージ。「君のいない夜を超えて、僕はまた歩き出すよ」と歌うあのサビが、夜の街に滲んでいた頃です。',
  },
  {
    name: '負例3: 主題歌の取り違え（宇多田ヒカル ← 正はMISIA）',
    expect: 'critical>=1',
    script: 'やまとなでしこの主題歌、宇多田ヒカルのあの曲が、テレビをつけるたびに流れていました。',
  },
  {
    name: '正例: 素材忠実（堤真一・高橋尚子・鬼束ちひろ）',
    expect: 'critical==0',
    script: '月曜九時、松嶋菜々子と堤真一の『やまとなでしこ』。高橋尚子が女子マラソンで金メダルを取った秋でした。夜のラジオでは、鬼束ちひろの月光が一際刺さった。',
  },
];
if (stockSeg1) {
  cases.push({
    name: '参考: 既存stock seg1（Layer2なし生成＋人手fact-check済）→ 素材外主張のbefore値',
    expect: '(参考)',
    script: stockSeg1,
  });
}

const t0 = Date.now();
for (const c of cases) {
  const r = await verify(c.script);
  console.log(`\n== ${c.name} ==`);
  console.log(`   expect: ${c.expect}  →  critical=${r.critical} minor=${r.minor}${r.parseFail ? ' (PARSE FAIL)' : ''}`);
  for (const u of r.ungrounded) console.log(`     [${u.severity}] ${u.claim}  ── ${u.reason}`);
}
console.log(`\n[done] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
