'use client';

import { useState, useRef, useEffect } from 'react';
import YouTube from 'react-youtube';

export default function Home() {
  const [year, setYear] = useState('1995');
  const [month, setMonth] = useState('8');
  const [segments, setSegments] = useState<any[]>([]); 
  const [currentIndex, setCurrentIndex] = useState(0); 
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [savedAudioUrls, setSavedAudioUrls] = useState<Record<number, string>>({});

  const [mode, setMode] = useState<'youtube' | 'full'>('youtube');

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

  const downloadAudio = (index: number) => {
    const url = savedAudioUrls[index];
    if (!url) return;
    const season = monthToSeason(Number(month));
    const filename = `${year}-${season}-seg${index + 1}.mp3`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
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

  const generateProgram = async () => {
    setIsLoading(true);
    setSegments([]);
    setCurrentIndex(0);
    setCurrentVideoId(null);
    setSavedAudioUrls({});
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
    if (!song) return;
    try {
      const query = `${song.artistName} ${song.songTitle}`;
      const res = await fetch('/api/search-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
      });
      const data = await res.json();
      if (data.videoId) {
        setCurrentVideoId(data.videoId);
      }
    } catch (error) {
      console.error("YouTube検索エラー:", error);
    }
  };

  const playVoice = async (index: number) => {
    const currentScript = segments[index]?.script;
    if (!currentScript) return;
    
    setIsPlaying(true);
    setCurrentVideoId(null); 
    bgmRef.current?.play().catch(e => console.log("BGMの再生にはユーザー操作が必要です"));

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: currentScript }),
      });
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setSavedAudioUrls(prev => ({ ...prev, [index]: url }));
      const audio = new Audio(url);
      
      audio.onplay = () => {
        bgmRef.current?.pause();
      };

      audio.onended = () => {
        setIsPlaying(false);
        playMusic(segments[index]);
      };
      audio.play();
    } catch (error) {
      console.error('TTS Playback Error:', error);
      bgmRef.current?.pause();
      setIsPlaying(false);
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
        <header className="mb-12">
          <h1 className="text-5xl font-black mb-2 text-yellow-500 tracking-tighter italic">TIME SLIP DJ</h1>
          <p className="text-gray-400 font-mono tracking-widest text-sm">30-MINUTE RETRO BROADCAST SYSTEM</p>
        </header>

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

            {/* オンエアリスト（ここを提案通りに変更しました） */}
            <div className="mt-8 pt-8 border-t-2 border-dashed border-gray-300">
              <p className="text-xs text-gray-500 font-bold mb-4 uppercase tracking-widest text-center">On Air List</p>
              <div className="space-y-3">
                {segments.slice(0, currentIndex + 1).map((segment, idx) => (
                  <div key={idx} className={`flex items-center gap-4 p-3 rounded-lg ${idx === currentIndex ? 'bg-yellow-50 border border-yellow-200' : 'opacity-60'}`}>
                    <span className="font-mono text-sm text-gray-400">#{idx + 1}</span>
                    <div className="flex-1">
                      <p className={`text-lg font-black ${idx === currentIndex ? 'text-gray-900' : 'text-gray-600'}`}>
                        {segment.songTitle} / {segment.artistName}
                      </p>
                    </div>
                    {savedAudioUrls[idx] && (
                      <button onClick={() => downloadAudio(idx)} className="text-[10px] bg-green-600 text-white px-2 py-1 rounded font-bold hover:bg-green-700">
                        ↓ MP3保存
                      </button>
                    )}
                    {idx === currentIndex && (
                      <span className="text-[10px] bg-red-600 text-white px-2 py-1 rounded-full font-bold animate-pulse">NOW ON AIR</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </div>
    </main>
  );
}