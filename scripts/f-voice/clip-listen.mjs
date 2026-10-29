// 区切りの中の、ある語のあたり（whisper-1 の区間の時刻で探す）を切り出して3つの聞き取りで聞く（読み取りだけ）
// 使い方: node clip-listen.mjs <archiveId> <chunkIndex> <区間に含まれる語>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const env = {};
for (const line of fs.readFileSync("C:/Users/user/dev/timeslip-dj/.env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const [id, idx, word] = process.argv.slice(2);
const src = `C:/Users/user/dev/timeslip-dj-gemini/.tts-archive/${id}/chunks/chunk-${String(idx).padStart(3, "0")}.mp3`;
async function tr(file, model, extra = {}) {
  const fd = new FormData();
  fd.append("file", new Blob([fs.readFileSync(file)], { type: "audio/mpeg" }), "a.mp3");
  fd.append("model", model);
  fd.append("language", "ja");
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: fd });
  return r.json();
}
const vj = await tr(src, "whisper-1", { response_format: "verbose_json" });
const seg = (vj.segments ?? []).find((s) => s.text.includes(word));
if (!seg) { console.log("見つからない:", (vj.segments ?? []).map((s) => s.text).join(" / ")); process.exit(1); }
const out = path.join(os.tmpdir(), "f-voice-clip.mp3");
const ss = Math.max(0, seg.start - 0.3), dur = seg.end - seg.start + 0.6;
execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(ss), "-t", String(dur), "-i", src, out]);
console.log(`区間 ${ss.toFixed(1)}〜${(ss + dur).toFixed(1)}秒: ${seg.text}`);
for (const model of ["gpt-4o-transcribe", "whisper-1", "gpt-4o-mini-transcribe"]) console.log(`${model}: ${(await tr(out, model)).text}`);
