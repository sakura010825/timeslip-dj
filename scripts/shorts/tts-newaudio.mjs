// 2026-10-01 新作の読み上げ: 本編と同じ順（sanitizeForTTS → runTTSPipeline）。
// 使い方: node --env-file=.env.local --import ./scripts/shorts/tts-newaudio-register.mjs scripts/shorts/tts-newaudio.mjs <原稿.txt> <out.mp3>
// 読み上げ後は頭と尻に0.4秒の無音を足す（ffmpeg adelay=400:all=1,apad=pad_dur=0.4）＝一音目がフェードで細くならない。
// 使い方: node --env-file=C:/Users/user/dev/timeslip-dj/.env.local --import ./register.mjs tts-one.mjs <text.txt> <out.mp3>
// 本編と同じ順（sanitizeForTTS → runTTSPipeline）で読み上げる。
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const [inFile, outFile] = process.argv.slice(2);
const { sanitizeForTTS } = await import(pathToFileURL("C:/Users/user/dev/timeslip-dj/lib/tts-sanitize.ts").href);
const { runTTSPipeline, TTS_PROVIDER, TTS_MODEL, TTS_VOICE } = await import(pathToFileURL("C:/Users/user/dev/timeslip-dj/lib/tts-pipeline.ts").href);
const text = fs.readFileSync(inFile, "utf8").trim();
const { clean, warnings } = sanitizeForTTS(text);
console.log(`provider=${TTS_PROVIDER} model=${TTS_MODEL} voice=${TTS_VOICE}`);
if (warnings.length) console.log("sanitize:", warnings.join(" / "));
console.log("clean:", clean);
const r = await runTTSPipeline(clean, { generationId: null });
fs.writeFileSync(outFile, r.mp3);
console.log(`ok: ${r.totalChunks} chunks, ${r.totalAttempts} attempts, ${r.mp3.length} bytes`);
