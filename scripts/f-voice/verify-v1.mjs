// 直した台本（v1.json）に Layer3（/api/verify-grounding）をかけ直す（読み取りだけ）
// 使い方: node verify-v1.mjs <slug> [--base http://localhost:3100]
import fs from "node:fs";
import http from "node:http";
const slug = process.argv[2];
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3100";
const [year, season] = slug.split("-");
const v = JSON.parse(fs.readFileSync(`C:/Users/user/dev/redial/data/scripts/${slug}-v1.json`, "utf8"));
const scriptText = v.segments.map((s) => s.script).join("\n\n");
const body = Buffer.from(JSON.stringify({ year: Number(year), season, scriptText }), "utf8");
const u = new URL(`${base}/api/verify-grounding`);
const res = await new Promise((resolve, reject) => {
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": body.length } }, (r) => {
    let t = ""; r.setEncoding("utf8"); r.on("data", (c) => (t += c)); r.on("end", () => resolve(JSON.parse(t)));
  });
  req.on("error", reject); req.setTimeout(10 * 60 * 1000); req.write(body); req.end();
});
console.log(`critical ${res.criticalCount} / minor ${res.minorCount}`);
for (const x of res.ungrounded ?? []) console.log(`- [${x.severity}] ${x.claim} ── ${x.reason}`);
