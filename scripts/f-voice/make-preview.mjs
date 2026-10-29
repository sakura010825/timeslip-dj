// 新しい回の試聴用: 5つの語り（seg0〜4）を、曲の位置に短い合図音を挟んで1本の mp3 にし、台本と曲の順の紙を書く
// 使い方: node make-preview.mjs <slug> <出力フォルダ>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [slug, outDir] = process.argv.slice(2);
const stockDir = `C:/Users/user/dev/redial/data/stock/${slug}`;
const stock = JSON.parse(fs.readFileSync(`${stockDir}/stock.json`, "utf8"));
const v1 = JSON.parse(fs.readFileSync(`C:/Users/user/dev/redial/data/scripts/${slug}-v1.json`, "utf8"));
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(outDir, ".tmp-"));

// 曲の位置の合図（0.6秒の無音＋0.4秒の短い音＋0.6秒の無音）。曲そのものは試聴版には入れない
const cue = path.join(tmp, "cue.mp3");
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono:d=0.6", "-f", "lavfi", "-i", "sine=f=660:d=0.4:sample_rate=24000", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono:d=0.6", "-filter_complex", "[1]volume=0.15[s];[0][s][2]concat=n=3:v=0:a=1", "-c:a", "libmp3lame", "-b:a", "64k", cue]);

const segs = (stock.segments ?? []).slice().sort((a, b) => a.segmentIndex - b.segmentIndex);
const list = [];
const sheet = [`# ${slug} 試聴用（語りだけ・曲の位置は短い「ポーン」）`, ""];
let t = 0;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
for (const s of segs) {
  const file = s.audioFile ?? `seg${s.segmentIndex}-${s.segmentName}.mp3`;
  const p = `${stockDir}/segments/${file}`;
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", p]).toString().trim());
  const v = v1.segments?.[s.segmentIndex] ?? {};
  sheet.push(`## ${mmss(t)}〜 ${s.segmentLabel ?? v.segmentTitle ?? `seg${s.segmentIndex}`}（${mmss(dur)}）`, "", (v.script ?? "").trim(), "");
  list.push(`file '${p.replace(/'/g, "'\\''")}'`);
  t += dur;
  const song = s.songAfter;
  if (song) {
    sheet.push(`> ♪ ここで曲：${song.artist ?? ""}『${song.title ?? ""}』${song.videoId ? `（YouTube ${song.videoId}）` : "（動画なし）"}`, "");
    list.push(`file '${cue.replace(/'/g, "'\\''")}'`);
    t += 1.6;
  }
}
const listPath = path.join(tmp, "list.txt");
fs.writeFileSync(listPath, list.join("\n"), "utf8");
const outMp3 = path.join(outDir, `${slug}-talk-preview.mp3`);
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c:a", "libmp3lame", "-b:a", "64k", "-ar", "24000", "-ac", "1", outMp3]);
fs.writeFileSync(path.join(outDir, `${slug}-script.md`), sheet.join("\n"), "utf8");
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`試聴版 ${outMp3}（${mmss(t)}）／台本 ${slug}-script.md`);
