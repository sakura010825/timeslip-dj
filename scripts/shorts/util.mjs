/**
 * ショート生成CLI 共通ユーティリティ（自己完結・依存なし）
 * 設計: redial/docs/SHORTS_CLI_DESIGN_2026-07.md
 */
import path from 'node:path';
import fs from 'node:fs';

export const CWD = process.cwd();
export const REDIAL_ROOT = path.resolve(CWD, '..', 'redial');
export const STOCK_ROOT = path.resolve(REDIAL_ROOT, 'data', 'stock');
export const OUT_ROOT = path.resolve(CWD, 'output', 'shorts');
export const CACHE_ROOT = path.resolve(OUT_ROOT, '.cache');
export const FONTS_DIR = path.resolve(CWD, 'assets', 'shorts', 'fonts');
export const BG_DIR = path.resolve(CWD, 'assets', 'shorts', 'backgrounds');

/** `--flag value` / `--flag=value` / boolean `--flag` を素朴にパース */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[a.slice(2)] = true;
      } else {
        out[a.slice(2)] = next;
        i++;
      }
    }
  }
  return out;
}

/**
 * 比較用正規化。ひらがな→カタカナ、句読点・空白・記号除去、小文字化。
 * timeslip-dj/lib/tts-verifier.ts の normalizeForCompare と同等（自己完結のため再実装）。
 */
export function normalizeForCompare(s) {
  let t = s ?? '';
  t = t.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  t = t.replace(/[、。！？!?,.:：;；…・「」『』（）()\[\]【】〈〉《》\s　]/g, '');
  return t.toLowerCase();
}

/** ファイル名用スラグ（日本語は保持しつつ危険文字だけ除去・空白→ハイフン） */
export function slugifyHook(s) {
  return (s ?? 'clip')
    .trim()
    .replace(/[\/\\:*?"<>|]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function fmtSec(n) {
  return `${n.toFixed(1)}s`;
}

/** seg秒 → ASSタイム `H:MM:SS.cc` */
export function assTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const cc = cs === 100 ? 99 : cs;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}
