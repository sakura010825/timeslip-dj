// 1区切りの全チャンクを3つの聞き取り（gpt-4o・whisper-1・4o-mini）で聞き直して並べる（読み取りだけ）
// 人名は「3つが別の漢字を書く」ときに読み違いを疑う（feedback-f-voice-misreads-person-names）
// 使い方: node relisten3.mjs <archiveId> <outFile>
import fs from "node:fs";
const env = {};
for (const line of fs.readFileSync("C:/Users/user/dev/timeslip-dj/.env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const [id, outFile] = process.argv.slice(2);
const dir = `C:/Users/user/dev/timeslip-dj-gemini/.tts-archive/${id}`;
const meta = JSON.parse(fs.readFileSync(`${dir}/meta.json`, "utf8"));
async function tr(file, model) {
  const fd = new FormData();
  fd.append("file", new Blob([fs.readFileSync(file)], { type: "audio/mpeg" }), "a.mp3");
  fd.append("model", model);
  fd.append("language", "ja");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: fd });
  const j = await r.json();
  return j.text ?? JSON.stringify(j).slice(0, 200);
}
const out = [`### ${id}（${meta.estimatedDurationSec}秒・区切り${meta.chunkCount}・試行${meta.totalChunkAttempts}）`];
for (const c of meta.chunks) {
  const f = `${dir}/${c.mp3File}`;
  const [a, b, d] = await Promise.all([tr(f, "gpt-4o-transcribe"), tr(f, "whisper-1"), tr(f, "gpt-4o-mini-transcribe")]);
  out.push(`- [${c.index}] 試行${c.attempts}`, `  原稿: ${c.text}`, `  4o  : ${a}`, `  w1  : ${b}`, `  mini: ${d}`);
}
fs.appendFileSync(outFile, out.join("\n") + "\n\n", "utf8");
console.log(out.join("\n"));
