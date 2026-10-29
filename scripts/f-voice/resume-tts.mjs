// batch-generate の [3/5] 以降だけをやり直す（台本＝redial/data/scripts/<slug>-v1.json はそのまま使う）
// 使い方（timeslip-dj の作業場で）: node scripts/f-voice/resume-tts.mjs <slug> [--base http://localhost:3100]
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";

const slug = process.argv[2];
const base = (process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3100").replace(/\/$/, "");
const [year, season] = slug.split("-");
const CWD = process.cwd();
const v1Path = path.resolve(CWD, "..", "redial", "data", "scripts", `${slug}-v1.json`);
const v1 = JSON.parse(fs.readFileSync(v1Path, "utf8"));

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": body.length } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(text); } catch { /* 下で扱う */ }
          if (res.statusCode >= 400 || !json) reject(new Error(`${url} → ${res.statusCode}: ${(json?.error ?? text).toString().slice(0, 400)}`));
          else resolve(json);
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(30 * 60 * 1000, () => req.destroy(new Error("timeout")));
    req.write(body);
    req.end();
  });
}

// --reuse 0=<archiveId>,1=<archiveId> … で、出来ている区切りは読み直さずに使う
const reuse = new Map();
if (process.argv.includes("--reuse")) {
  for (const kv of process.argv[process.argv.indexOf("--reuse") + 1].split(",")) {
    const [k, v] = kv.split("=");
    reuse.set(Number(k), v);
  }
}

console.log(`[3/5] TTS（${slug}・${base}）`);
const archiveIds = [];
for (let i = 0; i < v1.segments.length; i++) {
  const seg = v1.segments[i];
  if (reuse.has(i)) {
    archiveIds.push(reuse.get(i));
    console.log(`      seg${i} ${seg.segmentTitle} … 出来ている物を使う ${reuse.get(i)}`);
    continue;
  }
  const t0 = Date.now();
  process.stdout.write(`      seg${i} ${seg.segmentTitle} ... `);
  const tts = await postJson(`${base}/api/tts`, { text: seg.script, metadata: { segmentIndex: i, segmentTitle: seg.segmentTitle, year: Number(year), season } });
  archiveIds.push(tts.archiveId);
  const bad = (tts.chunks ?? []).filter((c) => !c.verification?.ok).length;
  console.log(`✓ ${tts.archiveId}（${tts.chunks?.length ?? "?"} 区切り・検査で残った不合格 ${bad}・${Math.round((Date.now() - t0) / 1000)}秒）`);
}
console.log("[4/5] stockize");
const args = [path.resolve(CWD, "scripts", "stockize-episode.mjs"), "--slug", slug];
archiveIds.forEach((id, i) => args.push(`--seg${i}`, id));
args.push("--script", v1Path);
execFileSync("node", args, { stdio: "inherit", cwd: CWD });
console.log(`完了: ${slug}`);
