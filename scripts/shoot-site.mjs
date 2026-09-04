/**
 * 本番サイトを「実機の画面条件」で撮る（2026-09-04・広告V1の素材用）。
 *
 * なぜ CDP なのか:
 *   `chrome --headless --screenshot --window-size=375,N` は、**指定より広くレイアウトして
 *   375px ぶんだけ切り出す**。右端が黙って欠ける（CTAボタンと『硝子の少年』が切れているのを
 *   フレーム実測で発見）。広告素材に「切れた自社サイト」を出すと、それ自体が信用を削る。
 *   Emulation.setDeviceMetricsOverride で幅・DPR・mobile を明示すれば、実機と同じ折返しになる。
 *
 * usage:
 *   node scripts/shoot-site.mjs <url> <out.png> [--width 375] [--dpr 3] [--full]
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [url, out] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
if (!url || !out) {
  console.error('使い方: node scripts/shoot-site.mjs <url> <out.png> [--width 375] [--dpr 3] [--full]');
  process.exit(1);
}
const WIDTH = Number(arg('width', '375'));
const DPR = Number(arg('dpr', '3'));
const FULL = process.argv.includes('--full');
const PORT = 9333;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('chrome.exe が見つかりません'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = () => { try { chrome.kill(); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('DevTools に繋がりません');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

try {
  await waitForDevtools();
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const cdp = new Cdp(ws);

  // ⚠️ mobile:true は Chrome の文字自動拡大（Font Boosting）が効いて、実機と違う大きさで折り返す
  //    （2026-09-04 実測: 幅375で見出しが枠から溢れた）。幅だけ効かせたいので mobile:false。
  const metricsOverride = { width: WIDTH, height: 812, deviceScaleFactor: DPR, mobile: false };
  await cdp.send('Emulation.setDeviceMetricsOverride', metricsOverride);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url });
  await sleep(4500); // ネットワーク待ち（画像・フォント）
  // ⚠️ ナビゲーションで上書きが外れることがある（2026-09-04 実測: 幅が効かず、
  //    広いレイアウトの左375pxだけを切り出した絵になっていた）。**遷移後にもう一度掛ける**。
  await cdp.send('Emulation.setDeviceMetricsOverride', metricsOverride);
  await sleep(800);
  const check = await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({w:document.documentElement.clientWidth,h:document.body.scrollHeight})',
    returnByValue: true,
  });
  const seen = JSON.parse(check.result.value);
  if (seen.w !== WIDTH) throw new Error(`幅の上書きが効いていません（期待 ${WIDTH} / 実際 ${seen.w}）`);

  const metrics = await cdp.send('Page.getLayoutMetrics');
  const h = Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height);
  // ⚠️ clip.scale は deviceScaleFactor に**上乗せ**される（2026-09-04 実測: 両方に DPR を
  //    渡して 375css が 1500px になり、750px のつもりで切り出して左半分だけを使っていた）。
  //    密度は deviceScaleFactor が持つので、clip 側は等倍にする。
  const clip = FULL
    ? { x: 0, y: 0, width: WIDTH, height: h, scale: 1 }
    : { x: 0, y: 0, width: WIDTH, height: 812, scale: 1 };
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`✅ ${out}  ${WIDTH}css×${FULL ? h : 812}css @${DPR}x  = ${WIDTH * DPR}×${(FULL ? h : 812) * DPR}px`);
  ws.close();
} finally {
  cleanup();
}
