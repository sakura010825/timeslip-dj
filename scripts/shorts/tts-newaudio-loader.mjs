// timeslip-dj の TS を素の node で読むためのローダー（@/x → timeslip-dj/x.ts、拡張子なしの相対 import → .ts）
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";
const ROOT = "C:/Users/user/dev/timeslip-dj";
function tryTs(base) {
  for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) if (existsSync(c)) return pathToFileURL(c).href;
  return null;
}
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) { const h = tryTs(path.join(ROOT, spec.slice(2))); if (h) return next(h, ctx); }
  if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL && /\.tsx?$/.test(ctx.parentURL) && !/\.[a-z]+$/i.test(spec)) {
    const h = tryTs(path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec)); if (h) return next(h, ctx);
  }
  return next(spec, ctx);
}
