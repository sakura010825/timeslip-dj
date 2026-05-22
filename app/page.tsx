'use client';

import { useState, useRef, useEffect } from 'react';
import YouTube from 'react-youtube';

type ChunkInfo = {
  index: number;
  text: string;
  mp3Bytes: number;
  mp3Url: string;
  attempts: number;
  paragraphBoundaryAfter: boolean;
  verification: { ok: boolean; reason?: string; similarity?: number; maxGap?: number; transcript?: string } | null;
  previousText?: string | null;
  editedAt?: string | null;
};

type SegmentArchive = {
  archiveId: string;
  outputUrl: string;
  outputBytes: number;
  pipelineMs?: number;
  warnings: string[];
  chunks: ChunkInfo[];
};

export default function Home() {
  const [year, setYear] = useState('1995');
  const [month, setMonth] = useState('8');
  const [segments, setSegments] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);

  // 編集ワークフロー: セグメントごとのTTSアーカイブ
  const [archives, setArchives] = useState<Record<number, SegmentArchive>>({});
  const [ttsGenerating, setTtsGenerating] = useState<Record<number, boolean>>({});
  const [editingChunk, setEditingChunk] = useState<{ segmentIndex: number; chunkIndex: number; text: string } | null>(null);
  const [regeneratingChunk, setRegeneratingChunk] = useState<{ segmentIndex: number; chunkIndex: number } | null>(null);

  const [mode, setMode] = useState<'youtube' | 'full'>('youtube');

  // コンテンツ生成タブ
  const [activeTab, setActiveTab] = useState<'program' | 'content'>('program');
  const [contentYear, setContentYear] = useState('1995');
  const [contentSeason, setContentSeason] = useState('autumn');
  const [masterData, setMasterData] = useState<any>(null);
  const [contentProgress, setContentProgress] = useState(0); // 0=idle, 1-4=batch
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);

  const CATEGORY_BATCHES = [
    ['MUSIC', 'TV-DRAMA', 'MOVIE-ANIME'],
    ['GAME', 'DIGITAL-GADGET', 'TOY'],
    ['NEWS', 'CM-ADS', 'FOOD-DRINK'],
    ['SPORTS', 'FASHION', 'CULTURE-SLANG'],
  ];

  const generateMaster = async () => {
    setIsGeneratingContent(true);
    setMasterData(null);
    setContentProgress(0);
    const allEntries: any[] = [];
    let meta: any = null;
    try {
      for (let i = 0; i < CATEGORY_BATCHES.length; i++) {
        setContentProgress(i + 1);
        const res = await fetch('/api/generate-master', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year: contentYear, season: contentSeason, categories: CATEGORY_BATCHES[i] }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (!meta) meta = data.metadata;
        allEntries.push(...(data.entries ?? []));
      }
      setMasterData({ metadata: meta, entries: allEntries });
    } catch (e) {
      console.error(e);
      alert('コンテンツの生成に失敗しました。');
    } finally {
      setIsGeneratingContent(false);
      setContentProgress(0);
    }
  };

  const downloadMaster = () => {
    if (!masterData) return;
    const blob = new Blob([JSON.stringify(masterData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `master_${contentYear}_${contentSeason}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<any>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PREVIEW_SECONDS = 30;
  const BGM_URL = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-17.mp3";

  useEffect(() => {
    bgmRef.current = new Audio(BGM_URL);
    bgmRef.current.loop = true;
    bgmRef.current.volume = 0.15; 
    
    return () => {
      bgmRef.current?.pause();
      bgmRef.current = null;
    };
  }, []);

  const monthToSeason = (m: number): string => {
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    if (m >= 9 && m <= 11) return 'autumn';
    return 'winter';
  };

  const downloadAudio = async (index: number) => {
    const archive = archives[index];
    if (!archive) return;
    const season = monthToSeason(Number(month));
    const filename = `${year}-${season}-seg${index + 1}.mp3`;
    // outputUrl は /api/tts-archive/.../output.mp3?t=... なので fetch して blob 経由でDL
    try {
      const res = await fetch(archive.outputUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed:', e);
      alert('ダウンロードに失敗しました');
    }
  };

  const downloadScript = () => {
    if (segments.length === 0) return;
    const season = monthToSeason(Number(month));
    const data = { year, month, season, segments };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${year}-${season}-script.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * 過去にダウンロードした script JSON をインポートして、segments を復元する。
   * 再生成せずに TTS〜編集〜ストック化に進めるための救済機能。
   */
  const importScript = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.segments) || data.segments.length === 0) {
        alert('インポート失敗: segments が空、または配列ではありません');
        return;
      }
      if (data.year) setYear(String(data.year));
      if (data.month) setMonth(String(data.month));
      setSegments(data.segments);
      setCurrentIndex(0);
      setCurrentVideoId(null);
      setArchives({});
      setTtsGenerating({});
      console.log(`[importScript] loaded ${data.segments.length} segments, year=${data.year}, month=${data.month}`);
    } catch (e) {
      console.error('[importScript] error:', e);
      alert(`インポート失敗: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  const generateProgram = async () => {
    setIsLoading(true);
    setSegments([]);
    setCurrentIndex(0);
    setCurrentVideoId(null);
    setArchives({});
    setTtsGenerating({});
    try {
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setSegments(data.segments);
    } catch (error) {
      console.error('Error:', error);
      alert('番組の生成に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  const playMusic = async (song: any) => {
    if (!song || !song.songTitle) return;
    try {
      const query = `${song.artistName} ${song.songTitle}`;
      const res = await fetch('/api/search-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: query,
          year,
          artistName: song.artistName,
          songTitle: song.songTitle,
        }),
      });
      const data = await res.json();
      if (data.videoId) {
        setCurrentVideoId(data.videoId);
      }
    } catch (error) {
      console.error("YouTube検索エラー:", error);
    }
  };

  const fadeBgmOut = (onComplete: () => void) => {
    const bgm = bgmRef.current;
    if (!bgm || bgm.paused) { onComplete(); return; }

    const FADE_DURATION = 1500; // ms
    const STEPS = 15;
    const interval = FADE_DURATION / STEPS;
    const initialVolume = bgm.volume;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      bgm.volume = Math.max(0, initialVolume * (1 - step / STEPS));
      if (step >= STEPS) {
        clearInterval(timer);
        bgm.pause();
        bgm.volume = initialVolume; // 次回のために音量を戻す
        onComplete();
      }
    }, interval);
  };

  /**
   * セグメントのTTSをまだ未生成なら生成して archives に保存。
   * 既に生成済みなら何もしない。
   */
  const ensureTTS = async (index: number): Promise<SegmentArchive | null> => {
    if (archives[index]) return archives[index];
    const currentScript = segments[index]?.script;
    if (!currentScript) return null;

    setTtsGenerating((prev) => ({ ...prev, [index]: true }));
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: currentScript,
          metadata: {
            segmentIndex: index,
            segmentTitle: segments[index]?.segmentTitle,
            year,
            month,
            season: monthToSeason(Number(month)),
          },
        }),
      });
      if (!response.ok) {
        const msg = await response.text();
        throw new Error(`TTS API ${response.status}: ${msg}`);
      }
      const data: SegmentArchive = await response.json();
      console.log(
        `[ensureTTS] seg=${index} archiveId=${data.archiveId} ` +
          `chunks=${data.chunks.length} pipelineMs=${data.pipelineMs}`,
      );
      setArchives((prev) => ({ ...prev, [index]: data }));
      return data;
    } catch (error) {
      console.error(`[ensureTTS] seg=${index} error:`, error);
      alert(`音声生成に失敗しました: ${error instanceof Error ? error.message : 'Unknown'}`);
      return null;
    } finally {
      setTtsGenerating((prev) => ({ ...prev, [index]: false }));
    }
  };

  /**
   * 指定セグメントの合成音声を再生（必要なら生成も）。
   * audio.onended で楽曲再生に進む（旧 playVoice の振る舞いを踏襲）。
   *
   * BGM挙動: archive が既に生成済みの場合、ensureTTS は瞬時に返るため
   * BGMが鳴る時間が極端に短くなる。セグメント開始の儀式として
   * 最低 1.5 秒は BGM を響かせてから fadeBgmOut へ移行する。
   */
  const playVoice = async (index: number) => {
    if (isPlaying) return;
    setIsPlaying(true);
    setCurrentVideoId(null);
    bgmRef.current?.play().catch(() => {});
    const bgmStartedAt = Date.now();
    const BGM_MIN_MS = 1500;

    const archive = await ensureTTS(index);
    if (!archive) {
      setIsPlaying(false);
      bgmRef.current?.pause();
      return;
    }

    const elapsed = Date.now() - bgmStartedAt;
    if (elapsed < BGM_MIN_MS) {
      await new Promise((r) => setTimeout(r, BGM_MIN_MS - elapsed));
    }

    const audio = new Audio(archive.outputUrl);

    const advance = () => {
      setIsPlaying(false);
      const seg = segments[index];
      if (seg?.songTitle) {
        playMusic(seg);
      } else if (index < segments.length - 1) {
        const nextIdx = index + 1;
        setCurrentIndex(nextIdx);
      } else {
        // ループは終端で停止（編集中の再聴行為を妨げない）
      }
    };

    audio.onloadedmetadata = () => {
      console.log(`[playVoice] seg=${index} audio.duration=${audio.duration.toFixed(1)}s`);
    };
    audio.onended = () => {
      console.log(`[playVoice] seg=${index} ended at ${audio.currentTime.toFixed(1)}s / ${audio.duration.toFixed(1)}s`);
      advance();
    };
    audio.onerror = (e) => {
      const err = audio.error;
      console.error(`[playVoice] seg=${index} error:`, err?.code, err?.message, e);
      alert(`音声再生エラー: ${err?.message ?? 'unknown'}`);
      setIsPlaying(false);
    };

    fadeBgmOut(() => {
      audio.play().catch((err) => {
        console.error(`[playVoice] seg=${index} play() rejected:`, err);
        setIsPlaying(false);
      });
    });
  };

  /**
   * 単一チャンクだけ試聴する。fade等なしで即時再生。
   */
  const playChunk = (chunk: ChunkInfo) => {
    const audio = new Audio(chunk.mp3Url);
    audio.play().catch((err) => {
      console.error('[playChunk] error:', err);
      alert(`チャンク再生に失敗: ${err.message}`);
    });
  };

  /**
   * チャンクのテキストを編集して再生成する。
   */
  const submitChunkEdit = async (segmentIndex: number, chunkIndex: number, newText: string) => {
    const archive = archives[segmentIndex];
    if (!archive) return;

    setRegeneratingChunk({ segmentIndex, chunkIndex });
    try {
      const res = await fetch('/api/tts/chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archiveId: archive.archiveId,
          chunkIndex,
          newText,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`chunk regen failed: ${res.status} ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      // 既存 archive を chunks+outputUrl で更新
      setArchives((prev) => ({
        ...prev,
        [segmentIndex]: {
          ...prev[segmentIndex],
          outputUrl: data.outputUrl,
          outputBytes: data.outputBytes,
          chunks: data.chunks,
        },
      }));
      console.log(`[submitChunkEdit] seg=${segmentIndex} chunk=${chunkIndex} regenerated in ${data.ttsMs}ms`);
      setEditingChunk(null);
    } catch (e) {
      console.error('[submitChunkEdit] error:', e);
      alert(`チャンク編集に失敗: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setRegeneratingChunk(null);
    }
  };

  const fadeOutAndStop = (onComplete: () => void) => {
    const player = playerRef.current;
    if (!player) { onComplete(); return; }

    const FADE_DURATION = 2000; // ms
    const STEPS = 20;
    const interval = FADE_DURATION / STEPS;
    let step = 0;
    const initialVolume = player.getVolume?.() ?? 100;

    const timer = setInterval(() => {
      step++;
      const newVolume = Math.max(0, initialVolume * (1 - step / STEPS));
      try { player.setVolume(newVolume); } catch { /* ignore */ }
      if (step >= STEPS) {
        clearInterval(timer);
        try { player.stopVideo(); } catch { /* ignore */ }
        try { player.setVolume(initialVolume); } catch { /* ignore */ }
        onComplete();
      }
    }, interval);
  };

  const onMusicEnd = () => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    fadeOutAndStop(() => {
      setCurrentVideoId(null);
      if (currentIndex < segments.length - 1) {
        const nextIdx = currentIndex + 1;
        setCurrentIndex(nextIdx);
        setTimeout(() => { playVoice(nextIdx); }, 1500);
      } else {
        alert('本日の放送はすべて終了しました。ご視聴ありがとうございました！');
      }
    });
  };

  const currentSegment = segments[currentIndex];

  return (
    <main className="min-h-screen bg-black text-gray-100 p-8 font-sans">
      <div className="max-w-3xl mx-auto text-center">
        <header className="mb-8">
          <h1 className="text-5xl font-black mb-2 text-yellow-500 tracking-tighter italic">TIME SLIP DJ</h1>
          <p className="text-gray-400 font-mono tracking-widest text-sm">30-MINUTE RETRO BROADCAST SYSTEM</p>
        </header>

        {/* タブナビゲーション */}
        <div className="flex gap-1 bg-gray-900 rounded-xl p-1 mb-8 border border-gray-800">
          <button
            onClick={() => setActiveTab('program')}
            className={`flex-1 py-3 rounded-lg font-black text-sm transition-all ${activeTab === 'program' ? 'bg-yellow-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            番組生成
          </button>
          <button
            onClick={() => setActiveTab('content')}
            className={`flex-1 py-3 rounded-lg font-black text-sm transition-all ${activeTab === 'content' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            コンテンツ生成（60本）
          </button>
        </div>

        {/* 番組生成タブ */}
        {activeTab === 'program' && (<>

        {/* 設定エリア */}
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 mb-10 inline-block shadow-2xl">
          <div className="flex gap-4 items-center flex-wrap justify-center">
            <select value={year} onChange={(e) => setYear(e.target.value)} className="bg-gray-800 p-3 rounded-lg border border-gray-700 text-xl text-yellow-500">
              {Array.from({ length: 46 }, (_, i) => 1980 + i).map(y => <option key={y} value={y}>{y}年</option>)}
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="bg-gray-800 p-3 rounded-lg border border-gray-700 text-xl text-yellow-500">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
            </select>
            <button onClick={generateProgram} disabled={isLoading} className="bg-yellow-600 hover:bg-yellow-500 text-white font-black py-3 px-8 rounded-full text-lg disabled:opacity-30 transition-all">
              {isLoading ? '構成作成中...' : '番組をフル生成'}
            </button>
            <label className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-5 rounded-full text-sm cursor-pointer transition-all">
              JSONから復元
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importScript(f);
                  e.target.value = '';
                }}
              />
            </label>
            {/* モード切り替え */}
            <div className="flex items-center gap-2 bg-gray-800 rounded-full p-1 border border-gray-700">
              <button
                onClick={() => setMode('youtube')}
                className={`px-4 py-2 rounded-full text-sm font-black transition-all ${mode === 'youtube' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                YouTube用 (30秒)
              </button>
              <button
                onClick={() => setMode('full')}
                className={`px-4 py-2 rounded-full text-sm font-black transition-all ${mode === 'full' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                Web用 (フル)
              </button>
            </div>
          </div>
        </div>

        {/* 放送プレイヤーエリア */}
        {segments.length > 0 && currentSegment && (
          <div className="bg-gray-100 text-gray-900 p-8 md:p-12 rounded shadow-2xl relative text-left border-t-8 border-red-600">
            
            {/* YouTubeプレイヤー */}
            {currentVideoId && (
              <div className="fixed bottom-4 right-4 z-50 shadow-2xl border-2 border-red-600 rounded-lg overflow-hidden">
                <div className="bg-red-600 text-white text-[10px] px-2 py-1 font-bold">NOW PLAYING</div>
                <YouTube
                  videoId={currentVideoId}
                  opts={{ height: '180', width: '320', playerVars: { autoplay: 1, controls: 1 } }}
                  onReady={(e) => { playerRef.current = e.target; }}
                  onPlay={() => {
                    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
                    if (mode === 'youtube') {
                      previewTimerRef.current = setTimeout(onMusicEnd, PREVIEW_SECONDS * 1000);
                    }
                  }}
                  onEnd={onMusicEnd}
                />
              </div>
            )}

            {/* 進行度インジケーター */}
            <div className="flex gap-2 mb-6">
              {segments.map((_, idx) => (
                <div key={idx} className={`h-1 flex-1 rounded ${idx <= currentIndex ? 'bg-red-600' : 'bg-gray-300'}`} />
              ))}
            </div>

            <div className="flex justify-between items-start mb-8">
              <div>
                <span className="text-xs font-bold text-red-600 tracking-widest uppercase mb-1 block">Corner {currentIndex + 1} / {segments.length}</span>
                <h2 className="text-3xl font-black tracking-tight">{currentSegment.segmentTitle}</h2>
              </div>
              <div className="flex flex-col gap-2 items-end">
                <button onClick={() => playVoice(currentIndex)} disabled={isPlaying || !!currentVideoId} className="bg-red-600 text-white px-8 py-4 rounded-full font-black hover:bg-red-700 disabled:bg-gray-400 shadow-lg flex items-center gap-2">
                  {isPlaying ? <span className="animate-pulse">● 生成＆再生中...</span> : currentVideoId ? '🎵 MUSIC ON AIR' : '▶ トークを聴く'}
                </button>
                <button onClick={downloadScript} className="text-xs text-gray-500 underline hover:text-gray-700">
                  スクリプトをJSONで保存
                </button>
              </div>
            </div>

            <div className="whitespace-pre-wrap font-serif text-lg leading-relaxed mb-10 bg-gray-50 p-6 rounded border-l-4 border-gray-300">
              {currentSegment.script}
            </div>

            {/* 編集ワークフロー: チャンク一覧 */}
            {ttsGenerating[currentIndex] && (
              <div className="mt-8 pt-8 border-t-2 border-dashed border-gray-300 text-center">
                <p className="text-sm text-gray-600 font-mono animate-pulse">音声を生成しています…</p>
              </div>
            )}
            {archives[currentIndex] && (
              <div className="mt-8 pt-8 border-t-2 border-dashed border-gray-300">
                <div className="flex justify-between items-center mb-4">
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">
                    Chunks — 編集モード
                  </p>
                  <p className="text-[10px] text-gray-400 font-mono">
                    {archives[currentIndex].chunks.length} chunks ・ archive={archives[currentIndex].archiveId}
                  </p>
                </div>
                <ul className="space-y-2">
                  {archives[currentIndex].chunks.map((chunk) => {
                    const isRegen =
                      regeneratingChunk?.segmentIndex === currentIndex &&
                      regeneratingChunk.chunkIndex === chunk.index;
                    const wasEdited = !!chunk.editedAt;
                    const verifyFailed = chunk.verification && !chunk.verification.ok;
                    return (
                      <li
                        key={chunk.index}
                        className={`p-3 rounded-lg border ${
                          wasEdited
                            ? 'border-green-300 bg-green-50'
                            : verifyFailed
                            ? 'border-amber-300 bg-amber-50'
                            : 'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="font-mono text-xs text-gray-400 w-8 pt-1 text-right">
                            #{chunk.index}
                          </span>
                          <div className="flex-1 text-sm leading-snug text-gray-800">
                            {chunk.text}
                            {wasEdited && (
                              <span className="ml-2 text-[10px] text-green-700 font-bold">✓ 編集済み</span>
                            )}
                            {verifyFailed && !wasEdited && (
                              <span className="ml-2 text-[10px] text-amber-700 font-bold">
                                ⚠ {chunk.verification?.reason ?? 'verify failed'}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => playChunk(chunk)}
                              disabled={isRegen}
                              className="text-[10px] bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-900 disabled:opacity-30"
                            >
                              ▶ 試聴
                            </button>
                            <button
                              onClick={() =>
                                setEditingChunk({
                                  segmentIndex: currentIndex,
                                  chunkIndex: chunk.index,
                                  text: chunk.text,
                                })
                              }
                              disabled={isRegen}
                              className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-30"
                            >
                              {isRegen ? '生成中...' : '✏ 編集'}
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {archives[currentIndex].warnings.length > 0 && (
                  <p className="mt-3 text-[10px] text-gray-500 font-mono">
                    sanitize warnings: {archives[currentIndex].warnings.join(' / ')}
                  </p>
                )}
              </div>
            )}

            {/* オンエアリスト（セグメント間のナビゲーション） */}
            <div className="mt-8 pt-8 border-t-2 border-dashed border-gray-300">
              <p className="text-xs text-gray-500 font-bold mb-4 uppercase tracking-widest text-center">On Air List</p>
              <div className="space-y-3">
                {segments.map((segment, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-4 p-3 rounded-lg cursor-pointer ${
                      idx === currentIndex
                        ? 'bg-yellow-50 border border-yellow-200'
                        : 'opacity-70 hover:opacity-100 hover:bg-gray-50'
                    }`}
                    onClick={() => setCurrentIndex(idx)}
                  >
                    <span className="font-mono text-sm text-gray-400">#{idx + 1}</span>
                    <div className="flex-1">
                      <p className={`text-sm font-black ${idx === currentIndex ? 'text-gray-900' : 'text-gray-600'}`}>
                        {segment.segmentTitle ?? `セグメント ${idx + 1}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {segment.songTitle
                          ? `🎵 ${segment.songTitle} / ${segment.artistName}`
                          : '（楽曲なし）'}
                      </p>
                    </div>
                    {archives[idx] && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadAudio(idx);
                        }}
                        className="text-[10px] bg-green-600 text-white px-2 py-1 rounded font-bold hover:bg-green-700"
                      >
                        ↓ MP3
                      </button>
                    )}
                    {idx === currentIndex && isPlaying && (
                      <span className="text-[10px] bg-red-600 text-white px-2 py-1 rounded-full font-bold animate-pulse">PLAYING</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* チャンク編集モーダル */}
        {editingChunk && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-white text-gray-900 rounded-xl shadow-2xl max-w-2xl w-full p-6">
              <h3 className="text-lg font-black mb-2">
                チャンク #{editingChunk.chunkIndex} を編集 — セグメント {editingChunk.segmentIndex + 1}
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                テキストを編集して再生成ボタンを押すと、このチャンクだけが新しい音声で差し替わります。
                <br />
                ヒント: 「LOVE」→「ラブ」、「倶楽部」→「くらぶ」のように、誤読しそうな漢字・英単語をひらがな/カタカナに置き換えると効果的です。
              </p>
              <textarea
                value={editingChunk.text}
                onChange={(e) =>
                  setEditingChunk({ ...editingChunk, text: e.target.value })
                }
                rows={6}
                className="w-full p-3 border border-gray-300 rounded font-mono text-sm leading-relaxed"
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setEditingChunk(null)}
                  className="px-4 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  onClick={() =>
                    submitChunkEdit(
                      editingChunk.segmentIndex,
                      editingChunk.chunkIndex,
                      editingChunk.text,
                    )
                  }
                  disabled={!editingChunk.text.trim() || !!regeneratingChunk}
                  className="px-4 py-2 text-sm rounded bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-40"
                >
                  {regeneratingChunk ? '再生成中…' : '再生成'}
                </button>
              </div>
            </div>
          </div>
        )}

        </>)}

        {/* コンテンツ生成タブ */}
        {activeTab === 'content' && (
          <div className="text-left">
            {/* 設定エリア */}
            <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 mb-8 shadow-2xl">
              <div className="flex gap-4 items-center flex-wrap">
                <select
                  value={contentYear}
                  onChange={(e) => setContentYear(e.target.value)}
                  className="bg-gray-800 p-3 rounded-lg border border-gray-700 text-xl text-yellow-500"
                >
                  {Array.from({ length: 46 }, (_, i) => 1980 + i).map(y => (
                    <option key={y} value={y}>{y}年</option>
                  ))}
                </select>
                <select
                  value={contentSeason}
                  onChange={(e) => setContentSeason(e.target.value)}
                  className="bg-gray-800 p-3 rounded-lg border border-gray-700 text-xl text-yellow-500"
                >
                  <option value="spring">春（3〜5月）</option>
                  <option value="summer">夏（6〜8月）</option>
                  <option value="autumn">秋（9〜11月）</option>
                  <option value="winter">冬（12〜2月）</option>
                </select>
                <button
                  onClick={generateMaster}
                  disabled={isGeneratingContent}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-8 rounded-full text-lg disabled:opacity-30 transition-all"
                >
                  {isGeneratingContent
                    ? `生成中... (${contentProgress}/4)`
                    : '60コンテンツを生成'}
                </button>
              </div>
              {isGeneratingContent && (
                <div className="mt-4">
                  <div className="flex gap-1">
                    {CATEGORY_BATCHES.map((batch, i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded transition-all duration-500 ${i < contentProgress ? 'bg-blue-500' : 'bg-gray-700'}`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    {contentProgress > 0 && contentProgress <= 4
                      ? `${CATEGORY_BATCHES[contentProgress - 1]?.join(' / ')} を生成中...`
                      : ''}
                  </p>
                </div>
              )}
            </div>

            {/* 生成結果 */}
            {masterData && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-black text-yellow-500">
                      {masterData.metadata.year}年 {masterData.metadata.season}
                    </h2>
                    <p className="text-gray-400 text-sm mt-1">{masterData.metadata.description}</p>
                    <p className="text-gray-500 text-xs mt-1">{masterData.entries.length}件生成済み</p>
                  </div>
                  <button
                    onClick={downloadMaster}
                    className="bg-green-600 hover:bg-green-500 text-white font-black py-3 px-6 rounded-full transition-all"
                  >
                    JSONをダウンロード
                  </button>
                </div>

                {/* カテゴリ別プレビュー */}
                {CATEGORY_BATCHES.flat().map(category => {
                  const items = masterData.entries.filter((e: any) => e.category === category);
                  if (items.length === 0) return null;
                  return (
                    <div key={category} className="mb-6 bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                      <div className="px-5 py-3 bg-gray-800 flex items-center justify-between">
                        <span className="font-black text-sm tracking-widest text-yellow-500">{category}</span>
                        <span className="text-xs text-gray-500">{items.length}件</span>
                      </div>
                      <ul className="divide-y divide-gray-800">
                        {items.map((item: any) => (
                          <li key={item.id} className="px-5 py-3">
                            <p className="font-bold text-white">{item.title}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{item.catchphrase}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </main>
  );
}