# 新しい声 F（Gemini Charon）で新しい回を作る道具（2026-10-29）

手順の正は redial の `docs/COVERAGE_RUN_LOG.md`「新しい声 F で作る新しい回」。ここはその道具だけ。
どれも timeslip-dj-gemini（この作業場）で、dev サーバー（`npm run dev -- --port 3100 --webpack`・.env.local に `TTS_PROVIDER=gemini` ほか）を立てて使う。
聞き取りの鍵は母体 `C:/Users/user/dev/timeslip-dj/.env.local` の OPENAI_API_KEY を読む（読み取りだけ）。

| 道具 | 何をするか |
|---|---|
| `verify-v1.mjs <slug>` | 直した台本（redial/data/scripts/<slug>-v1.json）に Layer3 をかけ直す |
| `resume-tts.mjs <slug> [--reuse 0=<archiveId>]` | 台本はそのまま、5区切りを読み上げて stockize まで（出来ている区切りは --reuse で使い回す） |
| `relisten3.mjs <archiveId> <出力.md>` | 区切りの全チャンクを gpt-4o-transcribe・whisper-1・gpt-4o-mini-transcribe で聞き直して並べる |
| `clip-listen.mjs <archiveId> <chunk> <語>` | その語のあたりの数秒を切り出して3種で聞き直す（人名の読みの確かめ） |
| `redo-chunk.mjs <archiveId> <chunk>` | そのチャンクだけ読み直す（辞書は呼んだ時点のものがかかる）。読み直したら必ず聞き直す |
| `make-preview.mjs <slug> <出力フォルダ>` | 語りを1本の mp3 に（曲の位置は短い合図音）＋台本の紙（時刻つき） |

- 台本だけ作る: `node scripts/batch-generate.mjs --targets <slug> --base http://localhost:3100 --critical-threshold -1`
- 読み直したら stockize し直す: `node scripts/stockize-episode.mjs --slug <slug> --seg0 <id> … --seg4 <id> --script ../redial/data/scripts/<slug>-v1.json`
- 🔴 Gemini は1日100回（日本時間16時に戻る）＝1本で約40〜60回。人名は読ませる前に `lib/tts-pronunciation-dict.ts` へ
