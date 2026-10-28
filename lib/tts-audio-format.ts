/**
 * 番組の音声（MP3）の書き出し形式と、バイト数からの尺の概算（2026-10-28）。
 *
 * なぜ分けたか:
 *   これまで尺は「バイト数 ÷ 16384」（128kbps 前提）で、tts-pipeline・tts-verifier・/api/tts・/api/tts/chunk の
 *   4か所に同じ数が書かれていた。新しい声（Gemini・F）の回は保存の枠（Vercel Blob の無料枠 1GB）に収めるため
 *   64kbps で書き出す（hide 決定 10/28）ので、128kbps 前提のままだと尺が半分に出る。1か所にまとめた。
 *
 * TTS_BITRATE_KBPS 未設定なら今までどおり 128（会員の番組づくり・既存の回は1バイトも変わらない）。
 */
export const TTS_BITRATE_KBPS = Number(process.env.TTS_BITRATE_KBPS ?? 128) || 128;

/** 1秒あたりのバイト数。128kbps だけは既存の慣例値 16384 を保つ（過去の meta.json と数字を揃える）。 */
export function mp3BytesPerSecond(kbps: number = TTS_BITRATE_KBPS): number {
  return kbps === 128 ? 16384 : kbps * 125;
}

/** mp3 のバイト数から秒数を概算する（固定ビットレート・モノラル前提）。 */
export function estimateMp3Seconds(bytes: number, kbps: number = TTS_BITRATE_KBPS): number {
  return +(bytes / mp3BytesPerSecond(kbps)).toFixed(1);
}
