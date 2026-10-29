// 1つの区切り（チャンク）だけを読み直す（/api/tts/chunk・辞書は呼んだ時点のものがかかる）
// 使い方: node redo-chunk.mjs <archiveId> <chunkIndex> [--base http://localhost:3100]
import fs from "node:fs";
const [id, idx] = process.argv.slice(2);
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3100";
const meta = JSON.parse(fs.readFileSync(`C:/Users/user/dev/timeslip-dj-gemini/.tts-archive/${id}/meta.json`, "utf8"));
const c = meta.chunks[Number(idx)];
const r = await fetch(`${base}/api/tts/chunk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archiveId: id, chunkIndex: Number(idx), newText: c.text }) });
const j = await r.json();
if (!r.ok) { console.log(`失敗 ${r.status}: ${JSON.stringify(j).slice(0, 400)}`); process.exit(1); }
console.log(`読み直した ${id}[${idx}]（${j.ttsMs}ms）: ${j.chunks[Number(idx)].text}`);
